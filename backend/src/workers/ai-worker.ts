import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendText } from "../integrations/uazapi/client.js";
import { runAgent, detectViolations, sanitizeClientFacingReply } from "../ai/agent.js";
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
  // Placeholders / IDs: shared sanitizer from agent, then WhatsApp formatting.
  const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  let out =
    sanitizeClientFacingReply(text ?? "")
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

  // Safety net: collapse bulleted time lists into a 2-option conversational prompt.
  // This prevents "robotized" slot dumps from reaching the client.
  const bulletTimeLines = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-•]\s*\*?\d{1,2}([:h]\d{2})?\*?\b/i.test(l));
  if (bulletTimeLines.length >= 2 && /\bhor[aá]rios?\s+dispon/i.test(out)) {
    const times: string[] = [];
    for (const line of bulletTimeLines) {
      const m = line.match(/(\d{1,2})\s*[:h]\s*(\d{2})/i);
      const hOnly = line.match(/(\d{1,2})\s*h\b/i);
      if (m) {
        const h = parseInt(m[1] ?? "", 10);
        const mm = String(m[2] ?? "").padStart(2, "0");
        if (Number.isFinite(h)) times.push(mm === "00" ? `${h}h` : `${h}h${mm}`);
      } else if (hOnly) {
        const h = parseInt(hOnly[1] ?? "", 10);
        if (Number.isFinite(h)) times.push(`${h}h`);
      }
      if (times.length >= 2) break;
    }
    if (times.length >= 2) {
      out = `Tenho às *${times[0]}* ou às *${times[1]}*. Qual prefere?`;
    }
  }

  return out;
}

function isPermanentUazapiSendError(message: string): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("is not on whatsapp") || m.includes("not on whatsapp");
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

/** Prefer URL salva na barbearia; fallback N8N_CHAT_TRIGGER_URL (env/Lambda). */
async function resolveN8nChatUrl(barbershopId: string): Promise<string | null> {
  try {
    const r = await pool.query<{ u: string | null }>(
      `SELECT nullif(trim(coalesce(n8n_chat_webhook_url, '')), '') AS u
       FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const db = r.rows[0]?.u?.trim();
    if (db) return db;
  } catch (e) {
    console.warn("[ai-worker] resolveN8nChatUrl (column missing?):", e);
  }
  const envUrl = config.n8nChatTriggerUrl?.trim();
  return envUrl || null;
}

async function isAiEnabled(barbershopId: string): Promise<boolean> {
  if (config.nativeAiDisabled) {
    const n8nUrl = await resolveN8nChatUrl(barbershopId);
    if (!n8nUrl) return false;
  }
  const r = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
    [barbershopId]
  );
  const row = r.rows[0];
  return row?.enabled ?? true;
}

/** User messages since last assistant reply (debounce-aware text for n8n). */
async function getN8nUserTextAggregate(conversationId: string, fallbackText: string): Promise<string> {
  try {
    const r = await pool.query<{ agg: string | null }>(
      `WITH bounds AS (
         SELECT coalesce(max(created_at), '-infinity'::timestamptz) AS last_a
         FROM public.ai_messages
         WHERE conversation_id = $1::uuid AND role = 'assistant'
       )
       SELECT coalesce(string_agg(m.content, E'\\n' ORDER BY m.created_at), '') AS agg
       FROM public.ai_messages m
       CROSS JOIN bounds b
       WHERE m.conversation_id = $1::uuid AND m.role = 'user' AND m.created_at > b.last_a`,
      [conversationId]
    );
    const agg = r.rows[0]?.agg?.trim();
    if (agg) return agg.slice(0, 64 * 1024);
  } catch (e) {
    console.warn("[ai-worker] getN8nUserTextAggregate failed:", e);
  }
  return (fallbackText ?? "").slice(0, 64 * 1024);
}

async function callN8nAgent(
  conversationId: string,
  fromPhone: string,
  barbershopId: string,
  fallbackUserText: string
): Promise<string> {
  const url = await resolveN8nChatUrl(barbershopId);
  if (!url) throw new Error("n8n webhook URL not configured (Integrações → Chaves de API ou env)");

  const text = await getN8nUserTextAggregate(conversationId, fallbackUserText);
  const timeoutMs = Math.max(5000, config.n8nChatTimeoutMs ?? 120_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        text,
        from: fromPhone,
        sessionId: fromPhone,
        conversationId,
        barbershopId,
      }),
    });
    const rawText = await resp.text();
    if (!resp.ok) {
      throw new Error(`n8n HTTP ${resp.status}: ${rawText.slice(0, 500)}`);
    }
    let data: { output?: string; reply?: string; data?: unknown } = {};
    try {
      data = JSON.parse(rawText) as { output?: string; reply?: string; data?: unknown };
    } catch {
      throw new Error("n8n response is not JSON");
    }
    const out =
      data.output ??
      data.reply ??
      (typeof data.data === "string" ? data.data : undefined);
    if (out == null || !String(out).trim()) {
      throw new Error("n8n JSON missing output/reply");
    }
    return String(out);
  } finally {
    clearTimeout(timer);
  }
}

async function ensureAiSettingsRow(barbershopId: string): Promise<void> {
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model, temperature, updated_at)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini', 0.3, now())
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
  const { fromPhone, text: userTextFromJob } = payload_json;
  console.info("[ai-worker] processing jobId=%s barbershopId=%s conversationId=%s fromPhone=%s", jobId, barbershopId, conversationId, fromPhone);

  try {
    await ensureAiSettingsRow(barbershopId);
    const aiEnabled = await isAiEnabled(barbershopId);
    let reply: string;

    if (!aiEnabled) {
      console.info("[ai-worker] jobId=%s AI is disabled, skipping silently barbershopId=%s", jobId, barbershopId);
      await updateConversationLastMessage(conversationId);
      await markJobDone(jobId);
      return true;
    } else if (config.nativeAiDisabled) {
      try {
        const raw = await callN8nAgent(conversationId, fromPhone, barbershopId, String(userTextFromJob ?? ""));
        reply = sanitizeClientFacingReply(raw);
        console.info("[ai-worker] jobId=%s n8n reply len=%s", jobId, reply.length);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ai-worker] jobId=%s n8n error: %s", jobId, msg);
        reply = FALLBACK_MESSAGE;
      }
      const convRowN8n = await pool.query<{ is_sandbox: boolean }>(
        `SELECT is_sandbox FROM public.ai_conversations WHERE id = $1`,
        [conversationId]
      );
      const isSandboxN8n = convRowN8n.rows[0]?.is_sandbox ?? true;
      if (!isSandboxN8n && reply) {
        const violations = detectViolations(reply);
        const emojiCount = (reply.match(/\p{Extended_Pictographic}/gu) ?? []).length;
        await pool
          .query(
            `INSERT INTO public.ai_quality_metrics (barbershop_id, conversation_id, violations, emoji_count)
             VALUES ($1, $2, $3, $4)`,
            [barbershopId, conversationId, violations, emojiCount]
          )
          .catch((e) => console.warn("[ai-worker] failed to insert quality metrics (n8n):", e));
      }
    } else if (!config.openaiApiKey) {
      reply = FALLBACK_MESSAGE;
    } else {
      const usage = await getUsageAndLimit(barbershopId);
      if (usage.hardExceeded) {
        console.warn("[ai-worker] hard limit exceeded barbershopId=%s used=%s limit=%s", barbershopId, usage.used, usage.limit);
        reply =
          "No momento estamos com alta demanda por aqui. Um atendente da equipe te responde em instantes, combinado?";
      } else {
        if (usage.softExceeded) {
          console.warn("[ai-worker] soft limit exceeded barbershopId=%s used=%s limit=%s", barbershopId, usage.used, usage.limit);
        }
        const openai = new OpenAI({ apiKey: config.openaiApiKey });
        const result = await runAgent(barbershopId, conversationId, fromPhone, openai, {
          persistAssistantMessages: false,
        });
      reply = sanitizeClientFacingReply(result.reply);
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

      // Safety net: if the reply claims the booking was confirmed but the agent never
      // set a state that proves a real DB write, the model may have hallucinated.
      const FALSE_CONFIRMATION_RE =
        /agendamento\s+confirmado|aguardamos\s+você\b|está\s+(marcado|agendado|confirmado)\b|\bconfirmei\s+(o|seu|a\s+sua?)\s+(agendamento|remarca[cç][aã]o|horário)\b/i;
      const REAL_CONFIRMATION_STATES = new Set<string>([
        "appointment_created",
        "appointment_rescheduled",
        "appointment_cancelled",
        "plan_subscribed",
      ]);
      if (FALSE_CONFIRMATION_RE.test(reply) && !REAL_CONFIRMATION_STATES.has(result.state ?? "")) {
        console.warn(
          "[ai-worker] jobId=%s suppressed hallucinated booking confirmation (state=%s) conversationId=%s",
          jobId,
          result.state ?? "—",
          conversationId
        );
        reply =
          "Não consegui validar essa confirmação aqui no sistema. Um atendente confere pra você em instantes, combinado?";
      }
      if (!isSandbox && reply) {
        const violations = detectViolations(reply);
        const emojiCount = (reply.match(/\p{Extended_Pictographic}/gu) ?? []).length;
        await pool.query(
          `INSERT INTO public.ai_quality_metrics (barbershop_id, conversation_id, violations, emoji_count)
           VALUES ($1, $2, $3, $4)`,
          [barbershopId, conversationId, violations, emojiCount]
        ).catch((e) => console.warn("[ai-worker] failed to insert quality metrics:", e));
      }
      console.info(
        "[ai-worker] jobId=%s AI reply len=%s state=%s prompt_tokens=%s completion_tokens=%s",
        jobId,
        reply.length,
        result.state ?? "—",
        result.usage?.prompt_tokens ?? "—",
        result.usage?.completion_tokens ?? "—"
      );
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
      // Empty reply means human handoff — do not send any message.
      const parts = String(reply ?? "")
        .split("[[MSG]]")
        .map((p) => sanitizeOutgoingText(p))
        .filter((p) => p.length > 0);
      if (!parts.length) {
        console.info("[ai-worker] jobId=%s empty reply, skipping send (human handoff)", jobId);
        await updateConversationLastMessage(conversationId);
        await markJobDone(jobId);
        return true;
      }
      const toSend = parts;
      for (const part of toSend) {
        if (baseDelayMs > 0 || msPerChar > 0) {
          const delay = baseDelayMs + part.length * msPerChar + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
          if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
        }
        try {
          const sent = await sendText({ token, number: fromPhone, text: part });
          const providerMessageId = extractProviderMessageId(sent);
          await pool.query(
            `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id, delivery_status)
             VALUES ($1, 'assistant', $2, $3, 'sent')`,
            [conversationId, part, providerMessageId]
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          if (isPermanentUazapiSendError(errMsg)) {
            console.warn("[ai-worker] jobId=%s permanent delivery failure: %s", jobId, errMsg);
            // Persist the attempted message as failed, and route to human followup (do not retry job).
            await pool.query(
              `INSERT INTO public.ai_messages (conversation_id, role, content, delivery_status)
               VALUES ($1, 'assistant', $2, 'failed')`,
              [conversationId, part]
            ).catch(() => {});
            try {
              await pool.query(
                `UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`,
                [conversationId]
              );
            } catch { /* optional column */ }
            try {
              await pool.query(
                `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
                 VALUES ($1, $2, 'pending_review', 'delivery_failure', $3)`,
                [barbershopId, conversationId, "Falha permanente ao enviar mensagem (número não está no WhatsApp)"]
              );
            } catch { /* optional table */ }
            await updateConversationLastMessage(conversationId);
            await markJobDone(jobId);
            return true;
          }
          throw e;
        }
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
    if (attempts >= (config.aiJobMaxAttempts ?? 5)) {
      // Mark conversation for human followup when job exhausts all retries
      try {
        await pool.query(
          `UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`,
          [conversationId]
        );
      } catch { /* column may not exist yet — safe to ignore */ }
      try {
        await pool.query(
          `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
           VALUES ($1, $2, 'pending_review', 'job_failure', 'Job atingiu limite máximo de tentativas')`,
          [barbershopId, conversationId]
        );
      } catch { /* table may not exist yet — safe to ignore */ }
      console.warn("[ai-worker] job %s dead (maxAttempts=%s), conversation %s marked for human followup", jobId, attempts, conversationId);
    }
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
