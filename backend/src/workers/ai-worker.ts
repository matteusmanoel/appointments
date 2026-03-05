import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendText } from "../integrations/uazapi/client.js";
import { runAgent, detectViolations } from "../ai/agent.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";
import { enqueueOutboundEvent, dispatchOutboundEvents } from "../outbound/n8n-events.js";
import { ensureCriticalSchema } from "../db/ensure-schema.js";
import OpenAI from "openai";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_MS = 1500;
const OUTBOUND_INTERVAL_MS = 20_000;
const FALLBACK_MESSAGE =
  "Desculpe, o atendimento automático está temporariamente indisponível. Tente novamente em instantes ou entre em contato diretamente.";

const MAX_EMOJIS_PER_MESSAGE = 2;

function isUndefinedTableOrColumn(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "42P01" || code === "42703";
}

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
  const primarySql = `UPDATE public.ai_jobs
     SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
      SELECT j.id
      FROM public.ai_jobs j
      WHERE j.status = 'queued'
        AND j.run_after <= now()
        AND NOT EXISTS (
          SELECT 1
          FROM public.barbershop_ai_runtime r
          WHERE r.barbershop_id = j.barbershop_id
            AND r.paused_until > now()
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.ai_conversation_runtime cr
          WHERE cr.conversation_id = j.conversation_id
            AND cr.paused_until > now()
        )
      ORDER BY j.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, conversation_id, payload_json, attempts`;
  const fallbackSql = `UPDATE public.ai_jobs
     SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
      SELECT j.id
      FROM public.ai_jobs j
      WHERE j.status = 'queued'
        AND j.run_after <= now()
        AND NOT EXISTS (
          SELECT 1
          FROM public.barbershop_ai_runtime r
          WHERE r.barbershop_id = j.barbershop_id
            AND r.paused_until > now()
        )
      ORDER BY j.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, conversation_id, payload_json, attempts`;
  let r;
  try {
    r = await pool.query<{
    id: string;
    barbershop_id: string;
    conversation_id: string;
    payload_json: unknown;
    attempts: number;
    }>(primarySql, [WORKER_ID]);
  } catch (e) {
    if (!isUndefinedTableOrColumn(e)) throw e;
    r = await pool.query<{
      id: string;
      barbershop_id: string;
      conversation_id: string;
      payload_json: unknown;
      attempts: number;
    }>(fallbackSql, [WORKER_ID]);
  }
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

function extractProviderMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const any = payload as Record<string, unknown>;
  const candidates = [
    any.id,
    any.messageId,
    any.message_id,
    any.msgId,
    any.key && typeof any.key === "object" ? (any.key as Record<string, unknown>).id : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return null;
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
      let typingSimulation: { enabled?: boolean; baseDelayMs?: number; msPerChar?: number; jitterMs?: number } | null = null;
      try {
        const tsRow = await pool.query<{ typing_simulation: unknown }>(
          `SELECT typing_simulation FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
          [barbershopId]
        );
        const raw = tsRow.rows[0]?.typing_simulation;
        if (raw && typeof raw === "object" && raw !== null) {
          typingSimulation = raw as { enabled?: boolean; baseDelayMs?: number; msPerChar?: number; jitterMs?: number };
        }
      } catch {
        // ignore
      }
      const baseDelayMs = typingSimulation?.enabled ? (typingSimulation.baseDelayMs ?? 300) : 0;
      const msPerChar = typingSimulation?.enabled ? (typingSimulation.msPerChar ?? 20) : 0;
      const jitterMs = typingSimulation?.enabled ? (typingSimulation.jitterMs ?? 100) : 0;

      // Allow the model to send multiple WhatsApp messages using a delimiter.
      const parts = String(reply ?? "")
        .split("[[MSG]]")
        .map((p) => sanitizeOutgoingText(p))
        .filter((p) => p.length > 0);
      const toSend = parts.length ? parts : [sanitizeOutgoingText(reply)];
      for (const part of toSend) {
        if (baseDelayMs > 0 || msPerChar > 0) {
          const delay = baseDelayMs + part.length * msPerChar + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
          if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
        }
        const sent = await sendText({ token, number: fromPhone, text: part });
        const providerMessageId = extractProviderMessageId(sent);
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id, delivery_status)
           VALUES ($1, 'assistant', $2, $3, 'sent')`,
          [conversationId, part, providerMessageId]
        );
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

/** Run one cycle: process up to maxJobs, dispatch outbound events once. Used by Lambda and by runLoop. */
export async function runAiWorkerCycle(options?: { maxJobs?: number }): Promise<{ processed: number }> {
  const maxJobs = options?.maxJobs ?? 10;
  let processed = 0;
  while (processed < maxJobs) {
    const did = await processOneJob();
    if (!did) break;
    processed++;
  }
  await dispatchOutboundEvents().catch((e) => console.error("[ai-worker] outbound dispatch:", e));
  return { processed };
}

async function runLoop(): Promise<void> {
  const concurrency = Math.max(1, config.aiWorkerConcurrency ?? 5);
  console.info(`[ai-worker] started ${WORKER_ID} concurrency=${concurrency}`);

  while (true) {
    const { processed } = await runAiWorkerCycle({ maxJobs: concurrency });
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  ensureCriticalSchema()
    .catch((e) => console.warn("[ai-worker] ensureCriticalSchema failed:", e))
    .finally(() => {
      runLoop().catch((e) => {
    console.error("[ai-worker] fatal:", e);
    process.exit(1);
      });
    });
}
