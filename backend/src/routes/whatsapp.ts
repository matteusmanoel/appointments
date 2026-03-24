import { Router, Request, Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { pool } from "../db.js";
import { getBarbershopId } from "../middleware/auth.js";
import { config } from "../config.js";
import { encrypt, decrypt } from "../integrations/encryption.js";
import { validateAdditionalInstructions, validateCustomRules, buildSystemPrompt, buildSystemPromptWithSections, normalizeProfile, getIncludedCustomRuleTitles } from "../ai/prompt-builder.js";
import { runAgent, detectViolations, DEFAULT_SYSTEM_PROMPT, RUNTIME_GUARDRAILS } from "../ai/agent.js";
import {
  adminCreateInstance,
  instanceConnect,
  instanceStatus,
  sendText,
  setWebhook,
  instanceDisconnect,
  pingUazapi,
  findMessages,
} from "../integrations/uazapi/client.js";
import type { InstanceStatusResult } from "../integrations/uazapi/client.js";
import { getAiPauseState, setAiPaused, clearAiPause, setConversationPaused, clearConversationPause } from "../ai/runtime-pause.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";
import { knowledgeRouter } from "./knowledge.js";
import { brPhoneMatchKeys, brPhonesMatch, canonicalizeBrPhoneDigits } from "../lib/phone-match.js";

export const whatsappRouter = Router();
whatsappRouter.use("/knowledge", knowledgeRouter);

type ConnectionRow = {
  id: string;
  barbershop_id: string;
  provider: string;
  whatsapp_phone: string | null;
  uazapi_instance_name: string | null;
  uazapi_instance_id: string | null;
  uazapi_instance_token_encrypted: string | null;
  status: string;
  connected_at: string | null;
  disconnected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function is429MaxInstances(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("429") && /maximum|limit|instances|connected|atingido/i.test(msg);
}

function getEncryptionKey(): string {
  const key = config.appEncryptionKey;
  if (!key) throw new Error("APP_ENCRYPTION_KEY is required for WhatsApp connection");
  return key;
}

function mapUazapiState(raw: InstanceStatusResult | undefined, fallback: "disconnected" | "connecting" | "connected"): "disconnected" | "connecting" | "connected" {
  if (!raw) return fallback;

  const valid = new Set(["disconnected", "connecting", "connected"]);

  if (raw.instance && typeof raw.instance === "object") {
    const s = (raw.instance as Record<string, unknown>).status;
    if (typeof s === "string" && valid.has(s)) {
      return s as "disconnected" | "connecting" | "connected";
    }
  }

  if (typeof raw.state === "string" && valid.has(raw.state)) {
    return raw.state as "disconnected" | "connecting" | "connected";
  }

  if (typeof raw.status === "string" && valid.has(raw.status)) {
    return raw.status as "disconnected" | "connecting" | "connected";
  }

  if (raw.status && typeof raw.status === "object" && "connected" in (raw.status as Record<string, unknown>)) {
    const connected = Boolean((raw.status as Record<string, unknown>).connected);
    return connected ? "connected" : "disconnected";
  }

  return fallback;
}

function normalizePhoneDigits(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length ? digits : null;
}

async function getConversationPauseHours(barbershopId: string): Promise<number> {
  try {
    const r = await pool.query<{ pause_hours: number }>(
      `SELECT pause_hours FROM public.barbershop_ai_handoff_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const hours = r.rows[0]?.pause_hours;
    if (typeof hours === "number" && Number.isFinite(hours) && hours > 0 && hours <= 168) {
      return Math.floor(hours);
    }
    return 4;
  } catch {
    return 4;
  }
}

function extractConnectedPhone(raw: InstanceStatusResult | undefined): string | null {
  if (!raw) return null;
  // Prefer instance.owner if present
  const owner = normalizePhoneDigits(raw.instance?.owner as string | undefined);
  if (owner) return owner;

  // Some installs provide jid under status object
  const jid =
    raw.status && typeof raw.status === "object"
      ? (raw.status as Record<string, unknown>).jid
      : undefined;
  if (typeof jid === "string") {
    const left = jid.split("@")[0];
    return normalizePhoneDigits(left);
  }

  return null;
}

/** GET /api/integrations/whatsapp — estado da conexão da NavalhIA */
whatsappRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query<ConnectionRow>(
      `SELECT id, barbershop_id, provider, whatsapp_phone, uazapi_instance_name, uazapi_instance_id,
              uazapi_instance_token_encrypted, status, connected_at, disconnected_at, last_error, created_at, updated_at
       FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [barbershopId]
    );
    const row = r.rows[0];
    if (!row) {
      const pauseState = await getAiPauseState(barbershopId);
      res.json({
        connected: false,
        status: "disconnected",
        provider: "uazapi",
        ai_paused_until: pauseState?.paused_until?.toISOString() ?? undefined,
        ai_paused_by: pauseState?.paused_by ?? undefined,
      });
      return;
    }
    const pauseState = await getAiPauseState(barbershopId);
    res.json({
      connected: row.status === "connected",
      status: row.status,
      provider: row.provider,
      whatsapp_phone: row.whatsapp_phone ?? undefined,
      connected_at: row.connected_at ?? undefined,
      last_error: row.last_error ?? undefined,
      ai_paused_until: pauseState?.paused_until?.toISOString() ?? undefined,
      ai_paused_by: pauseState?.paused_by ?? undefined,
    });
  } catch (e) {
    console.error("whatsapp get:", e);
    res.status(500).json({ error: "Failed to get WhatsApp connection" });
  }
});

/** GET /api/integrations/whatsapp/number-mode — modo do número (account_wide | per_branch) e filiais da conta */
whatsappRouter.get("/number-mode", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const accountRow = await pool.query<{ account_id: string | null }>(
      "SELECT account_id FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const accountId = accountRow.rows[0]?.account_id ?? null;
    if (!accountId) {
      res.json({
        mode: "per_branch" as const,
        primary_barbershop_id: null,
        barbershops: [{ id: barbershopId, name: "Barbearia" }],
      });
      return;
    }
    const accRow = await pool.query<{
      whatsapp_number_mode: string;
      whatsapp_primary_barbershop_id: string | null;
    }>(
      `SELECT whatsapp_number_mode, whatsapp_primary_barbershop_id
       FROM public.accounts WHERE id = $1`,
      [accountId]
    );
    const mode = (accRow.rows[0]?.whatsapp_number_mode === "account_wide"
      ? "account_wide"
      : "per_branch") as "account_wide" | "per_branch";
    const primaryBarbershopId = accRow.rows[0]?.whatsapp_primary_barbershop_id ?? null;
    const branchesRow = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM public.barbershops WHERE account_id = $1 ORDER BY name`,
      [accountId]
    );
    res.json({
      mode,
      primary_barbershop_id: primaryBarbershopId ?? undefined,
      barbershops: branchesRow.rows,
    });
  } catch (e) {
    console.error("whatsapp number-mode get:", e);
    res.status(500).json({ error: "Failed to get number mode" });
  }
});

const numberModeBody = z.object({
  mode: z.enum(["account_wide", "per_branch"]),
  primary_barbershop_id: z.string().uuid().nullable().optional(),
});

/** PUT /api/integrations/whatsapp/number-mode — define modo e barbershop primário (quando account_wide) */
whatsappRouter.put("/number-mode", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = numberModeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { mode, primary_barbershop_id } = parsed.data;
    const accountRow = await pool.query<{ account_id: string | null }>(
      "SELECT account_id FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const accountId = accountRow.rows[0]?.account_id ?? null;
    if (!accountId) {
      res.status(400).json({ error: "Barbershop has no account" });
      return;
    }
    if (mode === "account_wide" && primary_barbershop_id) {
      const sameAccount = await pool.query<{ id: string }>(
        "SELECT id FROM public.barbershops WHERE id = $1 AND account_id = $2",
        [primary_barbershop_id, accountId]
      );
      if (sameAccount.rows.length === 0) {
        res.status(400).json({ error: "primary_barbershop_id must belong to the same account" });
        return;
      }
    }
    await pool.query(
      `UPDATE public.accounts
       SET whatsapp_number_mode = $1,
           whatsapp_primary_barbershop_id = $2,
           updated_at = now()
       WHERE id = $3`,
      [mode, mode === "account_wide" ? primary_barbershop_id ?? null : null, accountId]
    );
    res.json({ mode, primary_barbershop_id: primary_barbershop_id ?? undefined });
  } catch (e) {
    console.error("whatsapp number-mode put:", e);
    res.status(500).json({ error: "Failed to update number mode" });
  }
});

/** POST /api/integrations/whatsapp/assume — handoff manual: pausar IA (atendente assume) */
whatsappRouter.post("/assume", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    await setAiPaused(barbershopId, { pausedBy: "manual", reason: "Atendente assumiu" });
    res.json({ ok: true, message: "IA pausada. Você pode atender manualmente." });
  } catch (e) {
    console.error("whatsapp assume:", e);
    res.status(500).json({ error: "Falha ao pausar IA" });
  }
});

/** POST /api/integrations/whatsapp/resume — retomar IA após handoff */
whatsappRouter.post("/resume", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    await clearAiPause(barbershopId);
    res.json({ ok: true, message: "IA retomada." });
  } catch (e) {
    console.error("whatsapp resume:", e);
    res.status(500).json({ error: "Falha ao retomar IA" });
  }
});

/** POST /api/integrations/whatsapp/conversations/:id/assume — handoff por conversa: pausar IA para esta conversa */
whatsappRouter.post("/conversations/:id/assume", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM public.ai_conversations WHERE id = $1 AND barbershop_id = $2`,
      [conversationId, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    const pauseHours = await getConversationPauseHours(barbershopId);
    await setConversationPaused(conversationId, { pausedBy: "manual", reason: "Atendente assumiu", hours: pauseHours });
    await pool.query(
      `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
       VALUES ($1, $2, 'paused', 'manual', $3)`,
      [barbershopId, conversationId, "Atendente assumiu"]
    );
    console.info("[whatsapp inbox] handoff assume conversationId=%s barbershopId=%s", conversationId, barbershopId);
    res.json({ ok: true, message: "Conversa assumida. IA pausada para este contato." });
  } catch (e) {
    console.error("whatsapp conversations assume:", e);
    res.status(500).json({ error: "Falha ao assumir conversa" });
  }
});

/** POST /api/integrations/whatsapp/conversations/:id/resume — retomar IA para esta conversa */
whatsappRouter.post("/conversations/:id/resume", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM public.ai_conversations WHERE id = $1 AND barbershop_id = $2`,
      [conversationId, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    await clearConversationPause(conversationId);
    await pool.query(
      `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
       VALUES ($1, $2, 'resumed', 'manual', $3)`,
      [barbershopId, conversationId, "Atendente retomou"]
    );
    console.info("[whatsapp inbox] handoff resume conversationId=%s barbershopId=%s", conversationId, barbershopId);
    res.json({ ok: true, message: "IA retomada para este contato." });
  } catch (e) {
    console.error("whatsapp conversations resume:", e);
    res.status(500).json({ error: "Falha ao retomar conversa" });
  }
});

const startConversationBody = z.object({
  client_id: z.string().uuid().optional(),
  phone: z.string().min(1).max(30).optional(),
}).refine((v) => !!v.client_id || !!v.phone, {
  message: "client_id ou phone é obrigatório",
});

/** POST /api/integrations/whatsapp/conversations/start — inicia nova conversa (por cliente da base ou telefone) */
whatsappRouter.post("/conversations/start", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = startConversationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    let phoneRaw: string | null = parsed.data.phone ?? null;

    if (parsed.data.client_id) {
      const r = await pool.query<{ phone: string | null }>(
        `SELECT phone FROM public.clients WHERE id = $1 AND barbershop_id = $2`,
        [parsed.data.client_id, barbershopId]
      );
      phoneRaw = r.rows[0]?.phone ?? null;
      if (!phoneRaw) {
        res.status(400).json({ error: "Cliente sem telefone cadastrado" });
        return;
      }
    }

    const phoneDigits = normalizePhoneDigits(phoneRaw);
    if (!phoneDigits || phoneDigits.length < 8 || phoneDigits.length > 15) {
      res.status(400).json({ error: "Telefone inválido para iniciar conversa" });
      return;
    }
    const canonicalPhone = canonicalizeBrPhoneDigits(phoneDigits) ?? phoneDigits;

    const ins = await pool.query<{ id: string; created: boolean }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, updated_at)
       VALUES ($1, 'whatsapp', $2, now())
       ON CONFLICT (barbershop_id, channel, external_thread_id)
       DO UPDATE SET updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [barbershopId, canonicalPhone]
    );
    const row = ins.rows[0];
    res.json({ conversation_id: row!.id, created: row!.created, external_thread_id: canonicalPhone });
  } catch (e) {
    console.error("whatsapp conversation start:", e);
    res.status(500).json({ error: "Falha ao iniciar conversa" });
  }
});

/** DELETE /api/integrations/whatsapp/conversations/:id — deleta conversa e histórico */
whatsappRouter.delete("/conversations/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const del = await pool.query<{ id: string }>(
      `DELETE FROM public.ai_conversations
       WHERE id = $1 AND barbershop_id = $2 AND channel = 'whatsapp'
       RETURNING id`,
      [conversationId, barbershopId]
    );
    if (del.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("whatsapp conversation delete:", e);
    res.status(500).json({ error: "Falha ao deletar conversa" });
  }
});

/** GET /api/integrations/whatsapp/conversations — inbox interno com últimas conversas do WhatsApp */
whatsappRouter.get("/conversations", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
    const search = String(req.query.search ?? "").trim();
    const statusFilter = req.query.status === "manual" ? "manual" : req.query.status === "ai" ? "ai" : null;
    const updatedSince = typeof req.query.updated_since === "string" ? req.query.updated_since.trim() : null;
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);

    const searchDigits = search.replace(/\D/g, "");
    const searchMatchKeys = searchDigits.length >= 8 ? brPhoneMatchKeys(searchDigits) : [];
    // Placeholder válido UTF-8 que nunca casa com telefone (evita "invalid byte sequence 0x00" e inferência de tipo de $3)
    const searchMatchKeysParam = searchMatchKeys.length > 0 ? searchMatchKeys : ["__no_phone_match__"];

    const statusCondition =
      statusFilter === "manual"
        ? "AND cr.paused_until IS NOT NULL AND cr.paused_until > now()"
        : statusFilter === "ai"
          ? "AND (cr.paused_until IS NULL OR cr.paused_until <= now())"
          : "";
    const updatedSinceCondition = updatedSince ? "AND (c.last_message_at >= $4::timestamptz OR c.updated_at >= $4::timestamptz)" : "";
    // COALESCE força o tipo de $3 para text[] (evita "could not determine data type of parameter $3")
    const searchPhoneCondition = "OR (regexp_replace(c.external_thread_id, '[^0-9]', '', 'g') = ANY(COALESCE($3::text[], ARRAY[]::text[])))";
    const params: (string | number | string[])[] = [barbershopId, search, searchMatchKeysParam];
    if (updatedSince) params.push(updatedSince);
    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const q = await pool.query<{
      id: string;
      external_thread_id: string;
      last_message_at: string | null;
      updated_at: string;
      paused_until: string | null;
      paused_by: string | null;
      client_name: string | null;
      client_phone: string | null;
      last_role: "user" | "assistant" | "tool" | null;
      last_content: string | null;
      last_created_at: string | null;
    }>(
      `SELECT
         c.id,
         c.external_thread_id,
         c.last_message_at,
         c.updated_at,
         cr.paused_until::text AS paused_until,
         cr.paused_by,
         cl.name AS client_name,
         cl.phone AS client_phone,
         lm.role::text AS last_role,
         lm.content AS last_content,
         lm.created_at::text AS last_created_at
       FROM public.ai_conversations c
       LEFT JOIN public.ai_conversation_runtime cr ON cr.conversation_id = c.id
       LEFT JOIN public.clients cl
         ON cl.barbershop_id = c.barbershop_id
        AND regexp_replace(cl.phone, '[^0-9]', '', 'g') = c.external_thread_id
       LEFT JOIN LATERAL (
         SELECT m.role, m.content, m.created_at
         FROM public.ai_messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) lm ON true
       WHERE c.barbershop_id = $1
         AND c.channel = 'whatsapp'
         AND (
           $2::text = ''
           OR coalesce(cl.name, '') ILIKE '%' || $2 || '%'
           OR c.external_thread_id LIKE '%' || regexp_replace($2, '[^0-9]', '', 'g') || '%'
           OR coalesce(cl.phone, '') LIKE '%' || $2 || '%'
           ${searchPhoneCondition}
         )
         ${statusCondition}
         ${updatedSinceCondition}
       ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const canonicalToBest = new Map<string, (typeof q.rows)[0]>();
    for (const row of q.rows) {
      const canonical = canonicalizeBrPhoneDigits(row.external_thread_id) ?? row.external_thread_id;
      const existing = canonicalToBest.get(canonical);
      const rowTime = row.last_message_at ?? row.updated_at ?? "";
      const existingTime = existing ? (existing.last_message_at ?? existing.updated_at ?? "") : "";
      if (!existing || rowTime > existingTime) {
        canonicalToBest.set(canonical, row);
      }
    }
    const dedupedRows = [...canonicalToBest.values()].sort((a, b) => {
      const at = a.last_message_at ?? a.updated_at ?? "";
      const bt = b.last_message_at ?? b.updated_at ?? "";
      return bt.localeCompare(at);
    });

    let clientByThreadId: Map<string, { name: string | null; phone: string | null }> | null = null;
    const needTolerantMatch = dedupedRows.some((r) => !r.client_name && !r.client_phone);
    if (needTolerantMatch) {
      const clients = await pool.query<{ name: string | null; phone: string | null }>(
        `SELECT name, phone FROM public.clients WHERE barbershop_id = $1`,
        [barbershopId]
      );
      clientByThreadId = new Map();
      for (const row of dedupedRows) {
        if (row.client_name != null || row.client_phone != null) continue;
        const found = clients.rows.find((cl) => brPhonesMatch(row.external_thread_id, cl.phone));
        if (found) clientByThreadId.set(row.id, { name: found.name, phone: found.phone });
      }
    }

    res.json({
      conversations: dedupedRows.map((row) => {
        let client_name = row.client_name ?? undefined;
        let client_phone = row.client_phone ?? undefined;
        if ((client_name == null && client_phone == null) && clientByThreadId) {
          const tolerant = clientByThreadId.get(row.id);
          if (tolerant) {
            client_name = tolerant.name ?? undefined;
            client_phone = tolerant.phone ?? undefined;
          }
        }
        const canonical_thread_id = canonicalizeBrPhoneDigits(row.external_thread_id) ?? row.external_thread_id;
        return {
          id: row.id,
          external_thread_id: row.external_thread_id,
          canonical_thread_id,
          last_message_at: row.last_message_at ?? undefined,
          paused_until: row.paused_until ?? null,
          paused_by: row.paused_by ?? null,
          client_name,
          client_phone,
          last_message:
            row.last_role && row.last_content
              ? {
                  role: row.last_role,
                  content: row.last_content,
                  created_at: row.last_created_at ?? row.updated_at,
                }
              : undefined,
        };
      }),
    });
  } catch (e) {
    console.error("whatsapp conversations list:", e);
    res.status(500).json({ error: "Falha ao listar conversas" });
  }
});

/** GET /api/integrations/whatsapp/conversations/:id/messages — histórico de uma conversa */
whatsappRouter.get("/conversations/:id/messages", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const limit = Math.min(parseInt(String(req.query.limit ?? "200"), 10) || 200, 1000);
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const conv = await pool.query<{ id: string }>(
      `SELECT id FROM public.ai_conversations WHERE id = $1 AND barbershop_id = $2 AND channel = 'whatsapp'`,
      [conversationId, barbershopId]
    );
    if (conv.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    const msgs = await pool.query<{
      id: string;
      role: "user" | "assistant" | "tool";
      content: string | null;
      created_at: string;
      tool_name: string | null;
      provider_message_id: string | null;
      delivery_status: string | null;
      delivered_at: string | null;
    }>(
      `SELECT id, role::text AS role, content, created_at::text AS created_at, tool_name,
              provider_message_id, delivery_status, delivered_at::text AS delivered_at
       FROM public.ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );
    res.json({
      messages: msgs.rows
        .reverse()
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content ?? "",
          created_at: m.created_at,
          tool_name: m.tool_name ?? undefined,
          provider_message_id: m.provider_message_id ?? undefined,
          delivery_status: m.delivery_status ?? undefined,
          delivered_at: m.delivered_at ?? undefined,
        })),
    });
  } catch (e) {
    console.error("whatsapp conversation messages:", e);
    res.status(500).json({ error: "Falha ao carregar histórico" });
  }
});

/** POST /api/integrations/whatsapp/conversations/:id/sync — sincroniza mensagens do WhatsApp (Uazapi message/find) */
whatsappRouter.post("/conversations/:id/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const conv = await pool.query<{ id: string; external_thread_id: string }>(
      `SELECT id, external_thread_id FROM public.ai_conversations
       WHERE id = $1 AND barbershop_id = $2 AND channel = 'whatsapp'`,
      [conversationId, barbershopId]
    );
    if (conv.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    const conn = await pool.query<{ uazapi_instance_token_encrypted: string | null }>(
      `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [barbershopId]
    );
    const enc = conn.rows[0]?.uazapi_instance_token_encrypted ?? null;
    if (!enc) {
      res.status(409).json({ error: "WhatsApp não conectado para sincronizar." });
      return;
    }
    const token = decrypt(enc, getEncryptionKey());
    const threadId = conv.rows[0].external_thread_id.replace(/\D/g, "") || conv.rows[0].external_thread_id;
    const chatid = `${threadId}@s.whatsapp.net`;
    const result = await findMessages({ token, chatid, limit: 100, offset: 0 });
    const raw = (result.messages ?? []) as Array<{ id?: string; body?: string; fromMe?: boolean; timestamp?: number }>;
    const existing = await pool.query<{ provider_message_id: string }>(
      `SELECT provider_message_id FROM public.ai_messages WHERE conversation_id = $1 AND provider_message_id IS NOT NULL`,
      [conversationId]
    );
    const existingSet = new Set(existing.rows.map((r) => r.provider_message_id));
    let inserted = 0;
    const toInsert = raw.filter((m) => {
      const pid = m.id != null ? String(m.id) : null;
      return pid && !existingSet.has(pid) && (m.body != null || (m as { text?: string }).text != null);
    });
    const contentKey = (m: { body?: string; text?: string }) => (m.body != null ? String(m.body) : (m as { text?: string }).text != null ? String((m as { text: string }).text) : "");
    for (const m of toInsert) {
      const pid = String(m.id!);
      const role = m.fromMe ? "assistant" : "user";
      const content = contentKey(m as { body?: string; text?: string });
      const createdAt = m.timestamp ? new Date(m.timestamp * 1000).toISOString() : new Date().toISOString();
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [conversationId, role, content.slice(0, 64 * 1024), pid, createdAt]
      );
      inserted++;
    }
    if (toInsert.length > 0 && inserted > 0) {
      await pool.query(
        `UPDATE public.ai_conversations SET last_message_at = now(), updated_at = now() WHERE id = $1`,
        [conversationId]
      );
    }
    const lastSyncedAt = new Date().toISOString();
    res.json({ inserted, last_synced_at: lastSyncedAt });
  } catch (e) {
    console.error("whatsapp conversation sync:", e);
    res.status(500).json({ error: "Falha ao sincronizar histórico" });
  }
});

const sendManualConversationBody = z.object({
  text: z.string().min(1).max(4096),
});

/** POST /api/integrations/whatsapp/conversations/:id/send-manual — envia mensagem manual pelo WhatsApp interno */
whatsappRouter.post("/conversations/:id/send-manual", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const parsed = sendManualConversationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const conv = await pool.query<{ id: string; external_thread_id: string }>(
      `SELECT id, external_thread_id
       FROM public.ai_conversations
       WHERE id = $1 AND barbershop_id = $2 AND channel = 'whatsapp'`,
      [conversationId, barbershopId]
    );
    const row = conv.rows[0];
    if (!row) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    const conn = await pool.query<{ uazapi_instance_token_encrypted: string | null }>(
      `SELECT uazapi_instance_token_encrypted
       FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [barbershopId]
    );
    const enc = conn.rows[0]?.uazapi_instance_token_encrypted ?? null;
    if (!enc) {
      res.status(409).json({ error: "WhatsApp não conectado para envio manual." });
      return;
    }
    const token = decrypt(enc, getEncryptionKey());
    const text = parsed.data.text.trim();
    const sent = await sendText({ token, number: row.external_thread_id, text });
    const any = sent as Record<string, unknown> | null;
    const providerMessageId =
      any && typeof any === "object"
        ? (typeof any.messageId === "string" && any.messageId.trim()
            ? any.messageId.trim()
            : typeof any.id === "string" && any.id.trim()
            ? any.id.trim()
            : typeof any.message_id === "string" && any.message_id.trim()
            ? any.message_id.trim()
            : null)
        : null;

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id, delivery_status)
       VALUES ($1, 'assistant', $2, $3, 'sent')
       RETURNING id`,
      [conversationId, text, providerMessageId]
    );
    await pool.query(
      `UPDATE public.ai_conversations
       SET last_message_at = now(), updated_at = now()
       WHERE id = $1`,
      [conversationId]
    );

    // Manual outbound implies human takeover for this conversation.
    const pauseHours = await getConversationPauseHours(barbershopId);
    await setConversationPaused(conversationId, {
      pausedBy: "manual",
      reason: "Mensagem enviada pelo WhatsApp interno",
      hours: pauseHours,
    });
    await pool.query(
      `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
       VALUES ($1, $2, 'paused', 'manual', $3)`,
      [barbershopId, conversationId, "Mensagem enviada pelo WhatsApp interno"]
    ).catch(() => {});

    console.info("[whatsapp inbox] send-manual conversationId=%s barbershopId=%s messageId=%s", conversationId, barbershopId, inserted.rows[0]?.id ?? "");
    res.json({ ok: true, message_id: inserted.rows[0]?.id ?? "" });
  } catch (e) {
    console.error("whatsapp conversation send-manual:", e);
    res.status(500).json({ error: "Falha ao enviar mensagem manual" });
  }
});

const patchContactBody = z.object({
  name: z.string().min(0).max(500).optional(),
  phone: z.string().min(0).max(30).optional(),
  notes: z.string().max(2000).optional(),
});

/** GET /api/integrations/whatsapp/conversations/:id/contact — dados do contato ligado à conversa (client por telefone) */
whatsappRouter.get("/conversations/:id/contact", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const conv = await pool.query<{ external_thread_id: string }>(
      `SELECT external_thread_id FROM public.ai_conversations WHERE id = $1 AND barbershop_id = $2 AND channel = 'whatsapp'`,
      [conversationId, barbershopId]
    );
    if (conv.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    const threadId = conv.rows[0].external_thread_id;
    const matchKeys = brPhoneMatchKeys(threadId);
    const client = await pool.query<{ id: string; name: string | null; phone: string | null; notes: string | null }>(
      `SELECT id, name, phone, notes FROM public.clients
       WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[]) LIMIT 1`,
      [barbershopId, matchKeys]
    );
    const row = client.rows[0];
    if (!row) {
      res.json({ contact: null, fallback_phone: conv.rows[0].external_thread_id });
      return;
    }
    res.json({
      contact: {
        id: row.id,
        name: row.name ?? undefined,
        phone: row.phone ?? undefined,
        notes: row.notes ?? undefined,
      },
      fallback_phone: conv.rows[0].external_thread_id,
    });
  } catch (e) {
    console.error("whatsapp conversation contact get:", e);
    res.status(500).json({ error: "Falha ao carregar contato" });
  }
});

/** PATCH /api/integrations/whatsapp/conversations/:id/contact — atualiza ou cria contato ligado à conversa */
whatsappRouter.patch("/conversations/:id/contact", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const conversationId = req.params.id;
    const parsed = patchContactBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const conv = await pool.query<{ external_thread_id: string }>(
      `SELECT external_thread_id FROM public.ai_conversations WHERE id = $1 AND barbershop_id = $2 AND channel = 'whatsapp'`,
      [conversationId, barbershopId]
    );
    if (conv.rows.length === 0) {
      res.status(404).json({ error: "Conversa não encontrada" });
      return;
    }
    const threadId = conv.rows[0].external_thread_id;
    const matchKeys = brPhoneMatchKeys(threadId);
    const existing = await pool.query<{ id: string; name: string | null; phone: string | null; notes: string | null }>(
      `SELECT id, name, phone, notes FROM public.clients
       WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[]) LIMIT 1`,
      [barbershopId, matchKeys]
    );
    const { name, phone, notes } = parsed.data;
    const normalizedNewPhone = phone != null && phone.trim() ? phone.replace(/\D/g, "") || phone.trim() : null;
    const threadPhoneDigits = threadId.replace(/\D/g, "") || threadId;

    if (existing.rows.length === 0) {
      const ins = await pool.query<{ id: string; name: string | null; phone: string | null; notes: string | null }>(
        `INSERT INTO public.clients (barbershop_id, name, phone, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = coalesce(nullif(trim(EXCLUDED.name), ''), clients.name), notes = EXCLUDED.notes, updated_at = now()
         RETURNING id, name, phone, notes`,
        [barbershopId, (name ?? "").trim() || "Cliente", threadPhoneDigits, (notes ?? "").trim() || null]
      );
      const row = ins.rows[0];
      res.json({
        contact: {
          id: row!.id,
          name: row!.name ?? undefined,
          phone: row!.phone ?? undefined,
          notes: row!.notes ?? undefined,
        },
      });
      return;
    }

    const updates: string[] = [];
    const params: (string | null)[] = [];
    let idx = 1;
    if (name !== undefined) {
      updates.push(`name = $${idx}`);
      params.push((name ?? "").trim() || null);
      idx++;
    }
    if (normalizedNewPhone !== undefined) {
      updates.push(`phone = $${idx}`);
      params.push(normalizedNewPhone || existing.rows[0].phone);
      idx++;
    }
    if (notes !== undefined) {
      updates.push(`notes = $${idx}`);
      params.push((notes ?? "").trim() || null);
      idx++;
    }
    if (updates.length === 0) {
      const row = existing.rows[0];
      res.json({
        contact: {
          id: row.id,
          name: row.name ?? undefined,
          phone: row.phone ?? undefined,
          notes: row.notes ?? undefined,
        },
      });
      return;
    }
    params.push(existing.rows[0].id);
    const r = await pool.query<{ id: string; name: string | null; phone: string | null; notes: string | null }>(
      `UPDATE public.clients SET ${updates.join(", ")}, updated_at = now() WHERE id = $${idx} RETURNING id, name, phone, notes`,
      params
    );
    const row = r.rows[0];
    res.json({
      contact: row
        ? {
            id: row.id,
            name: row.name ?? undefined,
            phone: row.phone ?? undefined,
            notes: row.notes ?? undefined,
          }
        : undefined,
    });
  } catch (e) {
    console.error("whatsapp conversation contact patch:", e);
    res.status(500).json({ error: "Falha ao atualizar contato" });
  }
});

/** GET /api/integrations/whatsapp/usage — uso de mensagens IA no mês (limites soft/hard) */
whatsappRouter.get("/usage", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const usage = await getUsageAndLimit(barbershopId);
    res.json(usage);
  } catch (e) {
    console.error("whatsapp usage:", e);
    res.status(500).json({ error: "Falha ao obter uso" });
  }
});

/** GET /api/integrations/whatsapp/uazapi/connectivity — testa se a API alcança a Uazapi (front -> api -> uazapi). */
whatsappRouter.get("/uazapi/connectivity", async (_req: Request, res: Response): Promise<void> => {
  try {
    const uazapi = await pingUazapi();
    res.json({ api: "ok", uazapi });
  } catch (e) {
    res.status(500).json({
      api: "ok",
      uazapi: { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
    });
  }
});

/** POST /api/integrations/whatsapp/uazapi/start — cria instância (se não existir), seta webhook, inicia conexão */
whatsappRouter.post("/uazapi/start", async (req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const barbershopId = getBarbershopId(req);
    const body = z.object({ phone: z.string().optional() }).safeParse(req.body);
    const phone = body.success ? body.data.phone : undefined;

    const webhookUrl = config.uazapiWebhookPublicUrl;
    if (!webhookUrl) {
      res.status(503).json({ error: "UAZAPI_WEBHOOK_PUBLIC_URL is not configured" });
      return;
    }

    const row = (
      await pool.query<ConnectionRow>(
        `SELECT id, uazapi_instance_name, uazapi_instance_token_encrypted, status
         FROM public.barbershop_whatsapp_connections
         WHERE barbershop_id = $1 AND provider = 'uazapi'`,
        [barbershopId]
      )
    ).rows[0];

    let token: string;

    if (!row) {
      const instanceName = `bh-${barbershopId.replace(/-/g, "").slice(0, 24)}`;
      let created: { token: string; name?: string; id?: string; instanceId?: string };
      try {
        created = await adminCreateInstance({
          name: instanceName,
          adminField01: barbershopId,
        }) as { token: string; name?: string; id?: string; instanceId?: string };
      } catch (initErr) {
        if (is429MaxInstances(initErr)) {
          res.status(409).json({
            error: "Limite de instâncias na Uazapi atingido.",
            code: "UAZAPI_MAX_INSTANCES",
            hint: "Desconecte uma instância antiga no painel da Uazapi ou use 'Vincular instância existente' informando o token da instância que já está conectada.",
          });
          return;
        }
        throw initErr;
      }
      token = created.token;
      const instanceId = created.instanceId != null ? String(created.instanceId) : created.id != null ? String(created.id) : null;
      const encKey = getEncryptionKey();
      await pool.query(
        `INSERT INTO public.barbershop_whatsapp_connections
         (barbershop_id, provider, uazapi_instance_name, uazapi_instance_id, uazapi_instance_token_encrypted, status, updated_at)
         VALUES ($1, 'uazapi', $2, $3, $4, 'disconnected', now())`,
        [barbershopId, instanceName, instanceId, encrypt(token, encKey)]
      );
    } else {
      const encKey = getEncryptionKey();
      if (!row.uazapi_instance_token_encrypted) {
        res.status(400).json({ error: "Connection exists but token is missing" });
        return;
      }
      token = decrypt(row.uazapi_instance_token_encrypted, encKey);
    }

    let webhookSet = false;
    try {
      await setWebhook({ token, url: webhookUrl });
      webhookSet = true;
    } catch (webhookErr) {
      const webhookErrMsg = webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
      console.warn("whatsapp uazapi/start: setWebhook failed (continuing without webhook):", webhookErr);
      await pool.query(
        `UPDATE public.barbershop_whatsapp_connections
         SET last_error = $1, updated_at = now() WHERE barbershop_id = $2 AND provider = 'uazapi'`,
        [`Webhook não configurado: ${webhookErrMsg}`.slice(0, 500), barbershopId]
      ).catch(() => {});
      if (config.uazapiRequireWebhook) {
        res.status(503).json({
          error: "Não foi possível configurar o webhook da Uazapi. Mensagens recebidas não serão processadas.",
          code: "UAZAPI_WEBHOOK_FAILED",
          detail: webhookErrMsg,
          hint: "Configure o webhook manualmente no painel da Uazapi para: " + webhookUrl,
        });
        return;
      }
    }

    try {
      await instanceConnect({ token, phone: phone || undefined });
    } catch (connectErr) {
      if (is429MaxInstances(connectErr)) {
        res.status(409).json({
          error: "Limite de instâncias conectadas na Uazapi atingido.",
          code: "UAZAPI_MAX_INSTANCES",
          hint: "Desconecte uma instância antiga no painel da Uazapi (ex.: desconectar a instância que foi usada antes de zerar o banco). Depois tente 'Conectar' novamente ou use 'Vincular instância existente' com o token da instância já conectada.",
        });
        return;
      }
      throw connectErr;
    }

    const statusRes = await instanceStatus(token);
    const state = mapUazapiState(statusRes, "connecting");
    const connected = state === "connected";
    const connectedPhone = connected ? extractConnectedPhone(statusRes) : null;
    const phoneFromBody = phone ? normalizePhoneDigits(phone) : null;

    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = $1,
           connected_at = CASE WHEN $1 = 'connected' AND connected_at IS NULL THEN now() ELSE connected_at END,
           disconnected_at = CASE WHEN $1 = 'disconnected' THEN now() ELSE disconnected_at END,
           whatsapp_phone = CASE WHEN $1 = 'connected' THEN COALESCE(whatsapp_phone, $3, $4) ELSE whatsapp_phone END,
           last_error = NULL, updated_at = now()
       WHERE barbershop_id = $2 AND provider = 'uazapi'`,
      [state, barbershopId, connectedPhone, phoneFromBody]
    );

    const qr = (statusRes.instance?.qrcode ?? statusRes.qr) as string | undefined;
    const pairingCode = (statusRes.instance?.paircode ?? statusRes.pairingCode) as string | undefined;

    const payload: Record<string, unknown> = { status: state, qr, pairingCode, webhook_set: webhookSet };
    if (!webhookSet) {
      payload.webhook_warning =
        "Webhook não configurado automaticamente. Para receber mensagens, configure no painel da Uazapi a URL: " +
        webhookUrl;
    }
    res.json(payload);
  } catch (e) {
    console.error("whatsapp uazapi/start:", e);
    try {
      const bid = getBarbershopId(req);
      if (bid) {
        await pool.query(
          `UPDATE public.barbershop_whatsapp_connections
           SET last_error = $1, updated_at = now() WHERE barbershop_id = $2 AND provider = 'uazapi'`,
          [e instanceof Error ? e.message : "Unknown error", bid]
        ).catch(() => {});
      }
    } catch {
      // ignore update error when recording last_error
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to start connection" });
  }
});

const linkExistingBody = z.object({
  token: z.string().min(1, "token é obrigatório"),
  instance_name: z.string().optional(),
});

/** POST /api/integrations/whatsapp/uazapi/link-existing — vincula instância já existente (evita 429 ao zerar o banco) */
whatsappRouter.post("/uazapi/link-existing", async (req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const barbershopId = getBarbershopId(req);
    const parsed = linkExistingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const webhookUrl = config.uazapiWebhookPublicUrl;
    if (!webhookUrl) {
      res.status(503).json({ error: "UAZAPI_WEBHOOK_PUBLIC_URL is not configured" });
      return;
    }
    const token = parsed.data.token.trim();
    const statusRes = await instanceStatus(token);
    const instanceName =
      (statusRes.instance?.name as string) ?? (statusRes.instance?.instanceName as string)
      ?? parsed.data.instance_name ?? `bh-${barbershopId.replace(/-/g, "").slice(0, 24)}`;
    const instanceId =
      statusRes.instance?.id != null ? String(statusRes.instance.id)
      : (statusRes.instance?.instanceId as string | number) != null ? String((statusRes.instance as Record<string, unknown>).instanceId) : null;
    const encKey = getEncryptionKey();
    await pool.query(
      `INSERT INTO public.barbershop_whatsapp_connections
       (barbershop_id, provider, uazapi_instance_name, uazapi_instance_id, uazapi_instance_token_encrypted, status, last_error, updated_at)
       VALUES ($1, 'uazapi', $2, $3, $4, 'disconnected', NULL, now())
       ON CONFLICT (barbershop_id, provider) DO UPDATE SET
         uazapi_instance_name = COALESCE(EXCLUDED.uazapi_instance_name, barbershop_whatsapp_connections.uazapi_instance_name),
         uazapi_instance_id = COALESCE(EXCLUDED.uazapi_instance_id, barbershop_whatsapp_connections.uazapi_instance_id),
         uazapi_instance_token_encrypted = EXCLUDED.uazapi_instance_token_encrypted,
         last_error = NULL, updated_at = now()`,
      [barbershopId, instanceName, instanceId, encrypt(token, encKey)]
    );
    let webhookSet = false;
    try {
      await setWebhook({ token, url: webhookUrl });
      webhookSet = true;
    } catch (webhookErr) {
      const webhookErrMsg = webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
      console.warn("whatsapp uazapi/link-existing: setWebhook failed:", webhookErr);
      await pool.query(
        `UPDATE public.barbershop_whatsapp_connections
         SET last_error = $1, updated_at = now() WHERE barbershop_id = $2 AND provider = 'uazapi'`,
        [`Webhook não configurado: ${webhookErrMsg}`.slice(0, 500), barbershopId]
      ).catch(() => {});
      if (config.uazapiRequireWebhook) {
        res.status(503).json({
          error: "Não foi possível configurar o webhook da Uazapi.",
          code: "UAZAPI_WEBHOOK_FAILED",
          detail: webhookErrMsg,
          hint: "Configure o webhook manualmente no painel da Uazapi para: " + webhookUrl,
        });
        return;
      }
    }
    const state = mapUazapiState(statusRes, "disconnected");
    const connected = state === "connected";
    const connectedPhone = connected ? extractConnectedPhone(statusRes) : null;
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = $1,
           connected_at = CASE WHEN $1 = 'connected' AND connected_at IS NULL THEN now() ELSE connected_at END,
           disconnected_at = CASE WHEN $1 = 'disconnected' THEN now() ELSE disconnected_at END,
           whatsapp_phone = CASE WHEN $1 = 'connected' THEN COALESCE(whatsapp_phone, $3) ELSE whatsapp_phone END,
           updated_at = now()
       WHERE barbershop_id = $2 AND provider = 'uazapi'`,
      [state, barbershopId, connectedPhone]
    );
    res.json({
      ok: true,
      status: state,
      instance_name: instanceName,
      instance_id: instanceId ?? undefined,
      webhook_set: webhookSet,
      hint: state !== "connected" ? "Use 'Conectar' ou acesse status para exibir QR/pairing." : undefined,
    });
  } catch (e) {
    console.error("whatsapp uazapi/link-existing:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to link instance" });
  }
});

/** GET /api/integrations/whatsapp/uazapi/status — status atual + QR/pairing */
whatsappRouter.get("/uazapi/status", async (req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const barbershopId = getBarbershopId(req);
    const r = await pool.query<ConnectionRow>(
      `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [barbershopId]
    );
    const row = r.rows[0];
    if (!row?.uazapi_instance_token_encrypted) {
      res.status(404).json({ error: "No WhatsApp connection found" });
      return;
    }
    const token = decrypt(row.uazapi_instance_token_encrypted, getEncryptionKey());
    const statusRes = await instanceStatus(token);
    const state = mapUazapiState(statusRes, "disconnected");
    const qr = (statusRes.instance?.qrcode ?? statusRes.qr) as string | undefined;
    const pairingCode = (statusRes.instance?.paircode ?? statusRes.pairingCode) as string | undefined;

    const connected = state === "connected";
    const connectedPhone = connected ? extractConnectedPhone(statusRes) : null;
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = $1, connected_at = CASE WHEN $1 = 'connected' AND connected_at IS NULL THEN now() ELSE connected_at END,
           disconnected_at = CASE WHEN $1 = 'disconnected' THEN now() ELSE disconnected_at END,
           whatsapp_phone = CASE WHEN $1 = 'connected' THEN COALESCE(whatsapp_phone, $3) ELSE whatsapp_phone END,
           updated_at = now()
       WHERE barbershop_id = $2 AND provider = 'uazapi'`,
      [state, barbershopId, connectedPhone]
    );

    res.json({ status: state, connected, qr, pairingCode });
  } catch (e) {
    console.error("whatsapp uazapi/status:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to get status" });
  }
});

/** POST /api/integrations/whatsapp/uazapi/disconnect */
whatsappRouter.post("/uazapi/disconnect", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query<ConnectionRow>(
      `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [barbershopId]
    );
    const row = r.rows[0];
    if (!row?.uazapi_instance_token_encrypted) {
      res.status(404).json({ error: "No WhatsApp connection found" });
      return;
    }
    const token = decrypt(row.uazapi_instance_token_encrypted, getEncryptionKey());
    await instanceDisconnect(token);
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = 'disconnected', disconnected_at = now(), updated_at = now()
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [barbershopId]
    );
    res.json({ status: "disconnected" });
  } catch (e) {
    console.error("whatsapp uazapi/disconnect:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to disconnect" });
  }
});

const sendTestBody = z.object({ number: z.string().optional(), text: z.string().optional() });

/** POST /api/integrations/whatsapp/uazapi/send-test — envia mensagem de teste */
whatsappRouter.post("/uazapi/send-test", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = sendTestBody.safeParse(req.body);
    const number = parsed.success ? parsed.data.number : undefined;
    const text = (parsed.success ? parsed.data.text : undefined) ?? "Teste NavalhIA — integração WhatsApp ativa.";

    const r = await pool.query<ConnectionRow>(
      `SELECT uazapi_instance_token_encrypted, whatsapp_phone FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 AND provider = 'uazapi' AND status = 'connected'`,
      [barbershopId]
    );
    const row = r.rows[0];
    if (!row?.uazapi_instance_token_encrypted) {
      res.status(404).json({ error: "No connected WhatsApp found" });
      return;
    }
    const to = number ?? row.whatsapp_phone;
    if (!to) {
      res.status(400).json({ error: "Provide number or ensure connection has whatsapp_phone" });
      return;
    }
    const token = decrypt(row.uazapi_instance_token_encrypted, getEncryptionKey());
    await sendText({ token, number: to, text });
    res.json({ sent: true });
  } catch (e) {
    console.error("whatsapp uazapi/send-test:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to send test" });
  }
});

/** GET /api/integrations/whatsapp/ai-settings — config da IA de atendimento */
whatsappRouter.get("/ai-settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query<{
      enabled: boolean;
      timezone: string;
      model: string;
      model_premium: string | null;
      temperature: number;
      system_prompt_override: string | null;
      agent_profile: unknown;
      additional_instructions: string | null;
      active_prompt_version_id: string | null;
      max_output_tokens: number | null;
      typing_simulation: unknown;
      booking_buffer_minutes: number | null;
      updated_at: string;
    }>(
      `SELECT enabled, timezone, model, model_premium, temperature, system_prompt_override,
              agent_profile, additional_instructions, active_prompt_version_id, max_output_tokens, typing_simulation,
              COALESCE(booking_buffer_minutes, 0)::int AS booking_buffer_minutes, updated_at
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const row = r.rows[0];
    if (!row) {
      res.json({
        enabled: true,
        timezone: "America/Sao_Paulo",
        model: "gpt-4o-mini",
        model_premium: null,
        temperature: 0.7,
        system_prompt_override: null,
        agent_profile: {},
        additional_instructions: null,
        active_prompt_version_id: null,
        max_output_tokens: 350,
        typing_simulation: null,
        booking_buffer_minutes: 0,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    res.json({
      enabled: row.enabled,
      timezone: row.timezone,
      model: row.model,
      model_premium: row.model_premium ?? undefined,
      temperature: row.temperature,
      system_prompt_override: row.system_prompt_override ?? undefined,
      agent_profile: row.agent_profile ?? {},
      additional_instructions: row.additional_instructions ?? null,
      active_prompt_version_id: row.active_prompt_version_id ?? undefined,
      max_output_tokens: row.max_output_tokens ?? undefined,
      typing_simulation: row.typing_simulation ?? undefined,
      booking_buffer_minutes: row.booking_buffer_minutes ?? 0,
      updated_at: row.updated_at,
    });
  } catch (e) {
    console.error("whatsapp ai-settings get:", e);
    res.status(500).json({ error: "Failed to get AI settings" });
  }
});

const customRuleSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(5),
  when: z.object({
    intents: z.array(z.string().max(80)).max(10).optional(),
    keywords: z.array(z.string().max(80)).max(20).optional(),
    stages: z.array(z.string().max(80)).max(10).optional(),
  }).optional(),
  do: z.array(z.string().min(1).max(500)).min(1).max(15),
  dont: z.array(z.string().min(1).max(500)).max(10).optional(),
  examples: z.array(z.object({
    user: z.string().max(300),
    assistant: z.string().max(500),
  })).max(5).optional(),
});

const agentProfileSchema = z.object({
  tonePreset: z.string().optional(),
  emojiLevel: z.enum(["none", "low", "medium"]).optional(),
  slangLevel: z.enum(["low", "medium", "high"]).optional(),
  verbosity: z.enum(["short", "normal"]).optional(),
  salesStyle: z.enum(["soft", "direct"]).optional(),
  hardRules: z.record(z.unknown()).optional(),
  customRules: z.array(customRuleSchema).max(30).optional(),
  displayName: z.string().max(100).optional(),
  nickname: z.string().max(50).optional(),
  role: z.string().max(200).optional(),
  signMessages: z.boolean().optional(),
  signatureStyle: z.enum(["short", "full"]).optional(),
}).passthrough();

const typingSimulationSchema = z.object({
  enabled: z.boolean().optional(),
  baseDelayMs: z.number().int().min(0).max(10000).optional(),
  msPerChar: z.number().min(0).max(100).optional(),
  jitterMs: z.number().int().min(0).max(2000).optional(),
}).optional().nullable();

const aiSettingsBody = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().optional(),
  model: z.string().optional(),
  model_premium: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  system_prompt_override: z.string().nullable().optional(),
  agent_profile: agentProfileSchema.nullable().optional(),
  additional_instructions: z.string().nullable().optional(),
  max_output_tokens: z.number().int().min(50).max(4096).nullable().optional(),
  typing_simulation: typingSimulationSchema,
  booking_buffer_minutes: z.number().int().min(0).max(30).optional(),
});

/** PUT /api/integrations/whatsapp/ai-settings — atualiza config da IA */
whatsappRouter.put("/ai-settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = aiSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    if (data.additional_instructions != null) {
      const validation = validateAdditionalInstructions(data.additional_instructions);
      if (!validation.valid) {
        res.status(400).json({ error: "Instruções adicionais inválidas", errors: validation.errors });
        return;
      }
    }
    if (data.agent_profile != null && typeof data.agent_profile === "object") {
      const profile = normalizeProfile(data.agent_profile);
      const customValidation = validateCustomRules(profile.customRules);
      if (!customValidation.valid) {
        res.status(400).json({ error: "Regras customizadas inválidas", errors: customValidation.errors });
        return;
      }
    }
    const cur = await pool.query<{
      enabled: boolean; timezone: string; model: string; model_premium: string | null; temperature: number;
      system_prompt_override: string | null; agent_profile: unknown; additional_instructions: string | null;
      max_output_tokens: number | null; typing_simulation: unknown; booking_buffer_minutes: number | null;
    }>(
      `SELECT enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, max_output_tokens, typing_simulation, COALESCE(booking_buffer_minutes, 0)::int AS booking_buffer_minutes
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const current = cur.rows[0] ?? {
      enabled: true,
      timezone: "America/Sao_Paulo",
      model: "gpt-4o-mini",
      model_premium: null as string | null,
      temperature: 0.7,
      system_prompt_override: null as string | null,
      agent_profile: {} as unknown,
      additional_instructions: null as string | null,
      max_output_tokens: 350 as number | null,
      typing_simulation: null as unknown,
      booking_buffer_minutes: 0 as number | null,
    };
    const enabled = data.enabled ?? current.enabled;
    const timezone = data.timezone ?? current.timezone;
    const model = data.model ?? current.model;
    const model_premium = data.model_premium !== undefined ? data.model_premium : current.model_premium;
    const temperature = data.temperature ?? current.temperature;
    const system_prompt_override = data.system_prompt_override !== undefined ? data.system_prompt_override : current.system_prompt_override;
    const agent_profile = data.agent_profile !== undefined ? JSON.stringify(data.agent_profile ?? {}) : JSON.stringify((current.agent_profile as object) ?? {});
    const additional_instructions = data.additional_instructions !== undefined ? data.additional_instructions : current.additional_instructions;
    const max_output_tokens = data.max_output_tokens !== undefined ? data.max_output_tokens : current.max_output_tokens;
    const typing_simulation = data.typing_simulation !== undefined ? (data.typing_simulation == null ? null : JSON.stringify(data.typing_simulation)) : (current.typing_simulation != null ? JSON.stringify(current.typing_simulation) : null);
    const booking_buffer_minutes = data.booking_buffer_minutes !== undefined ? data.booking_buffer_minutes : (current.booking_buffer_minutes ?? 0);
    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, max_output_tokens, typing_simulation, booking_buffer_minutes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12, now())
       ON CONFLICT (barbershop_id) DO UPDATE SET
         enabled = $2, timezone = $3, model = $4, model_premium = $5, temperature = $6, system_prompt_override = $7,
         agent_profile = $8::jsonb, additional_instructions = $9, max_output_tokens = $10, typing_simulation = $11::jsonb, booking_buffer_minutes = $12, updated_at = now()`,
      [barbershopId, enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, max_output_tokens, typing_simulation, booking_buffer_minutes]
    );
    const r = await pool.query<{
      enabled: boolean; timezone: string; model: string; model_premium: string | null; temperature: number;
      system_prompt_override: string | null; agent_profile: unknown; additional_instructions: string | null;
      active_prompt_version_id: string | null; max_output_tokens: number | null; typing_simulation: unknown; booking_buffer_minutes: number | null; updated_at: string;
    }>(
      `SELECT enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, active_prompt_version_id, max_output_tokens, typing_simulation, COALESCE(booking_buffer_minutes, 0)::int AS booking_buffer_minutes, updated_at
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const row = r.rows[0]!;
    res.json({
      ...row,
      system_prompt_override: row.system_prompt_override ?? undefined,
      additional_instructions: row.additional_instructions ?? undefined,
      active_prompt_version_id: row.active_prompt_version_id ?? undefined,
      max_output_tokens: row.max_output_tokens ?? undefined,
      typing_simulation: row.typing_simulation ?? undefined,
      booking_buffer_minutes: row.booking_buffer_minutes ?? 0,
    });
  } catch (e) {
    console.error("whatsapp ai-settings put:", e);
    res.status(500).json({ error: "Failed to update AI settings" });
  }
});

/** POST /api/integrations/whatsapp/ai-settings/publish — publica perfil atual como nova versão ativa (account-wide se modo conta única) */
whatsappRouter.post("/ai-settings/publish", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const cur = await pool.query<{
      agent_profile: unknown;
      additional_instructions: string | null;
      enabled: boolean;
      timezone: string;
      model: string;
      model_premium: string | null;
      temperature: number;
      system_prompt_override: string | null;
      max_output_tokens: number | null;
      typing_simulation: unknown;
    }>(
      `SELECT agent_profile, additional_instructions, enabled, timezone, model, model_premium, temperature, system_prompt_override, max_output_tokens, typing_simulation
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const row = cur.rows[0];
    const agent_profile = row?.agent_profile ?? {};
    const additional_instructions = row?.additional_instructions ?? null;
    const profile = normalizeProfile(agent_profile);
    const customValidation = validateCustomRules(profile.customRules);
    if (!customValidation.valid) {
      res.status(400).json({ error: "Regras customizadas inválidas", errors: customValidation.errors });
      return;
    }
    const compiled = buildSystemPrompt({
      basePrompt: "{{TIMEZONE}} {{DATE_NOW}} {{BARBERSHOP_NAME}}",
      guardrails: "",
      profile,
      additionalInstructions: additional_instructions,
    }).slice(0, 2000);

    let settingsSnapshot: Record<string, unknown> | null = null;
    let knowledgeSnapshot: Record<string, unknown> | null = null;
    try {
      settingsSnapshot = {
        model: row?.model ?? "gpt-4o-mini",
        model_premium: row?.model_premium ?? null,
        temperature: row?.temperature ?? 0.7,
        max_output_tokens: row?.max_output_tokens ?? null,
        typing_simulation: row?.typing_simulation ?? null,
      };
      const handoffRow = await pool.query<{ enabled: boolean; pause_hours: number; handoff_message: string | null; resume_message: string | null }>(
        `SELECT enabled, pause_hours, handoff_message, resume_message FROM public.barbershop_ai_handoff_settings WHERE barbershop_id = $1`,
        [barbershopId]
      );
      if (handoffRow.rows[0]) {
        (settingsSnapshot as Record<string, unknown>).handoff = handoffRow.rows[0];
      }
      const docRows = await pool.query<{ id: string; source_id: string | null }>(
        `SELECT id, source_id FROM public.barbershop_ai_knowledge_documents WHERE barbershop_id = $1 AND status = 'ready'`,
        [barbershopId]
      );
      const sourceIds = [...new Set(docRows.rows.map((r) => r.source_id).filter(Boolean))] as string[];
      knowledgeSnapshot = {
        document_ids: docRows.rows.map((r) => r.id),
        source_ids: sourceIds,
      };
    } catch {
      // Tables may not exist
    }

    const accountRow = await pool.query<{ account_id: string | null }>(
      "SELECT account_id FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const accountId = accountRow.rows[0]?.account_id ?? null;
    let branchIds: string[] = [barbershopId];
    if (accountId) {
      const accRow = await pool.query<{ whatsapp_number_mode: string }>(
        "SELECT whatsapp_number_mode FROM public.accounts WHERE id = $1",
        [accountId]
      );
      if (accRow.rows[0]?.whatsapp_number_mode === "account_wide") {
        const branchesRow = await pool.query<{ id: string }>(
          "SELECT id FROM public.barbershops WHERE account_id = $1 ORDER BY name",
          [accountId]
        );
        branchIds = branchesRow.rows.map((r) => r.id);
      }
    }

    const agentProfileJson = JSON.stringify(agent_profile);
    const settingsSnapshotJson = JSON.stringify(settingsSnapshot);
    const knowledgeSnapshotJson = JSON.stringify(knowledgeSnapshot);
    const versionIds: string[] = [];
    const defaultEnabled = row?.enabled ?? true;
    const defaultTimezone = row?.timezone ?? "America/Sao_Paulo";
    const defaultModel = row?.model ?? "gpt-4o-mini";
    const defaultTemperature = row?.temperature ?? 0.7;
    const defaultSystemPromptOverride = row?.system_prompt_override ?? null;
    const defaultMaxOutputTokens = row?.max_output_tokens ?? null;
    const defaultTypingSimulation = row?.typing_simulation != null ? JSON.stringify(row.typing_simulation) : null;

    for (const bid of branchIds) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO public.barbershop_ai_prompt_versions (barbershop_id, agent_profile, additional_instructions, compiled_prompt_preview, status, settings_snapshot, knowledge_snapshot)
         VALUES ($1, $2::jsonb, $3, $4, 'active', $5::jsonb, $6::jsonb)
         RETURNING id`,
        [bid, agentProfileJson, additional_instructions, compiled, settingsSnapshotJson, knowledgeSnapshotJson]
      );
      const newId = ins.rows[0]!.id;
      versionIds.push(newId);
      await pool.query(
        `UPDATE public.barbershop_ai_prompt_versions SET status = 'rolled_back' WHERE barbershop_id = $1 AND status = 'active' AND id != $2`,
        [bid, newId]
      );
      await pool.query(
        `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, active_prompt_version_id, max_output_tokens, typing_simulation, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, now())
         ON CONFLICT (barbershop_id) DO UPDATE SET
           agent_profile = EXCLUDED.agent_profile,
           additional_instructions = EXCLUDED.additional_instructions,
           active_prompt_version_id = EXCLUDED.active_prompt_version_id,
           updated_at = now()`,
        [bid, defaultEnabled, defaultTimezone, defaultModel, row?.model_premium ?? null, defaultTemperature, defaultSystemPromptOverride, agentProfileJson, additional_instructions, newId, defaultMaxOutputTokens, defaultTypingSimulation]
      );
    }

    res.json({
      version_id: versionIds[0]!,
      status: "active",
      propagated: branchIds.length > 1 ? branchIds.length : undefined,
    });
  } catch (e) {
    console.error("whatsapp ai-settings publish:", e);
    res.status(500).json({ error: "Failed to publish" });
  }
});

const rollbackBody = z.object({ version_id: z.string().uuid() });

/** POST /api/integrations/whatsapp/ai-settings/rollback — reativa uma versão anterior */
whatsappRouter.post("/ai-settings/rollback", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = rollbackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "version_id (UUID) required", details: parsed.error.flatten() });
      return;
    }
    const versionId = parsed.data.version_id;
    const ver = await pool.query<{
      id: string;
      agent_profile: unknown;
      additional_instructions: string | null;
      settings_snapshot: unknown;
    }>(
      `SELECT id, agent_profile, additional_instructions, settings_snapshot FROM public.barbershop_ai_prompt_versions
       WHERE barbershop_id = $1 AND id = $2`,
      [barbershopId, versionId]
    );
    if (ver.rows.length === 0) {
      res.status(404).json({ error: "Version not found" });
      return;
    }
    const v = ver.rows[0]!;
    await pool.query(
      `UPDATE public.barbershop_ai_prompt_versions SET status = 'rolled_back' WHERE barbershop_id = $1 AND status = 'active'`,
      [barbershopId]
    );
    await pool.query(
      `UPDATE public.barbershop_ai_prompt_versions SET status = 'active' WHERE id = $1`,
      [versionId]
    );
    await pool.query(
      `UPDATE public.barbershop_ai_settings
       SET agent_profile = $1::jsonb, additional_instructions = $2, active_prompt_version_id = $3, updated_at = now()
       WHERE barbershop_id = $4`,
      [JSON.stringify(v.agent_profile ?? {}), v.additional_instructions, versionId, barbershopId]
    );
    const snap = v.settings_snapshot as Record<string, unknown> | null;
    if (snap && typeof snap === "object") {
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (snap.model != null) {
        updates.push(`model = $${idx++}`);
        values.push(snap.model);
      }
      if (snap.model_premium !== undefined) {
        updates.push(`model_premium = $${idx++}`);
        values.push(snap.model_premium);
      }
      if (typeof snap.temperature === "number") {
        updates.push(`temperature = $${idx++}`);
        values.push(snap.temperature);
      }
      if (snap.max_output_tokens !== undefined) {
        updates.push(`max_output_tokens = $${idx++}`);
        values.push(snap.max_output_tokens);
      }
      if (snap.typing_simulation !== undefined) {
        updates.push(`typing_simulation = $${idx++}::jsonb`);
        values.push(JSON.stringify(snap.typing_simulation));
      }
      if (updates.length > 0) {
        values.push(barbershopId);
        await pool.query(
          `UPDATE public.barbershop_ai_settings SET ${updates.join(", ")}, updated_at = now() WHERE barbershop_id = $${idx}`,
          values
        );
      }
    }
    res.json({ version_id: versionId, status: "active" });
  } catch (e) {
    console.error("whatsapp ai-settings rollback:", e);
    res.status(500).json({ error: "Failed to rollback" });
  }
});

/** GET /api/integrations/whatsapp/ai-settings/versions — lista versões de prompt */
whatsappRouter.get("/ai-settings/versions", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query<{ id: string; status: string; created_at: string; settings_snapshot: unknown; knowledge_snapshot: unknown }>(
      `SELECT id, status, created_at, settings_snapshot, knowledge_snapshot FROM public.barbershop_ai_prompt_versions
       WHERE barbershop_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [barbershopId]
    );
    res.json({
      versions: r.rows.map((row) => ({
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        settings_snapshot: row.settings_snapshot ?? undefined,
        knowledge_snapshot: row.knowledge_snapshot ?? undefined,
      })),
    });
  } catch (e) {
    console.error("whatsapp ai-settings versions:", e);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

const COMPILED_PROMPT_PREVIEW_MAX = 2000;

/** GET /api/integrations/whatsapp/ai-prompt/compiled — prompt compilado em execução (read-only, sem segredos) */
whatsappRouter.get("/ai-prompt/compiled", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const row = await pool.query<{
      agent_profile: unknown;
      additional_instructions: string | null;
      active_prompt_version_id: string | null;
    }>(
      `SELECT agent_profile, additional_instructions, active_prompt_version_id
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    ).then((r) => r.rows[0]);
    const agent_profile = row?.agent_profile ?? {};
    const additional_instructions = row?.additional_instructions ?? null;
    const active_prompt_version_id = row?.active_prompt_version_id ?? null;
    const profile = normalizeProfile(agent_profile);
    const { full, sections, section_lengths } = buildSystemPromptWithSections({
      basePrompt: DEFAULT_SYSTEM_PROMPT,
      guardrails: RUNTIME_GUARDRAILS,
      profile,
      additionalInstructions: additional_instructions,
    });
    const compiled_prompt_preview = full.slice(0, COMPILED_PROMPT_PREVIEW_MAX);
    res.json({
      compiled_prompt: full,
      compiled_prompt_preview,
      active_prompt_version_id,
      sections: {
        base: sections.base,
        style: sections.style ?? null,
        customRules: sections.customRules ?? null,
        additionalInstructions: sections.additionalInstructions ?? null,
        guardrails: sections.guardrails,
      },
      section_lengths,
    });
  } catch (e) {
    console.error("whatsapp ai-prompt compiled:", e);
    res.status(500).json({ error: "Failed to get compiled prompt" });
  }
});

const simulateBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  draft_profile: z.record(z.unknown()).nullable().optional(),
  draft_additional_instructions: z.string().nullable().optional(),
  debug: z.boolean().optional(),
});

/** POST /api/integrations/whatsapp/ai-simulate — simula chat com perfil rascunho (sandbox) */
whatsappRouter.post("/ai-simulate", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = simulateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { messages, draft_profile, draft_additional_instructions, debug } = parsed.data;
    if (draft_additional_instructions != null) {
      const validation = validateAdditionalInstructions(draft_additional_instructions);
      if (!validation.valid) {
        res.status(400).json({ error: "draft_additional_instructions invalid", errors: validation.errors });
        return;
      }
    }
    const openaiApiKey = config.openaiApiKey;
    if (!openaiApiKey) {
      res.status(503).json({ error: "OpenAI not configured" });
      return;
    }
    const openai = new OpenAI({ apiKey: openaiApiKey });
    const externalThreadId = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', $2, true) RETURNING id`,
      [barbershopId, externalThreadId]
    );
    const conversationId = conv.rows[0]!.id;
    for (const msg of messages) {
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [conversationId, msg.role, msg.content]
      );
    }
    const sandboxDraft =
      draft_profile != null && typeof draft_profile === "object"
        ? { agent_profile: draft_profile, additional_instructions: draft_additional_instructions ?? null }
        : undefined;
    const clientPhone = "5511999999999";
    const result = await runAgent(barbershopId, conversationId, clientPhone, openai, { sandboxDraft });
    const violations = detectViolations(result.reply);
    const payload: { reply: string; violations: string[]; usage?: unknown; debug?: { applied_rule_titles: string[] } } = {
      reply: result.reply,
      violations,
      usage: result.usage,
    };
    if (debug && sandboxDraft?.agent_profile != null) {
      const profile = normalizeProfile(sandboxDraft.agent_profile);
      payload.debug = { applied_rule_titles: getIncludedCustomRuleTitles(profile.customRules) };
    }
    res.json(payload);
  } catch (e) {
    console.error("whatsapp ai-simulate:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Simulation failed" });
  }
});

const scenarioExpectedSchema = z.object({
  violationsMax: z.number().int().min(0).optional(),
  mustContain: z.array(z.string().min(1).max(200)).max(10).optional(),
  mustNotContain: z.array(z.string().min(1).max(200)).max(10).optional(),
});

const simulateSuiteBody = z.object({
  scenarios: z.array(
    z.object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(120),
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1).max(20),
      expected: scenarioExpectedSchema.optional(),
    })
  ).min(1).max(20),
  draft_profile: z.record(z.unknown()).nullable().optional(),
  draft_additional_instructions: z.string().nullable().optional(),
});

/** POST /api/integrations/whatsapp/ai-simulate-suite — roda cenários e retorna pass/fail por cenário */
whatsappRouter.post("/ai-simulate-suite", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = simulateSuiteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { scenarios, draft_profile, draft_additional_instructions } = parsed.data;
    if (draft_additional_instructions != null) {
      const validation = validateAdditionalInstructions(draft_additional_instructions);
      if (!validation.valid) {
        res.status(400).json({ error: "draft_additional_instructions invalid", errors: validation.errors });
        return;
      }
    }
    const openaiApiKey = config.openaiApiKey;
    if (!openaiApiKey) {
      res.status(503).json({ error: "OpenAI not configured" });
      return;
    }
    const openai = new OpenAI({ apiKey: openaiApiKey });
    const sandboxDraft =
      draft_profile != null && typeof draft_profile === "object"
        ? { agent_profile: draft_profile, additional_instructions: draft_additional_instructions ?? null }
        : undefined;
    const clientPhone = "5511999999999";
    const results: Array<{
      scenario_id: string;
      label: string;
      reply: string;
      violations: string[];
      passed: boolean;
      checks?: { violationsMax?: boolean; mustContain?: boolean; mustNotContain?: boolean };
    }> = [];

    for (const scenario of scenarios) {
      const externalThreadId = `suite-${scenario.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const conv = await pool.query<{ id: string }>(
        `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
         VALUES ($1, 'whatsapp', $2, true) RETURNING id`,
        [barbershopId, externalThreadId]
      );
      const conversationId = conv.rows[0]!.id;
      for (const msg of scenario.messages) {
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
          [conversationId, msg.role, msg.content]
        );
      }
      const result = await runAgent(barbershopId, conversationId, clientPhone, openai, { sandboxDraft });
      const violations = detectViolations(result.reply);
      const expected = scenario.expected;
      let passed = true;
      const checks: { violationsMax?: boolean; mustContain?: boolean; mustNotContain?: boolean } = {};
      if (expected) {
        if (expected.violationsMax !== undefined) {
          checks.violationsMax = violations.length <= expected.violationsMax;
          if (!checks.violationsMax) passed = false;
        }
        if (expected.mustContain?.length) {
          const replyLower = result.reply.toLowerCase();
          checks.mustContain = expected.mustContain.every((s) => replyLower.includes(s.toLowerCase()));
          if (!checks.mustContain) passed = false;
        }
        if (expected.mustNotContain?.length) {
          const replyLower = result.reply.toLowerCase();
          checks.mustNotContain = !expected.mustNotContain.some((s) => replyLower.includes(s.toLowerCase()));
          if (!checks.mustNotContain) passed = false;
        }
      }
      results.push({
        scenario_id: scenario.id,
        label: scenario.label,
        reply: result.reply,
        violations,
        passed,
        checks: Object.keys(checks).length > 0 ? checks : undefined,
      });
    }

    const all_passed = results.every((r) => r.passed);
    res.json({ results, all_passed });
  } catch (e) {
    console.error("whatsapp ai-simulate-suite:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Suite run failed" });
  }
});

const analyzeChatBody = z.object({
  chat_text: z.string().min(1).max(40_000),
  objectives: z.array(z.string().min(1).max(120)).max(12).optional(),
});

const diagnosticMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12_000),
});

const diagnosticAttachmentSchema = z.object({
  name: z.string().min(1).max(180),
  mime_type: z.string().max(120).optional(),
  text: z.string().min(1).max(20_000),
});

const diagnosticChatBody = z.object({
  messages: z.array(diagnosticMessageSchema).min(1).max(40),
  objectives: z.array(z.string().min(1).max(120)).max(12).optional(),
  attachments: z.array(diagnosticAttachmentSchema).max(10).optional(),
});

type CustomRulesPatch = {
  add?: Array<Record<string, unknown>>;
  update?: Array<{ id: string; patch: Record<string, unknown> }>;
  disable?: string[];
};

type DiagnosticResult = {
  reply: string;
  recommended_profile_patch?: Record<string, unknown>;
  recommended_additional_instructions_patch?: string | null;
  recommended_custom_rules_patch?: CustomRulesPatch;
  risk_notes: string[];
  expected_outcomes: string[];
};

const INCIDENT_TYPES = [
  "double_booking",
  "ignored_availability",
  "asked_phone",
  "uuid_leak",
  "tone_issue",
  "wrong_policy",
  "hallucination",
] as const;

const incidentDiagnoseBody = z.object({
  incident_type: z.enum(INCIDENT_TYPES),
  manager_note: z.string().max(500).optional(),
  conversation_id: z.string().uuid().optional(),
  sandbox_conversation_id: z.string().optional(),
  prompt_version_id: z.string().uuid().optional().nullable(),
  settings_snapshot: z.object({
    agent_profile: z.record(z.unknown()).optional(),
    additional_instructions: z.string().nullable().optional(),
  }),
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(60),
  tool_trace: z
    .array(
      z.object({
        name: z.string(),
        args: z.record(z.unknown()).optional(),
        result: z.unknown().optional(),
      })
    )
    .max(20)
    .optional(),
});

type IncidentDiagnoseResult = {
  summary: string;
  question_to_confirm: string;
  recommended_profile_patch?: Record<string, unknown>;
  recommended_additional_instructions_patch?: string | null;
  recommended_custom_rules_patch?: CustomRulesPatch;
  suite_scenarios_to_run?: string[];
  risk_notes: string[];
};

const INCIDENT_TRANSCRIPT_MAX_CHARS = 12000;
const INCIDENT_TOOL_TRACE_ITEM_MAX = 400;

function truncateForIncident(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "...";
}

function fallbackDiagnosticResult(objectives: string[] | undefined): DiagnosticResult {
  const objectivesStr = (objectives ?? ["melhorar atendimento"]).join(", ").toLowerCase();
  const recommended_profile_patch: Record<string, unknown> = {};
  if (objectivesStr.includes("menos emoji") || objectivesStr.includes("emoji")) {
    recommended_profile_patch.emojiLevel = "low";
  }
  if (objectivesStr.includes("mais direto") || objectivesStr.includes("direto")) {
    recommended_profile_patch.verbosity = "short";
    recommended_profile_patch.salesStyle = "direct";
  }
  if (objectivesStr.includes("mais vendas")) {
    recommended_profile_patch.salesStyle = "direct";
  }
  return {
    reply:
      "Não consegui consultar o modelo agora. Apliquei uma sugestão de fallback baseada nos objetivos selecionados. Você pode ajustar manualmente e testar no simulador.",
    recommended_profile_patch:
      Object.keys(recommended_profile_patch).length > 0
        ? recommended_profile_patch
        : undefined,
    recommended_additional_instructions_patch: null,
    risk_notes: ["Fallback sem LLM ativo. Revise as mudanças antes de publicar."],
    expected_outcomes: ["Perfil ajustado com base nos objetivos."],
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

function normalizeRecommendedProfilePatch(
  value: unknown
): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const parsed = agentProfileSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const out = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as Record<string, unknown>;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeRecommendedCustomRulesPatch(value: unknown): CustomRulesPatch | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: CustomRulesPatch = {};
  if (Array.isArray(raw.add)) {
    const added: Record<string, unknown>[] = [];
    for (const item of raw.add.slice(0, 10)) {
      const parsed = customRuleSchema.safeParse(item);
      if (parsed.success) {
        const rule = parsed.data as unknown as Record<string, unknown>;
        if (!rule.id || typeof rule.id !== "string") rule.id = crypto.randomUUID();
        if (rule.enabled === undefined) rule.enabled = true;
        added.push(rule);
      }
    }
    if (added.length > 0) out.add = added;
  }
  if (Array.isArray(raw.update)) {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    for (const item of raw.update.slice(0, 20)) {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") {
        const { id, patch } = item as Record<string, unknown>;
        const patchObj = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
        const parsed = customRuleSchema.partial().safeParse(patchObj);
        if (parsed.success && Object.keys(parsed.data).length > 0) {
          updates.push({ id: id as string, patch: parsed.data as Record<string, unknown> });
        }
      }
    }
    if (updates.length > 0) out.update = updates;
  }
  if (Array.isArray(raw.disable)) {
    const ids = raw.disable
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 30);
    if (ids.length > 0) out.disable = ids;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function fallbackIncidentDiagnose(incidentType: string): IncidentDiagnoseResult {
  return {
    summary: `Incidente do tipo "${incidentType}" reportado. Sem LLM ativo, não foi possível gerar correção automática.`,
    question_to_confirm: "Deseja revisar as configurações do agente manualmente?",
    risk_notes: ["Revise as regras e o perfil na aba Cérebro."],
  };
}

/** Deterministic suggestion for hard-constraint incidents (no LLM). */
function deterministicIncidentSuggestion(incidentType: string): IncidentDiagnoseResult | null {
  if (incidentType === "double_booking" || incidentType === "ignored_availability") {
    return {
      summary: "Esse tipo de problema é evitado pelo intervalo mínimo entre atendimentos (buffer). Ative ou aumente o buffer nas configurações da IA (Integrações > Cérebro) para evitar sobreposição.",
      question_to_confirm: "Deseja ativar ou aumentar o buffer entre atendimentos nas configurações?",
      risk_notes: ["O buffer é aplicado automaticamente em check_availability, get_next_slots e create_appointment."],
    };
  }
  return null;
}

async function runIncidentCorrectorLlm(params: {
  barbershopId: string;
  model: string;
  incidentType: string;
  managerNote?: string;
  settingsSnapshot: { agent_profile?: unknown; additional_instructions?: string | null };
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  toolTrace?: Array<{ name: string; args?: Record<string, unknown>; result?: unknown }>;
}): Promise<IncidentDiagnoseResult> {
  const deterministic = deterministicIncidentSuggestion(params.incidentType);
  if (deterministic) return deterministic;

  if (!config.openaiApiKey) {
    return fallbackIncidentDiagnose(params.incidentType);
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const transcriptText = params.transcript
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
  const transcriptTruncated = truncateForIncident(transcriptText, INCIDENT_TRANSCRIPT_MAX_CHARS);
  const toolTraceText =
    (params.toolTrace?.length &&
      params.toolTrace
        .slice(-10)
        .map((t) => {
          const argsStr = t.args ? truncateForIncident(JSON.stringify(t.args), INCIDENT_TOOL_TRACE_ITEM_MAX) : "";
          const resultStr = t.result !== undefined ? truncateForIncident(JSON.stringify(t.result), INCIDENT_TOOL_TRACE_ITEM_MAX) : "";
          return `${t.name}${argsStr ? ` args: ${argsStr}` : ""}${resultStr ? ` result: ${resultStr}` : ""}`;
        })
        .join("\n")) ?? "";

  const systemContent =
    "Você é um corretor de incidentes para um agente de WhatsApp de barbearia.\n" +
    "Sua tarefa: analisar o incidente reportado e sugerir um patch mínimo (regras estruturadas e/ou perfil/instruções) para evitar recorrência.\n" +
    "Responda SOMENTE em JSON válido com as chaves:\n" +
    '{"summary": string, "question_to_confirm": string (uma pergunta curta para o gestor), ' +
    '"recommended_profile_patch": object | null, "recommended_additional_instructions_patch": string | null, ' +
    '"recommended_custom_rules_patch": { "add": [{ "id", "title", "enabled", "priority", "do", "dont?" }], "update": [{ "id", "patch": {} }], "disable": [id] } | null, ' +
    '"suite_scenarios_to_run": string[] | null (ids de cenários para rodar após aplicar), "risk_notes": string[]}\n' +
    "Regras:\n" +
    "- Prefira patch estruturado (regras customizadas) em vez de texto livre.\n" +
    "- Não aumente o prompt sem necessidade.\n" +
    "- Se o incidente for de hard constraint (ex.: double_booking, ignored_availability), sugira ativar buffer no backend ou mudança de processo, não só regra de linguagem.\n" +
    "- summary e question_to_confirm em PT-BR, curtos e acionáveis.\n" +
    "- recommended_profile_patch: apenas campos tonePreset, emojiLevel, slangLevel, verbosity, salesStyle, displayName, nickname, role, signMessages, signatureStyle, hardRules.\n" +
    "- recommended_custom_rules_patch: add com id único, title, enabled true, priority 1-5, do array de strings, dont opcional.";

  const userContent =
    `Tipo de incidente: ${params.incidentType}\n` +
    (params.managerNote ? `Observação do gestor: ${params.managerNote}\n` : "") +
    `Configuração atual (snapshot):\n${JSON.stringify(params.settingsSnapshot)}\n\n` +
    `Transcrito da conversa:\n${transcriptTruncated}\n\n` +
    (toolTraceText ? `Últimas chamadas de ferramentas:\n${toolTraceText}\n\n` : "") +
    "Gere a correção (summary, question_to_confirm e patches recomendados).";

  const completion = await openai.chat.completions.create({
    model: params.model || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return fallbackIncidentDiagnose(params.incidentType);
  }

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "Correção sugerida com base no incidente.";
  const question_to_confirm =
    typeof parsed.question_to_confirm === "string" && parsed.question_to_confirm.trim()
      ? parsed.question_to_confirm.trim()
      : "Deseja aplicar estas alterações no rascunho?";

  return {
    summary,
    question_to_confirm,
    recommended_profile_patch: normalizeRecommendedProfilePatch(parsed.recommended_profile_patch),
    recommended_additional_instructions_patch:
      typeof parsed.recommended_additional_instructions_patch === "string"
        ? parsed.recommended_additional_instructions_patch.slice(0, 4000)
        : parsed.recommended_additional_instructions_patch === null
          ? null
          : undefined,
    recommended_custom_rules_patch: normalizeRecommendedCustomRulesPatch(parsed.recommended_custom_rules_patch),
    suite_scenarios_to_run: Array.isArray(parsed.suite_scenarios_to_run)
      ? parsed.suite_scenarios_to_run.filter((id): id is string => typeof id === "string").slice(0, 10)
      : undefined,
    risk_notes: normalizeStringList(parsed.risk_notes),
  };
}

async function runDiagnosticWithLlm(params: {
  barbershopId: string;
  model: string;
  currentProfile: unknown;
  currentAdditionalInstructions: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  objectives?: string[];
  attachments?: Array<{ name: string; mime_type?: string; text: string }>;
}): Promise<DiagnosticResult> {
  if (!config.openaiApiKey) {
    return fallbackDiagnosticResult(params.objectives);
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const objectives = params.objectives?.length
    ? params.objectives.join(", ")
    : "melhorar clareza, conversão e segurança";
  const profile = normalizeProfile(params.currentProfile);
  const transcript = params.messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n")
    .slice(0, 32_000);
  const attachmentsText = (params.attachments ?? [])
    .map(
      (a, idx) =>
        `Anexo ${idx + 1} - ${a.name}${a.mime_type ? ` (${a.mime_type})` : ""}\n${a.text}`
    )
    .join("\n\n---\n\n")
    .slice(0, 40_000);

  const completion = await openai.chat.completions.create({
    model: params.model || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Você é um consultor de qualidade para um agente de WhatsApp de barbearia.\n" +
          "Sua tarefa: analisar o histórico e orientar melhoria prática do agente.\n" +
          "Sempre responda SOMENTE em JSON válido com as chaves:\n" +
          "{\n" +
          '  "reply": string,\n' +
          '  "recommended_profile_patch": object | null,\n' +
          '  "recommended_additional_instructions_patch": string | null,\n' +
          '  "recommended_custom_rules_patch": { "add": [{ "id", "title", "enabled", "priority", "do", "dont?" }], "update": [{ "id", "patch": {} }], "disable": [id] } | null,\n' +
          '  "risk_notes": string[],\n' +
          '  "expected_outcomes": string[]\n' +
          "}\n" +
          "Restrições:\n" +
          "- reply em PT-BR, curto, objetivo e acionável.\n" +
          "- Em recommended_profile_patch, use apenas campos compatíveis: tonePreset, emojiLevel, slangLevel, verbosity, salesStyle, displayName, nickname, role, signMessages, signatureStyle, hardRules, customRules.\n" +
          "- Em recommended_custom_rules_patch: add = novas regras (id único, title, enabled true, priority 1-5, do array de strings, dont opcional); update = por id, patch com campos a alterar; disable = array de ids para desativar.\n" +
          "- Nunca invente IDs, dados sensíveis ou links internos.\n",
      },
      {
        role: "user",
        content:
          `Barbearia: ${params.barbershopId}\n` +
          `Objetivos: ${objectives}\n\n` +
          `Perfil atual:\n${JSON.stringify(profile)}\n\n` +
          `Instruções adicionais atuais:\n${params.currentAdditionalInstructions ?? "(vazio)"}\n\n` +
          `Histórico da conversa:\n${transcript}\n\n` +
          (attachmentsText
            ? `Contexto adicional em anexos:\n${attachmentsText}\n\n`
            : "") +
          "Gere diagnóstico e recomendações práticas.",
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return fallbackDiagnosticResult(params.objectives);
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "Analisei sua conversa e sugeri ajustes para melhorar a qualidade do atendimento.";
  const recommendedInstructionsRaw =
    parsed.recommended_additional_instructions_patch;
  const recommendedAdditionalInstructions =
    typeof recommendedInstructionsRaw === "string"
      ? recommendedInstructionsRaw.slice(0, 4000)
      : recommendedInstructionsRaw === null
      ? null
      : undefined;

  return {
    reply,
    recommended_profile_patch: normalizeRecommendedProfilePatch(
      parsed.recommended_profile_patch
    ),
    recommended_additional_instructions_patch:
      recommendedAdditionalInstructions ?? null,
    recommended_custom_rules_patch: normalizeRecommendedCustomRulesPatch(
      parsed.recommended_custom_rules_patch
    ),
    risk_notes: normalizeStringList(parsed.risk_notes),
    expected_outcomes: normalizeStringList(parsed.expected_outcomes),
  };
}

/** GET /api/integrations/whatsapp/ai-health — métricas de qualidade do atendente (últimos 7 dias) */
whatsappRouter.get("/ai-health", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [totalsMsg, totalsViol, byType, last24hMsg, last24hViol] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM public.ai_messages m
         JOIN public.ai_conversations c ON c.id = m.conversation_id
         WHERE c.barbershop_id = $1 AND m.role = 'assistant' AND m.created_at >= $2`,
        [barbershopId, since]
      ),
      pool.query<{ total: string; with_violations: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE array_length(violations, 1) > 0)::text AS with_violations
         FROM public.ai_quality_metrics
         WHERE barbershop_id = $1 AND created_at >= $2`,
        [barbershopId, since]
      ),
      pool.query<{ violation: string; cnt: string }>(
        `SELECT unnest(violations) AS violation, COUNT(*)::text AS cnt
         FROM public.ai_quality_metrics
         WHERE barbershop_id = $1 AND created_at >= $2 AND array_length(violations, 1) > 0
         GROUP BY 1`,
        [barbershopId, since]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM public.ai_messages m
         JOIN public.ai_conversations c ON c.id = m.conversation_id
         WHERE c.barbershop_id = $1 AND m.role = 'assistant' AND m.created_at >= now() - interval '24 hours'`,
        [barbershopId]
      ),
      pool.query<{ total: string; with_violations: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE array_length(violations, 1) > 0)::text AS with_violations
         FROM public.ai_quality_metrics
         WHERE barbershop_id = $1 AND created_at >= now() - interval '24 hours'`,
        [barbershopId]
      ),
    ]);
    const total = parseInt(totalsMsg.rows[0]?.total ?? "0", 10);
    const withViolations = parseInt(totalsViol.rows[0]?.with_violations ?? "0", 10);
    const total24 = parseInt(last24hMsg.rows[0]?.total ?? "0", 10);
    const total24Replies = parseInt(last24hViol.rows[0]?.total ?? "0", 10);
    const withViolations24 = parseInt(last24hViol.rows[0]?.with_violations ?? "0", 10);
    const violationRate24 = total24Replies > 0 ? withViolations24 / total24Replies : 0;
    const regression = total24Replies >= 5 && violationRate24 >= 0.15;
    res.json({
      period_days: 7,
      total_messages: total,
      messages_with_violations: withViolations,
      by_violation: Object.fromEntries(byType.rows.map((r) => [r.violation, parseInt(r.cnt, 10)])),
      last_24h: { total: total24, with_violations: withViolations24 },
      regression_detected: regression,
    });
  } catch (e) {
    console.error("whatsapp ai-health:", e);
    res.status(500).json({ error: "Failed to get AI health" });
  }
});

/** POST /api/integrations/whatsapp/ai-analyze-chat — analisa conversa exportada e sugere melhorias */
whatsappRouter.post("/ai-analyze-chat", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = analyzeChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { chat_text, objectives } = parsed.data;
    const cur = await pool.query<{
      agent_profile: unknown;
      additional_instructions: string | null;
      model: string | null;
    }>(
      `SELECT agent_profile, additional_instructions, model FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const currentProfile = cur.rows[0]?.agent_profile ?? {};
    const profile = normalizeProfile(currentProfile);
    const diagnostic = await runDiagnosticWithLlm({
      barbershopId,
      model: cur.rows[0]?.model ?? "gpt-4o-mini",
      currentProfile,
      currentAdditionalInstructions: cur.rows[0]?.additional_instructions ?? null,
      messages: [{ role: "user", content: chat_text.trim() }],
      objectives,
    });
    res.json({
      recommended_profile_patch: diagnostic.recommended_profile_patch,
      recommended_additional_instructions_patch:
        diagnostic.recommended_additional_instructions_patch,
      risk_notes: diagnostic.risk_notes,
      expected_outcomes: diagnostic.expected_outcomes,
      current_profile: profile,
    });
  } catch (e) {
    console.error("whatsapp ai-analyze-chat:", e);
    res.status(500).json({ error: "Failed to analyze chat" });
  }
});

/** POST /api/integrations/whatsapp/ai-diagnostic-chat — chat interno com LLM para refinamento do agente */
whatsappRouter.post("/ai-diagnostic-chat", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = diagnosticChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { messages, objectives, attachments } = parsed.data;
    const cur = await pool.query<{
      agent_profile: unknown;
      additional_instructions: string | null;
      model: string | null;
    }>(
      `SELECT agent_profile, additional_instructions, model FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const currentProfile = cur.rows[0]?.agent_profile ?? {};
    const profile = normalizeProfile(currentProfile);
    const diagnostic = await runDiagnosticWithLlm({
      barbershopId,
      model: cur.rows[0]?.model ?? "gpt-4o-mini",
      currentProfile,
      currentAdditionalInstructions: cur.rows[0]?.additional_instructions ?? null,
      messages,
      objectives,
      attachments,
    });
    res.json({
      reply: diagnostic.reply,
      recommended_profile_patch: diagnostic.recommended_profile_patch,
      recommended_additional_instructions_patch:
        diagnostic.recommended_additional_instructions_patch,
      risk_notes: diagnostic.risk_notes,
      expected_outcomes: diagnostic.expected_outcomes,
      current_profile: profile,
    });
  } catch (e) {
    console.error("whatsapp ai-diagnostic-chat:", e);
    res.status(500).json({ error: "Failed to run diagnostic chat" });
  }
});

/** POST /api/integrations/whatsapp/ai-incidents/diagnose — diagnóstico corretor a partir de um incidente reportado */
whatsappRouter.post("/ai-incidents/diagnose", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = incidentDiagnoseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    const transcriptTruncated = data.transcript
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    const cur = await pool.query<{ model: string | null }>(
      `SELECT model FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const model = cur.rows[0]?.model ?? "gpt-4o-mini";
    const result = await runIncidentCorrectorLlm({
      barbershopId,
      model,
      incidentType: data.incident_type,
      managerNote: data.manager_note,
      settingsSnapshot: data.settings_snapshot,
      transcript: transcriptTruncated,
      toolTrace: data.tool_trace,
    });
    res.json({
      summary: result.summary,
      question_to_confirm: result.question_to_confirm,
      recommended_profile_patch: result.recommended_profile_patch ?? undefined,
      recommended_additional_instructions_patch: result.recommended_additional_instructions_patch ?? undefined,
      recommended_custom_rules_patch: result.recommended_custom_rules_patch ?? undefined,
      suite_scenarios_to_run: result.suite_scenarios_to_run ?? undefined,
      risk_notes: result.risk_notes,
    });
  } catch (e) {
    console.error("whatsapp ai-incidents diagnose:", e);
    res.status(500).json({ error: "Failed to diagnose incident" });
  }
});
