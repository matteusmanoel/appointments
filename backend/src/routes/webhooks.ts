import { Router, Request, Response } from "express";
import {
  parseEvolutionConnectionUpdate,
  parseEvolutionInbound,
} from "../integrations/whatsapp/parse-evolution.js";
import {
  enqueueInboundMessage,
  handleFromMeHandoff,
  handleInboundAudio,
  handleInboundReceipt,
  applyEditedInboundMessage,
  resolveBarbershopByInstance,
} from "../integrations/whatsapp/inbound.js";
import { persistEvolutionSocketState } from "../integrations/whatsapp/evolution-session.js";
import { LAB_EVOLUTION_INSTANCE } from "../integrations/whatsapp/inbound-allowlist.js";

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
  handoffCandidate: boolean;
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

  // Status events (Delivered/Read/Receipt) must not enqueue AI jobs — only real inbound messages.
  const rawEventObj = anyBody.event;
  if (rawEventObj && typeof rawEventObj === "object") {
    const ev = rawEventObj as Record<string, unknown>;
    const evtT = String(ev.Type ?? ev.type ?? "").trim().toLowerCase();
    if (["delivered", "read", "receipt", "presence", "ephemeral"].includes(evtT)) {
      return {
        skip: true,
        fromMe: false,
        handoffCandidate: false,
        instanceKey,
        fromPhone: null,
        text: null,
        providerEventId: undefined,
      };
    }
  }

  const msg = (body?.data?.message ??
    (anyBody.message as unknown) ??
    ((anyBody.event as Record<string, unknown> | undefined)?.message as unknown)) as Record<string, unknown> | undefined;

  const chatObj = (anyBody.chat as Record<string, unknown> | undefined) ?? undefined;
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

  const fromMe = Boolean((msg?.fromMe ?? msg?.IsFromMe ?? (anyBody.event as Record<string, unknown> | undefined)?.IsFromMe) as unknown);
  if (fromMe) {
    // When business sends a message, get the chat's other party (customer) to pause that conversation.
    const toRaw =
      (msg?.to as string) ??
      (msg?.To as string) ??
      (msg?.remoteJid as string) ??
      (chatObj?.id as string) ??
      (chatObj?.wa_chatid as string) ??
      (chatObj?.chatid as string);
    const fromPhoneWhenMe = toRaw ? normalizeFromPhone(String(toRaw)) : null;
    // Only consider manual handoff for real outbound text/chat messages.
    const handoffCandidate =
      !!text &&
      (!messageType ||
        messageType === "chat" ||
        messageType === "text" ||
        messageType === "conversation");
    return {
      skip: true,
      fromMe: true,
      handoffCandidate,
      instanceKey,
      fromPhone: fromPhoneWhenMe,
      text: text ?? null,
      providerEventId: undefined,
    };
  }

  // If provider supplies a type and it's clearly not a text/chat message, skip.
  if (messageType && messageType !== "chat" && messageType !== "text" && messageType !== "conversation") {
    return { skip: true, fromMe: false, handoffCandidate: false, instanceKey, fromPhone: null, text: null, providerEventId: undefined };
  }
  if (!text) {
    return { skip: true, fromMe: false, handoffCandidate: false, instanceKey, fromPhone: null, text: null, providerEventId: undefined };
  }

  const chatObjForCandidates = chatObj;
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
    chatObjForCandidates?.wa_chatid,
    chatObjForCandidates?.wa_lastMessageSender,
    chatObjForCandidates?.id,
    chatObjForCandidates?.chatid,
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

  // Skip group messages — WhatsApp group JIDs end with @g.us
  if (fromRaw?.includes("@g.us") || candidates.some((v) => v.includes("@g.us"))) {
    return { skip: true, fromMe: false, handoffCandidate: false, instanceKey, fromPhone: null, text: null, providerEventId: undefined };
  }

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
    return { skip: true, fromMe: false, handoffCandidate: false, instanceKey, fromPhone: null, text: null, providerEventId: providerEventIdStr };
  }
  return {
    skip: !fromRaw || !instanceKey || !providerEventIdStr,
    fromMe: false,
    handoffCandidate: false,
    instanceKey,
    fromPhone,
    text,
    providerEventId: providerEventIdStr,
  };
}

/** POST /api/webhooks/uazapi — Uazapi sends events here. Respond 200 then enqueue for worker. */
webhooksRouter.post("/uazapi", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as UazapiWebhookBody;
  const event = body?.event ?? "(no event)";
  const parsed = parseUazapiInbound(body);

  if (parsed.skip && parsed.fromMe && parsed.handoffCandidate && parsed.instanceKey) {
    try {
      await handleFromMeHandoff({ provider: "uazapi", parsed, logPrefix: "uazapi webhook" });
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

  try {
    const barbershopId = await resolveBarbershopByInstance("uazapi", parsed.instanceKey);
    if (!barbershopId) {
      console.warn("uazapi webhook: no barbershop found for instanceKey=", parsed.instanceKey);
      res.status(200).send();
      return;
    }
    await enqueueInboundMessage({
      provider: "uazapi",
      barbershopId,
      fromPhone: parsed.fromPhone,
      text: parsed.text,
      providerEventId: parsed.providerEventId,
      payload: body,
      eventLabel: typeof event === "string" ? event : undefined,
      logPrefix: "uazapi webhook",
    });
  } catch (e) {
    console.error("uazapi webhook enqueue:", e);
  }
  res.status(200).send();
});

/** POST /api/webhooks/evolution — Evolution v2 messages.upsert + connection.update. */
webhooksRouter.post("/evolution", async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.EVOLUTION_API_KEY ?? "";
  if (secret) {
    const headerKey = String(req.headers.apikey ?? req.headers["x-api-key"] ?? "");
    if (headerKey && headerKey !== secret) {
      res.status(401).send();
      return;
    }
  }

  const conn = parseEvolutionConnectionUpdate(req.body);
  if (conn) {
    try {
      const barbershopId = conn.instanceKey
        ? await resolveBarbershopByInstance("evolution", conn.instanceKey)
        : null;
      if (barbershopId && conn.state === "connected") {
        await persistEvolutionSocketState(barbershopId, "connected", { phone: conn.phone });
      } else if (conn.state === "disconnected") {
        console.info(
          "[evolution webhook] socket close instance=%s (keepalive restores if session was paired)",
          conn.instanceKey,
        );
      }
    } catch (e) {
      console.error("[evolution webhook] connection.update:", e);
    }
    res.status(200).send();
    return;
  }

  const parsed = parseEvolutionInbound(req.body);

  if (parsed.fromMe && parsed.handoffCandidate && parsed.instanceKey) {
    try {
      await handleFromMeHandoff({ provider: "evolution", parsed, logPrefix: "evolution webhook" });
    } catch (e) {
      console.error("[evolution webhook] handoff error:", e);
    }
    res.status(200).send();
    return;
  }

  if (parsed.skip || !parsed.fromPhone || !parsed.providerEventId) {
    console.info(
      "[evolution webhook] skip instanceKey=%s fromMe=%s fromPhone=%s hasText=%s providerEventId=%s media=%s edit=%s",
      parsed.instanceKey,
      parsed.fromMe,
      parsed.fromPhone ?? "(null)",
      !!parsed.text,
      parsed.providerEventId ?? "(null)",
      parsed.mediaKind ?? "—",
      parsed.editOfProviderEventId ?? "—",
    );
    res.status(200).send();
    return;
  }

  try {
    if (parsed.instanceKey === LAB_EVOLUTION_INSTANCE) {
      console.info(
        "[evolution webhook] lab instance ignored instanceKey=%s fromPhone=%s",
        parsed.instanceKey,
        parsed.fromPhone,
      );
      res.status(200).send();
      return;
    }
    const barbershopId = await resolveBarbershopByInstance("evolution", parsed.instanceKey);
    if (!barbershopId) {
      console.warn("evolution webhook: no barbershop for instance=", parsed.instanceKey);
      res.status(200).send();
      return;
    }
    if (parsed.mediaKind === "audio" && !parsed.text && parsed.fromPhone && parsed.providerEventId) {
      await handleInboundAudio({
        barbershopId,
        instanceKey: parsed.instanceKey,
        fromPhone: parsed.fromPhone,
        providerEventId: parsed.providerEventId,
        payload: req.body,
        logPrefix: "evolution webhook",
      });
      res.status(200).send();
      return;
    }
    if (
      (parsed.mediaKind === "image" || parsed.mediaKind === "document") &&
      parsed.fromPhone &&
      parsed.providerEventId
    ) {
      await handleInboundReceipt({
        barbershopId,
        instanceKey: parsed.instanceKey,
        fromPhone: parsed.fromPhone,
        providerEventId: parsed.providerEventId,
        logPrefix: "evolution webhook",
      });
      res.status(200).send();
      return;
    }
    if (parsed.editOfProviderEventId && parsed.text) {
      await applyEditedInboundMessage({
        provider: "evolution",
        barbershopId,
        fromPhone: parsed.fromPhone,
        text: parsed.text,
        originalProviderEventId: parsed.editOfProviderEventId,
        providerEventId: parsed.providerEventId,
        payload: req.body,
        logPrefix: "evolution webhook",
      });
      res.status(200).send();
      return;
    }
    if (!parsed.text) {
      console.info(
        "[evolution webhook] skip empty text instanceKey=%s fromPhone=%s",
        parsed.instanceKey,
        parsed.fromPhone,
      );
      res.status(200).send();
      return;
    }
    await enqueueInboundMessage({
      provider: "evolution",
      barbershopId,
      fromPhone: parsed.fromPhone,
      text: parsed.text,
      providerEventId: parsed.providerEventId,
      payload: req.body,
      eventLabel: "messages.upsert",
      logPrefix: "evolution webhook",
      pushName: parsed.pushName,
    });
  } catch (e) {
    console.error("evolution webhook enqueue:", e);
  }
  res.status(200).send();
});
