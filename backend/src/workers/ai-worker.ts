import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendText } from "../integrations/uazapi/client.js";
import { runAgent, detectViolations } from "../ai/agent.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";
import { enqueueOutboundEvent, dispatchOutboundEvents } from "../outbound/n8n-events.js";
import OpenAI from "openai";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_MS = 1500;
const OUTBOUND_INTERVAL_MS = 20_000;
const FALLBACK_MESSAGE =
  "Desculpe, o atendimento automático está temporariamente indisponível. Tente novamente em instantes ou entre em contato diretamente.";

const MAX_EMOJIS_PER_MESSAGE = 2;

function sanitizeOutgoingText(text: string): string {
  // Never leak internal IDs to WhatsApp, even if the model outputs them.
  const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  let out =
    (text ?? "")
      // Convert Markdown bold to WhatsApp bold (single asterisk)
      .replace(/\*\*([^*]+)\*\*/g, "*$1*")
      .replace(/\s*\(ID:\s*[0-9a-f-]{36}\s*\)/gi, "")
      .replace(/\bID:\s*[0-9a-f-]{36}\b/gi, "")
      .replace(uuidRegex, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .replace(/ {2,}/g, " ")
      .trim();

  // Safety net: limit emojis per message (cadência média)
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const emojis = out.match(emojiRegex);
  if (emojis != null && emojis.length > MAX_EMOJIS_PER_MESSAGE) {
    let seen = 0;
    out = out.replace(emojiRegex, () => {
      seen++;
      return seen <= MAX_EMOJIS_PER_MESSAGE ? emojis[seen - 1]! : "";
    });
  }

  return out;
}

async function getNextJob(): Promise<{
  id: string;
  barbershop_id: string;
  conversation_id: string;
  payload_json: { fromPhone: string; text: string; provider_event_id?: string };
  attempts: number;
} | null> {
  const r = await pool.query<{
    id: string;
    barbershop_id: string;
    conversation_id: string;
    payload_json: unknown;
    attempts: number;
  }>(
    `UPDATE public.ai_jobs
     SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT j.id FROM public.ai_jobs j
       LEFT JOIN public.barbershop_ai_runtime r ON r.barbershop_id = j.barbershop_id AND r.paused_until > now()
       WHERE j.status = 'queued' AND j.run_after <= now() AND r.barbershop_id IS NULL
       ORDER BY j.created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, conversation_id, payload_json, attempts`
  ,
    [WORKER_ID]
  );
  const row = r.rows[0];
  if (!row) return null;
  const payload = row.payload_json as { fromPhone?: string; text?: string; provider_event_id?: string };
  return {
    id: row.id,
    barbershop_id: row.barbershop_id,
    conversation_id: row.conversation_id,
    payload_json: {
      fromPhone: payload?.fromPhone ?? "",
      text: payload?.text ?? "",
      provider_event_id: payload?.provider_event_id,
    },
    attempts: row.attempts,
  };
}

function backoffSeconds(attempts: number): number {
  const base = config.aiJobBackoffBaseSeconds ?? 2;
  return Math.min(Math.pow(base, attempts), 3600);
}

async function markJobDone(jobId: string): Promise<void> {
  await pool.query(
    `UPDATE public.ai_jobs SET status = 'done', locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = now() WHERE id = $1`,
    [jobId]
  );
}

async function markJobFailed(jobId: string, errorMessage: string, attempts: number): Promise<void> {
  const maxAttempts = config.aiJobMaxAttempts ?? 5;
  if (attempts >= maxAttempts) {
    await pool.query(
      `UPDATE public.ai_jobs SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error = $1, updated_at = now() WHERE id = $2`,
      [errorMessage.slice(0, 2048), jobId]
    );
  } else {
    const runAfter = new Date(Date.now() + backoffSeconds(attempts) * 1000);
    await pool.query(
      `UPDATE public.ai_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = $1, run_after = $2, updated_at = now() WHERE id = $3`,
      [errorMessage.slice(0, 2048), runAfter, jobId]
    );
  }
}

async function isAiEnabled(barbershopId: string): Promise<boolean> {
  const r = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
    [barbershopId]
  );
  const row = r.rows[0];
  return row?.enabled ?? true;
}

async function ensureAiSettingsRow(barbershopId: string): Promise<void> {
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model, temperature, updated_at)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini', 0.7, now())
     ON CONFLICT (barbershop_id) DO NOTHING`,
    [barbershopId]
  );
}

/** Prefer connected; if status is stale (e.g. not yet updated after QR scan), still try token so send can succeed. */
async function getUazapiToken(barbershopId: string): Promise<string | null> {
  const r = await pool.query<{ uazapi_instance_token_encrypted: string }>(
    `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
     WHERE barbershop_id = $1 AND provider = 'uazapi' AND uazapi_instance_token_encrypted IS NOT NULL`,
    [barbershopId]
  );
  const row = r.rows[0];
  if (!row?.uazapi_instance_token_encrypted || !config.appEncryptionKey) return null;
  return decrypt(row.uazapi_instance_token_encrypted, config.appEncryptionKey);
}

async function updateConversationLastMessage(conversationId: string): Promise<void> {
  await pool.query(
    `UPDATE public.ai_conversations SET last_message_at = now(), updated_at = now() WHERE id = $1`,
    [conversationId]
  );
}

async function processOneJob(): Promise<boolean> {
  const job = await getNextJob();
  if (!job) return false;

  const { id: jobId, barbershop_id: barbershopId, conversation_id: conversationId, payload_json, attempts } = job;
  const { fromPhone, text: _userText } = payload_json;
  console.info("[ai-worker] processing jobId=%s barbershopId=%s conversationId=%s fromPhone=%s", jobId, barbershopId, conversationId, fromPhone);

  try {
    await ensureAiSettingsRow(barbershopId);
    const aiEnabled = await isAiEnabled(barbershopId);
    let reply: string;

    if (!aiEnabled) {
      reply = FALLBACK_MESSAGE;
    } else if (!config.openaiApiKey) {
      reply = FALLBACK_MESSAGE;
    } else {
      const usage = await getUsageAndLimit(barbershopId);
      if (usage.hardExceeded) {
        console.warn("[ai-worker] hard limit exceeded barbershopId=%s used=%s limit=%s", barbershopId, usage.used, usage.limit);
        reply = "Desculpe, o limite de mensagens do seu plano foi atingido neste mês. Entre em contato com o suporte para fazer upgrade ou aguardar o próximo ciclo.";
      } else {
        if (usage.softExceeded) {
          console.warn("[ai-worker] soft limit exceeded barbershopId=%s used=%s limit=%s", barbershopId, usage.used, usage.limit);
        }
        const openai = new OpenAI({ apiKey: config.openaiApiKey });
        const result = await runAgent(barbershopId, conversationId, fromPhone, openai);
      reply = result.reply;
      if (result.state === "appointment_created") {
        await enqueueOutboundEvent(barbershopId, "appointment_created", {
          conversation_id: conversationId,
          from_phone: fromPhone,
        });
      }
      const convRow = await pool.query<{ is_sandbox: boolean }>(
        `SELECT is_sandbox FROM public.ai_conversations WHERE id = $1`,
        [conversationId]
      );
      const isSandbox = convRow.rows[0]?.is_sandbox ?? true;
      if (!isSandbox && reply) {
        const violations = detectViolations(reply);
        const emojiCount = (reply.match(/\p{Extended_Pictographic}/gu) ?? []).length;
        await pool.query(
          `INSERT INTO public.ai_quality_metrics (barbershop_id, conversation_id, violations, emoji_count)
           VALUES ($1, $2, $3, $4)`,
          [barbershopId, conversationId, violations, emojiCount]
        ).catch((e) => console.warn("[ai-worker] failed to insert quality metrics:", e));
      }
      console.info("[ai-worker] jobId=%s AI reply len=%s state=%s", jobId, reply.length, result.state ?? "—");
      }
    }

    const token = await getUazapiToken(barbershopId);
    if (token) {
      // Allow the model to send multiple WhatsApp messages using a delimiter.
      const parts = String(reply ?? "")
        .split("[[MSG]]")
        .map((p) => sanitizeOutgoingText(p))
        .filter((p) => p.length > 0);
      const toSend = parts.length ? parts : [sanitizeOutgoingText(reply)];
      for (const part of toSend.slice(0, 3)) {
        await sendText({ token, number: fromPhone, text: part });
      }
      console.info("[ai-worker] jobId=%s sent to fromPhone=%s", jobId, fromPhone);
    } else {
      console.warn("[ai-worker] jobId=%s no Uazapi token (status may not be connected) barbershopId=%s", jobId, barbershopId);
    }
    await updateConversationLastMessage(conversationId);
    await markJobDone(jobId);
    return true;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[ai-worker] job ${jobId} error:`, errMsg);
    await markJobFailed(jobId, errMsg, attempts);
    return true;
  }
}

async function runLoop(): Promise<void> {
  const concurrency = Math.max(1, config.aiWorkerConcurrency ?? 5);
  console.info(`[ai-worker] started ${WORKER_ID} concurrency=${concurrency}`);

  let lastOutbound = 0;
  while (true) {
    let processed = 0;
    for (let i = 0; i < concurrency; i++) {
      const did = await processOneJob();
      if (did) processed++;
    }
    const now = Date.now();
    if (now - lastOutbound >= OUTBOUND_INTERVAL_MS) {
      lastOutbound = now;
      dispatchOutboundEvents().catch((e) => console.error("[ai-worker] outbound dispatch:", e));
    }
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

runLoop().catch((e) => {
  console.error("[ai-worker] fatal:", e);
  process.exit(1);
});
