import { Router, Request, Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { pool } from "../db.js";
import { getBarbershopId } from "../middleware/auth.js";
import { config } from "../config.js";
import { encrypt, decrypt } from "../integrations/encryption.js";
import { validateAdditionalInstructions, buildSystemPrompt, normalizeProfile } from "../ai/prompt-builder.js";
import { runAgent, detectViolations } from "../ai/agent.js";
import {
  adminCreateInstance,
  instanceConnect,
  instanceStatus,
  sendText,
  setWebhook,
  instanceDisconnect,
  pingUazapi,
} from "../integrations/uazapi/client.js";
import type { InstanceStatusResult } from "../integrations/uazapi/client.js";
import { getAiPauseState, setAiPaused, clearAiPause } from "../ai/runtime-pause.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";

export const whatsappRouter = Router();

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
      updated_at: string;
    }>(
      `SELECT enabled, timezone, model, model_premium, temperature, system_prompt_override,
              agent_profile, additional_instructions, active_prompt_version_id, updated_at
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
      additional_instructions: row.additional_instructions ?? undefined,
      active_prompt_version_id: row.active_prompt_version_id ?? undefined,
      updated_at: row.updated_at,
    });
  } catch (e) {
    console.error("whatsapp ai-settings get:", e);
    res.status(500).json({ error: "Failed to get AI settings" });
  }
});

const agentProfileSchema = z.object({
  tonePreset: z.string().optional(),
  emojiLevel: z.enum(["none", "low", "medium"]).optional(),
  slangLevel: z.enum(["low", "medium", "high"]).optional(),
  verbosity: z.enum(["short", "normal"]).optional(),
  salesStyle: z.enum(["soft", "direct"]).optional(),
  hardRules: z.record(z.unknown()).optional(),
}).passthrough();

const aiSettingsBody = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().optional(),
  model: z.string().optional(),
  model_premium: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  system_prompt_override: z.string().nullable().optional(),
  agent_profile: agentProfileSchema.nullable().optional(),
  additional_instructions: z.string().nullable().optional(),
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
    const cur = await pool.query<{
      enabled: boolean; timezone: string; model: string; model_premium: string | null; temperature: number;
      system_prompt_override: string | null; agent_profile: unknown; additional_instructions: string | null;
    }>(
      `SELECT enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions
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
    };
    const enabled = data.enabled ?? current.enabled;
    const timezone = data.timezone ?? current.timezone;
    const model = data.model ?? current.model;
    const model_premium = data.model_premium !== undefined ? data.model_premium : current.model_premium;
    const temperature = data.temperature ?? current.temperature;
    const system_prompt_override = data.system_prompt_override !== undefined ? data.system_prompt_override : current.system_prompt_override;
    const agent_profile = data.agent_profile !== undefined ? JSON.stringify(data.agent_profile ?? {}) : JSON.stringify((current.agent_profile as object) ?? {});
    const additional_instructions = data.additional_instructions !== undefined ? data.additional_instructions : current.additional_instructions;
    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now())
       ON CONFLICT (barbershop_id) DO UPDATE SET
         enabled = $2, timezone = $3, model = $4, model_premium = $5, temperature = $6, system_prompt_override = $7,
         agent_profile = $8::jsonb, additional_instructions = $9, updated_at = now()`,
      [barbershopId, enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions]
    );
    const r = await pool.query<{
      enabled: boolean; timezone: string; model: string; model_premium: string | null; temperature: number;
      system_prompt_override: string | null; agent_profile: unknown; additional_instructions: string | null;
      active_prompt_version_id: string | null; updated_at: string;
    }>(
      `SELECT enabled, timezone, model, model_premium, temperature, system_prompt_override, agent_profile, additional_instructions, active_prompt_version_id, updated_at
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const row = r.rows[0]!;
    res.json({
      ...row,
      system_prompt_override: row.system_prompt_override ?? undefined,
      additional_instructions: row.additional_instructions ?? undefined,
      active_prompt_version_id: row.active_prompt_version_id ?? undefined,
    });
  } catch (e) {
    console.error("whatsapp ai-settings put:", e);
    res.status(500).json({ error: "Failed to update AI settings" });
  }
});

/** POST /api/integrations/whatsapp/ai-settings/publish — publica perfil atual como nova versão ativa */
whatsappRouter.post("/ai-settings/publish", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const cur = await pool.query<{ agent_profile: unknown; additional_instructions: string | null }>(
      `SELECT agent_profile, additional_instructions FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const row = cur.rows[0];
    const agent_profile = row?.agent_profile ?? {};
    const additional_instructions = row?.additional_instructions ?? null;
    const profile = normalizeProfile(agent_profile);
    const compiled = buildSystemPrompt({
      basePrompt: "{{TIMEZONE}} {{DATE_NOW}} {{BARBERSHOP_NAME}}",
      guardrails: "",
      profile,
      additionalInstructions: additional_instructions,
    }).slice(0, 2000);
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_ai_prompt_versions (barbershop_id, agent_profile, additional_instructions, compiled_prompt_preview, status)
       VALUES ($1, $2::jsonb, $3, $4, 'active')
       RETURNING id`,
      [barbershopId, JSON.stringify(agent_profile), additional_instructions, compiled]
    );
    const newId = ins.rows[0]!.id;
    await pool.query(
      `UPDATE public.barbershop_ai_prompt_versions SET status = 'rolled_back' WHERE barbershop_id = $1 AND status = 'active' AND id != $2`,
      [barbershopId, newId]
    );
    await pool.query(
      `UPDATE public.barbershop_ai_settings SET active_prompt_version_id = $1, updated_at = now() WHERE barbershop_id = $2`,
      [newId, barbershopId]
    );
    res.json({ version_id: newId, status: "active" });
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
    const ver = await pool.query<{ id: string; agent_profile: unknown; additional_instructions: string | null }>(
      `SELECT id, agent_profile, additional_instructions FROM public.barbershop_ai_prompt_versions
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
    const r = await pool.query<{ id: string; status: string; created_at: string }>(
      `SELECT id, status, created_at FROM public.barbershop_ai_prompt_versions
       WHERE barbershop_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [barbershopId]
    );
    res.json({ versions: r.rows.map((row) => ({ id: row.id, status: row.status, created_at: row.created_at })) });
  } catch (e) {
    console.error("whatsapp ai-settings versions:", e);
    res.status(500).json({ error: "Failed to list versions" });
  }
});

const simulateBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  draft_profile: z.record(z.unknown()).nullable().optional(),
  draft_additional_instructions: z.string().nullable().optional(),
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
    const { messages, draft_profile, draft_additional_instructions } = parsed.data;
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
    res.json({ reply: result.reply, violations, usage: result.usage });
  } catch (e) {
    console.error("whatsapp ai-simulate:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Simulation failed" });
  }
});

const analyzeChatBody = z.object({
  chat_text: z.string(),
  objectives: z.array(z.string()).optional(),
});

/** GET /api/integrations/whatsapp/ai-health — métricas de qualidade do atendente (últimos 7 dias) */
whatsappRouter.get("/ai-health", async (req: Request, res: Response): Promise<void> => {
  try {
    const barbershopId = getBarbershopId(req);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const totals = await pool.query<{ total: string; with_violations: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE array_length(violations, 1) > 0)::text AS with_violations
       FROM public.ai_quality_metrics
       WHERE barbershop_id = $1 AND created_at >= $2`,
      [barbershopId, since]
    );
    const byType = await pool.query<{ violation: string; cnt: string }>(
      `SELECT unnest(violations) AS violation, COUNT(*)::text AS cnt
       FROM public.ai_quality_metrics
       WHERE barbershop_id = $1 AND created_at >= $2 AND array_length(violations, 1) > 0
       GROUP BY 1`,
      [barbershopId, since]
    );
    const last24h = await pool.query<{ total: string; with_violations: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE array_length(violations, 1) > 0)::text AS with_violations
       FROM public.ai_quality_metrics
       WHERE barbershop_id = $1 AND created_at >= now() - interval '24 hours'`,
      [barbershopId]
    );
    const total = parseInt(totals.rows[0]?.total ?? "0", 10);
    const withViolations = parseInt(totals.rows[0]?.with_violations ?? "0", 10);
    const total24 = parseInt(last24h.rows[0]?.total ?? "0", 10);
    const withViolations24 = parseInt(last24h.rows[0]?.with_violations ?? "0", 10);
    const violationRate24 = total24 > 0 ? withViolations24 / total24 : 0;
    const regression = total24 >= 5 && violationRate24 >= 0.15;
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
    const cur = await pool.query<{ agent_profile: unknown; additional_instructions: string | null }>(
      `SELECT agent_profile, additional_instructions FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const currentProfile = cur.rows[0]?.agent_profile ?? {};
    const objectivesStr = (objectives ?? ["melhorar atendimento"]).join(", ");
    const profile = normalizeProfile(currentProfile);
    const recommended_profile_patch: Record<string, unknown> = {};
    if (objectivesStr.toLowerCase().includes("menos emoji") || objectivesStr.toLowerCase().includes("emoji")) {
      recommended_profile_patch.emojiLevel = "low";
    }
    if (objectivesStr.toLowerCase().includes("mais direto") || objectivesStr.toLowerCase().includes("direto")) {
      recommended_profile_patch.verbosity = "short";
      recommended_profile_patch.salesStyle = "direct";
    }
    if (objectivesStr.toLowerCase().includes("mais vendas")) {
      recommended_profile_patch.salesStyle = "direct";
    }
    const risk_notes: string[] = [];
    const expected_outcomes: string[] = ["Ajustes aplicados conforme objetivos selecionados."];
    res.json({
      recommended_profile_patch: Object.keys(recommended_profile_patch).length ? recommended_profile_patch : undefined,
      recommended_additional_instructions_patch: null as string | null,
      risk_notes,
      expected_outcomes,
      current_profile: profile,
    });
  } catch (e) {
    console.error("whatsapp ai-analyze-chat:", e);
    res.status(500).json({ error: "Failed to analyze chat" });
  }
});
