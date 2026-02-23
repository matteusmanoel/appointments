import { Router, Request, Response } from "express";
import { pool } from "../db.js";
import { setAiPaused } from "../ai/runtime-pause.js";

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const n8nChatTriggerUrl = process.env.N8N_CHAT_TRIGGER_URL ?? "";

export const webhooksRouter = Router();

/** Uazapi inbound webhook payload (minimal contract; adjust after capturing real payloads) */
type UazapiWebhookBody = {
  event?: string;
  instanceId?: string | number;
  instance?: string;
  instanceName?: string;
  EventType?: string;
  message?: unknown;
  chat?: unknown;
  data?: {
    message?: {
      id?: string;
      from?: string;
      body?: string;
      type?: string;
      timestamp?: number;
      fromMe?: boolean;
    };
  };
};

webhooksRouter.get("/whatsapp", (req: Request, res: Response): void => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
    res.type("text/plain").send(challenge);
    return;
  }
  res.status(403).send("Forbidden");
});

webhooksRouter.post("/whatsapp", async (req: Request, res: Response): Promise<void> => {
  res.status(200).send(); // acknowledge immediately
  const body = req.body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from: string;
            type: string;
            text?: { body: string };
          }>;
        };
      }>;
    }>;
  };
  if (body?.object !== "whatsapp_business_account" || !body.entry?.length) return;
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const messages = value?.messages;
      if (!messages?.length) continue;
      for (const msg of messages) {
        if (msg.type !== "text" || !msg.text?.body) continue;
        const from = msg.from;
        const text = msg.text.body;
        let reply = "Desculpe, o atendimento automático está temporariamente indisponível.";
        if (n8nChatTriggerUrl && accessToken && phoneNumberId) {
          try {
            const resp = await fetch(n8nChatTriggerUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ from, text, sessionId: from }),
            });
            const data = (await resp.json().catch(() => ({}))) as { output?: string; reply?: string };
            reply = data.output ?? data.reply ?? reply;
          } catch {
            reply = "Erro ao processar. Tente novamente em instantes.";
          }
        }
        try {
          await fetch(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: from.replace(/\D/g, ""),
                type: "text",
                text: { body: reply },
              }),
            }
          );
        } catch (e) {
          console.error("WhatsApp send error:", e);
        }
      }
    }
  }
});

/** Normalize phone from Uazapi (strip @s.whatsapp.net etc). Exported for tests. */
export function normalizeFromPhone(fromRaw: string): string {
  return fromRaw.replace(/@.*$/, "").replace(/\D/g, "") || fromRaw;
}

/** Parse Uazapi webhook body for inbound text message. Exported for tests. */
export function parseUazapiInbound(body: UazapiWebhookBody): {
  skip: boolean;
  fromMe: boolean;
  instanceKey: string;
  fromPhone: string | null;
  text: string | null;
  providerEventId: string | undefined;
} {
  const anyBody = body as unknown as Record<string, unknown>;

  const instanceName =
    typeof body?.instance === "string"
      ? body.instance
      : typeof body?.instanceName === "string"
        ? body.instanceName
        : typeof (anyBody.instanceName as unknown) === "string"
          ? (anyBody.instanceName as string)
          : undefined;
  const instanceId = body?.instanceId != null ? String(body.instanceId) : undefined;
  const instanceKey = instanceName ?? instanceId ?? "";

  const msg = (body?.data?.message ??
    (anyBody.message as unknown) ??
    ((anyBody.event as Record<string, unknown> | undefined)?.message as unknown)) as Record<string, unknown> | undefined;

  const fromMe = Boolean((msg?.fromMe ?? msg?.IsFromMe ?? (anyBody.event as Record<string, unknown> | undefined)?.IsFromMe) as unknown);
  if (fromMe) {
    return { skip: true, fromMe: true, instanceKey, fromPhone: null, text: null, providerEventId: undefined };
  }

  const messageTypeRaw =
    (msg?.type ?? msg?.Type ?? (anyBody.event as Record<string, unknown> | undefined)?.Type) as string | undefined;
  const messageType = typeof messageTypeRaw === "string" ? messageTypeRaw.toLowerCase() : undefined;

  const text =
    msg?.body != null
      ? String(msg.body)
      : msg?.Body != null
        ? String(msg.Body)
        : msg?.text != null
          ? String(msg.text)
          : msg?.Text != null
            ? String(msg.Text)
            : null;

  // If provider supplies a type and it's clearly not a text/chat message, skip.
  if (messageType && messageType !== "chat" && messageType !== "text" && messageType !== "conversation") {
    return { skip: true, fromMe: false, instanceKey, fromPhone: null, text: null, providerEventId: undefined };
  }
  if (!text) {
    return { skip: true, fromMe: false, instanceKey, fromPhone: null, text: null, providerEventId: undefined };
  }

  const chatObj = (anyBody.chat as Record<string, unknown> | undefined) ?? undefined;
  const senderPnCandidate =
    (msg?.sender_pn ??
      msg?.senderPn ??
      msg?.senderPN ??
      msg?.sender_phone ??
      msg?.senderPhone ??
      (anyBody.event as Record<string, unknown> | undefined)?.sender_pn ??
      (anyBody.event as Record<string, unknown> | undefined)?.senderPn) as string | undefined;

  // Deterministic: if sender_pn exists, it is the real WhatsApp JID/phone to reply to.
  const senderPn =
    typeof senderPnCandidate === "string" && senderPnCandidate.trim() && !senderPnCandidate.includes("@lid")
      ? senderPnCandidate.trim()
      : undefined;

  const candidates = [
    msg?.from as unknown,
    msg?.From as unknown,
    msg?.sender as unknown,
    msg?.Sender as unknown,
    (anyBody.event as Record<string, unknown> | undefined)?.Sender,
    chatObj?.wa_chatid,
    chatObj?.wa_lastMessageSender,
    chatObj?.id,
    chatObj?.chatid,
    anyBody.chatid,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());

  // Prefer a real phone JID; avoid LID identifiers like `...@lid` when possible.
  const fromRaw =
    senderPn ??
    candidates.find((v) => !v.includes("@lid") && v.includes("@")) ??
    candidates.find((v) => !v.includes("@lid")) ??
    candidates[0];

  const providerEventId =
    (msg?.id ??
      msg?.ID ??
      msg?.messageId ??
      msg?.messageid ??
      (Array.isArray((msg?.MessageIDs as unknown)) ? (msg?.MessageIDs as unknown[])[0] : undefined) ??
      (Array.isArray(((anyBody.event as Record<string, unknown> | undefined)?.MessageIDs as unknown)) ? (((anyBody.event as Record<string, unknown>)?.MessageIDs as unknown[])[0] as unknown) : undefined)) as
      | string
      | number
      | undefined;

  const providerEventIdStr = providerEventId != null ? String(providerEventId) : undefined;
  const fromPhone = fromRaw ? normalizeFromPhone(String(fromRaw)) : null;
  // If we only got a LID (no phone), don't enqueue: we can't reply.
  if (!fromPhone || (fromRaw?.includes("@lid") ?? false)) {
    return { skip: true, fromMe: false, instanceKey, fromPhone: null, text: null, providerEventId: providerEventIdStr };
  }
  return { skip: !fromRaw || !instanceKey || !providerEventIdStr, fromMe: false, instanceKey, fromPhone, text, providerEventId: providerEventIdStr };
}

/** POST /api/webhooks/uazapi — Uazapi sends events here. Respond 200 then enqueue for worker. */
webhooksRouter.post("/uazapi", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as UazapiWebhookBody;
  const event = body?.event ?? "(no event)";
  const parsed = parseUazapiInbound(body);

  if (parsed.skip && parsed.fromMe && parsed.instanceKey) {
    try {
      const r = await pool.query<{ barbershop_id: string }>(
        `SELECT barbershop_id FROM public.barbershop_whatsapp_connections
         WHERE provider = 'uazapi' AND (uazapi_instance_name = $1 OR uazapi_instance_id = $1) LIMIT 1`,
        [parsed.instanceKey]
      );
      const barbershopId = r.rows[0]?.barbershop_id;
      if (barbershopId) {
        await setAiPaused(barbershopId, { pausedBy: "auto", reason: "Mensagem do próprio número (handoff detectado)" });
        console.info("[uazapi webhook] handoff auto-pause barbershopId=%s", barbershopId);
      }
    } catch (e) {
      console.error("[uazapi webhook] handoff auto-pause error:", e);
    }
    res.status(200).send();
    return;
  }

  if (parsed.skip || !parsed.fromPhone || !parsed.text || !parsed.providerEventId) {
    const contentType = String(req.headers["content-type"] ?? "(none)");
    const rawBodyLen = typeof (req as unknown as { rawBody?: unknown }).rawBody === "string" ? ((req as unknown as { rawBody?: string }).rawBody?.length ?? 0) : 0;
    const keys =
      body && typeof body === "object"
        ? Object.keys(body as Record<string, unknown>).slice(0, 20).join(",")
        : typeof body;
    console.info(
      "[uazapi webhook] skip ct=%s rawLen=%s keys=%s event=%s instanceKey=%s fromPhone=%s hasText=%s providerEventId=%s",
      contentType,
      rawBodyLen,
      keys || "(none)",
      event,
      parsed.instanceKey,
      parsed.fromPhone ?? "(null)",
      !!parsed.text,
      parsed.providerEventId ?? "(null)"
    );
    res.status(200).send();
    return;
  }
  console.info("[uazapi webhook] inbound event=%s instanceKey=%s fromPhone=%s providerEventId=%s", event, parsed.instanceKey, parsed.fromPhone, parsed.providerEventId);

  let barbershopId: string | null = null;
  try {
    if (parsed.instanceKey) {
      const r = await pool.query<{ barbershop_id: string }>(
        `SELECT barbershop_id FROM public.barbershop_whatsapp_connections
         WHERE provider = 'uazapi' AND (uazapi_instance_name = $1 OR uazapi_instance_id = $1) LIMIT 1`,
        [parsed.instanceKey]
      );
      barbershopId = r.rows[0]?.barbershop_id ?? null;
    }
  } catch (e) {
    console.error("uazapi webhook resolve barbershop:", e);
  }

  if (!barbershopId) {
    console.warn("uazapi webhook: no barbershop found for instanceKey=", parsed.instanceKey, "- ensure connection has uazapi_instance_name or uazapi_instance_id matching webhook payload");
    res.status(200).send();
    return;
  }

  const fromPhone = parsed.fromPhone;
  const text = parsed.text;
  const providerEventId = parsed.providerEventId;

  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO public.whatsapp_inbound_events (barbershop_id, provider, provider_event_id, from_phone, payload, received_at)
       VALUES ($1, 'uazapi', $2, $3, $4, now())
       ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
      [barbershopId, providerEventId, fromPhone, JSON.stringify(body)]
    );
    if (inserted.rows.length === 0) {
      console.info("[uazapi webhook] duplicate providerEventId=%s skipped", providerEventId);
      res.status(200).send();
      return;
    }

    const optOutPattern = /^(parar|n[aã]o\s*quero\s*receber|cancelar\s*inscri[cç][aã]o|opt\s*out|remover|n[aã]o\s*receber\s*mais|sair\s*da\s*lista)$/i;
    const trimmed = (text || "").trim().toLowerCase();
    if (optOutPattern.test(trimmed) || (trimmed.includes("parar") && trimmed.length < 50)) {
      const normalized = fromPhone.replace(/\D/g, "");
      if (normalized) {
        const updated = await pool.query(
          `UPDATE public.clients SET marketing_opt_out = true, updated_at = now()
           WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
          [barbershopId, normalized]
        );
        if (updated.rowCount === 0) {
          await pool.query(
            `INSERT INTO public.clients (barbershop_id, name, phone, marketing_opt_out, updated_at)
             VALUES ($1, 'Cliente', $2, true, now())
             ON CONFLICT (barbershop_id, phone) DO UPDATE SET marketing_opt_out = true, updated_at = now()`,
            [barbershopId, normalized]
          );
        }
      }
    }

    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, last_message_at, updated_at)
       VALUES ($1, 'whatsapp', $2, now(), now())
       ON CONFLICT (barbershop_id, channel, external_thread_id)
       DO UPDATE SET last_message_at = now(), updated_at = now()
       RETURNING id`,
      [barbershopId, fromPhone]
    );
    const conversationId = conv.rows[0]?.id;
    if (!conversationId) {
      res.status(200).send();
      return;
    }

    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id)
       VALUES ($1, 'user', $2, $3)`,
      [conversationId, text.slice(0, 64 * 1024), providerEventId]
    );

    const payloadJson = { fromPhone, text, providerEventId, event: body?.event };
    const jobInsert = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_jobs (barbershop_id, conversation_id, type, payload_json, status, run_after)
       VALUES ($1, $2, 'process_inbound_message', $3, 'queued', now())
       RETURNING id`,
      [barbershopId, conversationId, JSON.stringify(payloadJson)]
    );
    const jobId = jobInsert.rows[0]?.id;
    console.info("[uazapi webhook] enqueued jobId=%s conversationId=%s barbershopId=%s", jobId, conversationId, barbershopId);
  } catch (e) {
    console.error("uazapi webhook enqueue:", e);
  }
  res.status(200).send();
});
