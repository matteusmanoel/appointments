import "../load-env.js";
import { pool } from "../db.js";
import { config } from "../config.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";
import { confirmAssistantMessage, newBotPendingId, reserveAssistantMessage } from "../integrations/whatsapp/bot-pending.js";
import { bumpOrEnqueueJob } from "../integrations/whatsapp/inbound.js";
import {
  clampInboundQuietSeconds,
  shouldDropReplyBecauseTurnGrew,
} from "../integrations/whatsapp/inbound-turn.js";
import { runAgent, detectViolations, sanitizeClientFacingReply, containsAiExposure, looksLikeHallucinatedBookingClaim, replyClaimsPresenceConfirmed } from "../ai/agent.js";
import { logTurnTrace, maskPhone, previewError, previewText, type AgentTurnTrace, type TurnTraceOutbound } from "../ai/turn-trace.js";
import { persistTurnSheet } from "../ai/turn-sheet-store.js";
import { splitOutgoingBubbles, stripTrailingBubblePeriod } from "../ai/date-calendar.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";
import { enqueueOutboundEvent, dispatchOutboundEvents } from "../outbound/n8n-events.js";
import { ensureCriticalSchema } from "../db/ensure-schema.js";
import { classifySendError } from "../integrations/whatsapp/send-error-policy.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";
import OpenAI from "openai";
import { maybeAlertAiUsage } from "../ai/usage-alert.js";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_MS = 1500;
const OUTBOUND_INTERVAL_MS = 20_000;
const FALLBACK_MESSAGE = "";

const MAX_EMOJIS_PER_MESSAGE = 4;

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

const TOOL_FAILURE_ACTIVITY: Record<string, { type: "send_failure" | "payment_failed"; summary: string }> = {
  send_shop_pix: { type: "payment_failed", summary: "PIX da barbearia não enviado ao cliente" },
  send_pix_plan_charge: { type: "payment_failed", summary: "Cobrança do plano não enviada ao cliente" },
  send_barbershop_location: { type: "send_failure", summary: "Localização não enviada ao cliente" },
};
const TOOL_ERROR_ESCALATION_THRESHOLD = 2;

/** Outbound tools that failed, charges that went out, and turns with repeated tool errors → agenda feed. */
async function recordToolOutcomeActivity(params: {
  barbershopId: string;
  conversationId: string;
  clientPhone: string;
  tools: Array<{ name: string; ok: boolean }>;
}): Promise<void> {
  const base = {
    barbershopId: params.barbershopId,
    conversationId: params.conversationId,
    clientPhone: params.clientPhone,
  };
  for (const tool of params.tools) {
    const failure = TOOL_FAILURE_ACTIVITY[tool.name];
    if (!tool.ok && failure) {
      await recordOperationalActivity({ ...base, type: failure.type, summary: failure.summary });
    }
    if (tool.ok && tool.name === "send_pix_plan_charge") {
      await recordOperationalActivity({ ...base, type: "payment_sent", summary: "Cobrança do plano enviada pelo agente" });
    }
  }
  const failures = params.tools.filter((t) => !t.ok);
  if (failures.length >= TOOL_ERROR_ESCALATION_THRESHOLD) {
    await recordOperationalActivity({
      ...base,
      type: "tool_error_escalated",
      summary: `Agente encontrou ${failures.length} erros ao executar ações — revisar conversa`,
    });
  }
}

const SILENCED_REASON_LABELS: Record<string, string> = {
  worker_false_confirmation: "confirmação sem registro na agenda",
  ai_exposure: "resposta expunha erro interno",
  unaligned_hour: "horário fora do expediente",
  repeated_reply: "resposta repetida",
  catalog_mismatch: "serviço ou barbeiro fora do catálogo",
  tool_loop_exhausted: "agente não concluiu a resposta",
};

function silencedReasonLabel(reason: string | undefined): string {
  return (reason && SILENCED_REASON_LABELS[reason]) || "sem resposta gerada";
}

async function markConversationForFollowup(params: {
  barbershopId: string;
  conversationId: string;
  triggeredBy: string;
  reason: string;
}): Promise<void> {
  try {
    await pool.query(
      `UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`,
      [params.conversationId]
    );
  } catch { /* optional column */ }
  try {
    await pool.query(
      `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
       VALUES ($1, $2, 'pending_review', $3, $4)`,
      [params.barbershopId, params.conversationId, params.triggeredBy, params.reason]
    );
  } catch { /* optional table */ }
}

/** Keeps undelivered bubbles on the job so a transient provider failure retries the send, not the agent. */
async function stashPendingReplyParts(jobId: string, parts: string[]): Promise<void> {
  await pool
    .query(
      `UPDATE public.ai_jobs
       SET payload_json = coalesce(payload_json, '{}'::jsonb) || jsonb_build_object('pending_reply_parts', $2::jsonb),
           updated_at = now()
       WHERE id = $1`,
      [jobId, JSON.stringify(parts)],
    )
    .catch((e) => console.warn("[ai-worker] stashPendingReplyParts failed:", e instanceof Error ? e.message : e));
}

async function getNextJob(): Promise<{
  id: string;
  barbershop_id: string;
  conversation_id: string;
  payload_json: { fromPhone: string; text: string; provider_event_id?: string; pending_reply_parts?: string[] };
  attempts: number;
  locked_at: Date | null;
} | null> {
  const quietSecs = clampInboundQuietSeconds(config.aiInboundQuietSeconds);
  const quietPredicate = `
        AND (
          SELECT coalesce(max(m.created_at), '-infinity'::timestamptz)
          FROM public.ai_messages m
          WHERE m.conversation_id = j.conversation_id AND m.role = 'user'
        ) <= now() - make_interval(secs => $2::int)`;
  const primarySql = `UPDATE public.ai_jobs
     SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
      SELECT j.id
      FROM public.ai_jobs j
      WHERE j.status = 'queued'
        AND j.run_after <= now()
        ${quietPredicate}
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
     RETURNING id, barbershop_id, conversation_id, payload_json, attempts, locked_at`;
  const fallbackSql = `UPDATE public.ai_jobs
     SET status = 'processing', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
      SELECT j.id
      FROM public.ai_jobs j
      WHERE j.status = 'queued'
        AND j.run_after <= now()
        ${quietPredicate}
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
     RETURNING id, barbershop_id, conversation_id, payload_json, attempts, locked_at`;
  let r;
  try {
    r = await pool.query<{
    id: string;
    barbershop_id: string;
    conversation_id: string;
    payload_json: unknown;
    attempts: number;
    locked_at: Date | null;
    }>(primarySql, [WORKER_ID, quietSecs]);
  } catch (e) {
    if (!isUndefinedTableOrColumn(e)) throw e;
    try {
      r = await pool.query<{
        id: string;
        barbershop_id: string;
        conversation_id: string;
        payload_json: unknown;
        attempts: number;
        locked_at: Date | null;
      }>(fallbackSql, [WORKER_ID, quietSecs]);
    } catch (e2) {
      if (!isUndefinedTableOrColumn(e2)) throw e2;
      return null;
    }
  }
  const row = r.rows[0];
  if (!row) return null;
  const payload = row.payload_json as {
    fromPhone?: string;
    text?: string;
    provider_event_id?: string;
    providerEventId?: string;
    pending_reply_parts?: unknown;
  };
  const pendingParts = Array.isArray(payload?.pending_reply_parts)
    ? payload.pending_reply_parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];
  return {
    id: row.id,
    barbershop_id: row.barbershop_id,
    conversation_id: row.conversation_id,
    payload_json: {
      fromPhone: payload?.fromPhone ?? "",
      text: payload?.text ?? "",
      provider_event_id: payload?.provider_event_id ?? payload?.providerEventId,
      ...(pendingParts.length ? { pending_reply_parts: pendingParts } : {}),
    },
    attempts: row.attempts,
    locked_at: row.locked_at ?? null,
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
  const { fromPhone, text: userTextFromJob } = payload_json;
  const providerEventId =
    (payload_json as { providerEventId?: string }).providerEventId ??
    payload_json.provider_event_id ??
    null;
  const turnSink: {
    state?: string;
    replyLen: number;
    replyText?: string;
    silencedBy?: string;
    agent: AgentTurnTrace | null;
    outbound: TurnTraceOutbound;
  } = {
    replyLen: 0,
    agent: null,
    outbound: { status: "not_sent" },
  };
  console.info("[ai-worker] processing jobId=%s barbershopId=%s conversationId=%s fromPhone=%s", jobId, barbershopId, conversationId, fromPhone);

  try {
    await ensureAiSettingsRow(barbershopId);
    const aiEnabled = await isAiEnabled(barbershopId);
    if (!aiEnabled) {
      console.info("[ai-worker] jobId=%s AI is disabled, skipping silently barbershopId=%s", jobId, barbershopId);
      turnSink.outbound = { status: "ai_disabled" };
      await updateConversationLastMessage(conversationId);
      await markJobDone(jobId);
      return true;
    }

    // No provider session → the reply could never be delivered; do not spend OpenAI tokens.
    const session = await getWhatsAppOrNull(barbershopId);
    if (!session) {
      turnSink.outbound = { status: "whatsapp_disconnected" };
      console.warn("[ai-worker] jobId=%s WhatsApp not connected, skipping agent barbershopId=%s", jobId, barbershopId);
      await recordOperationalActivity({
        barbershopId,
        conversationId,
        clientPhone: fromPhone,
        type: "send_failure",
        summary: "WhatsApp desconectado — mensagem do cliente ficou sem resposta",
      });
      await updateConversationLastMessage(conversationId);
      await markJobDone(jobId);
      return true;
    }

    const cachedParts = payload_json.pending_reply_parts ?? [];
    let reply: string;

    if (cachedParts.length) {
      // Retry after a transient send failure: resend what the agent already produced.
      reply = cachedParts.join("\n");
      turnSink.replyText = reply;
      turnSink.state = "cached_reply";
      turnSink.replyLen = reply.length;
    } else if (config.nativeAiDisabled) {
      try {
        const raw = await callN8nAgent(conversationId, fromPhone, barbershopId, String(userTextFromJob ?? ""));
        reply = sanitizeClientFacingReply(raw);
        turnSink.replyText = reply;
        console.info("[ai-worker] jobId=%s n8n reply len=%s", jobId, reply.length);
        turnSink.state = "n8n";
        turnSink.replyLen = reply.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ai-worker] jobId=%s n8n error: %s", jobId, msg);
        reply = FALLBACK_MESSAGE;
        turnSink.replyText = reply;
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
      turnSink.state = "no_openai_key";
      reply = FALLBACK_MESSAGE;
      turnSink.replyText = reply;
    } else {
      const usage = await getUsageAndLimit(barbershopId);
      if (usage.hardExceeded) {
        console.warn("[ai-worker] hard limit exceeded barbershopId=%s used=%s limit=%s", barbershopId, usage.used, usage.limit);
        turnSink.state = "hard_limit";
        reply = "";
        turnSink.replyText = reply;
      } else {
        if (usage.softExceeded) {
          console.warn("[ai-worker] soft limit exceeded barbershopId=%s used=%s limit=%s", barbershopId, usage.used, usage.limit);
        }
        // Aviso ao dono em 80% do limite (atrás de AI_USAGE_ALERT_ENABLED; desligado por padrão; nunca bloqueia o turno).
        // AGUARDADO com teto de 3 s (um `void` solto podia ser congelado pelo fim do ciclo da Lambda no meio do envio).
        await Promise.race([
          maybeAlertAiUsage({ barbershopId, used: usage.used, limit: usage.limit }),
          new Promise<void>((resolve) => setTimeout(resolve, 3000).unref?.()),
        ]);
        const openai = new OpenAI({ apiKey: config.openaiApiKey });
        const result = await runAgent(barbershopId, conversationId, fromPhone, openai, {
          persistAssistantMessages: false,
        });
      reply = sanitizeClientFacingReply(result.reply);
      turnSink.replyText = reply;
      turnSink.agent = result.turnTrace ?? null;
      turnSink.state = result.state;
      turnSink.replyLen = reply.length;
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
      const REAL_CONFIRMATION_STATES = new Set<string>([
        "appointment_created",
        "appointment_rescheduled",
        "appointment_cancelled",
        "appointment_confirmed",
        "plan_subscribed",
      ]);
      if (
        (looksLikeHallucinatedBookingClaim(reply) ||
          replyClaimsPresenceConfirmed(reply) ||
          containsAiExposure(reply)) &&
        !REAL_CONFIRMATION_STATES.has(result.state ?? "")
      ) {
        console.warn(
          "[ai-worker] jobId=%s suppressed hallucinated booking confirmation (state=%s) conversationId=%s",
          jobId,
          result.state ?? "—",
          conversationId
        );
        reply = "";
        turnSink.replyText = reply;
        turnSink.silencedBy = "worker_false_confirmation";
      }
      if (!reply && !turnSink.silencedBy && result.turnTrace?.silencedBy) {
        turnSink.silencedBy = result.turnTrace.silencedBy;
      }
      if (!isSandbox && result.turnTrace) {
        await recordToolOutcomeActivity({
          barbershopId,
          conversationId,
          clientPhone: fromPhone,
          tools: result.turnTrace.toolsExecuted,
        });
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

    {
      const lastUserRow = await pool.query<{ last_user_at: Date | null }>(
        `SELECT max(created_at) AS last_user_at
         FROM public.ai_messages
         WHERE conversation_id = $1 AND role = 'user'`,
        [conversationId],
      );
      const lastUserAt = lastUserRow.rows[0]?.last_user_at;
      const lockedAt = job.locked_at;
      if (
        lastUserAt &&
        lockedAt &&
        shouldDropReplyBecauseTurnGrew({
          latestUserAtMs: new Date(lastUserAt).getTime(),
          jobLockedAtMs: new Date(lockedAt).getTime(),
        })
      ) {
        console.info(
          "[ai-worker] jobId=%s dropped half-turn reply conversationId=%s",
          jobId,
          conversationId,
        );
        turnSink.outbound = { status: "dropped_half_turn" };
        await markJobDone(jobId);
        await bumpOrEnqueueJob({
          barbershopId,
          conversationId,
          fromPhone,
          text: String(userTextFromJob ?? ""),
          logPrefix: "ai-worker",
        });
        return true;
      }
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

      const parts = cachedParts.length
        ? cachedParts.slice(0, 3)
        : splitOutgoingBubbles(String(reply ?? ""))
            .map((p) => stripTrailingBubblePeriod(sanitizeOutgoingText(p)))
            .filter((p) => p.length > 0)
            .slice(0, 3);
      if (!parts.length) {
        turnSink.outbound = { status: "empty_reply" };
        console.info("[ai-worker] jobId=%s empty reply, skipping send (human handoff)", jobId);
        if (turnSink.agent || turnSink.silencedBy) {
          await recordOperationalActivity({
            barbershopId,
            conversationId,
            clientPhone: fromPhone,
            type: "agent_silenced",
            summary: `Agente silenciado — revisar conversa (${silencedReasonLabel(turnSink.silencedBy)})`,
          });
        }
        await updateConversationLastMessage(conversationId);
        await markJobDone(jobId);
        return true;
      }
      const sentIds: string[] = [];
      for (const [partIndex, part] of parts.entries()) {
        if (baseDelayMs > 0 || msPerChar > 0) {
          const delay = baseDelayMs + part.length * msPerChar + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
          if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));
        }
        const pendingId = newBotPendingId();
        await reserveAssistantMessage({ conversationId, content: part, pendingId });
        try {
          const sent = await session.sendText(fromPhone, part);
          if (sent.providerMessageId) sentIds.push(sent.providerMessageId);
          await confirmAssistantMessage({
            conversationId,
            pendingId,
            providerMessageId: sent.providerMessageId,
            deliveryStatus: "sent",
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          await confirmAssistantMessage({
            conversationId,
            pendingId,
            providerMessageId: null,
            deliveryStatus: "failed",
          }).catch(() => {});
          const sendErrorClass = classifySendError(errMsg);
          if (sendErrorClass !== "transient") {
            const notOnWhatsApp = sendErrorClass === "not_on_whatsapp";
            turnSink.outbound = {
              status: notOnWhatsApp ? "permanent_failure" : "provider_rejected",
              error: previewError(errMsg),
              bubbles: parts.length,
              providerMessageIds: sentIds,
            };
            console.warn("[ai-worker] jobId=%s non-retryable delivery failure (%s): %s", jobId, sendErrorClass, errMsg);
            await markConversationForFollowup({
              barbershopId,
              conversationId,
              triggeredBy: "delivery_failure",
              reason: notOnWhatsApp
                ? "Falha permanente ao enviar mensagem (número não está no WhatsApp)"
                : "Provedor WhatsApp recusou o envio da mensagem",
            });
            await recordOperationalActivity({
              barbershopId,
              conversationId,
              clientPhone: fromPhone,
              type: "send_failure",
              summary: notOnWhatsApp
                ? "Mensagem não entregue — número não está no WhatsApp"
                : "Mensagem não entregue — WhatsApp recusou o envio",
            });
            await updateConversationLastMessage(conversationId);
            await markJobDone(jobId);
            return true;
          }
          await stashPendingReplyParts(jobId, parts.slice(partIndex));
          throw e;
        }
      }
      turnSink.outbound = { status: "sent", bubbles: parts.length, providerMessageIds: sentIds };
      console.info("[ai-worker] jobId=%s sent to fromPhone=%s", jobId, fromPhone);
    }
    await updateConversationLastMessage(conversationId);
    await markJobDone(jobId);
    return true;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    turnSink.outbound = { status: "job_error", error: previewError(errMsg) };
    console.error(`[ai-worker] job ${jobId} error:`, errMsg);
    await markJobFailed(jobId, errMsg, attempts);
    if (attempts >= (config.aiJobMaxAttempts ?? 5)) {
      await markConversationForFollowup({
        barbershopId,
        conversationId,
        triggeredBy: "job_failure",
        reason: "Job atingiu limite máximo de tentativas",
      });
      await recordOperationalActivity({
        barbershopId,
        conversationId,
        clientPhone: fromPhone,
        type: "agent_stuck",
        summary: "Agente travou após várias tentativas — cliente sem resposta",
      });
      console.warn("[ai-worker] job %s dead (maxAttempts=%s), conversation %s marked for human followup", jobId, attempts, conversationId);
    }
    return true;
  } finally {
    logTurnTrace({
      phase: "agent",
      jobId,
      conversationId,
      barbershopId,
      providerEventId,
      phone: maskPhone(fromPhone),
      inboundPreview: previewText(String(userTextFromJob ?? "")),
      state: turnSink.state ?? null,
      replyLen: turnSink.replyLen,
      silencedBy: turnSink.silencedBy ?? null,
      outbound: turnSink.outbound,
      decisionOwner: turnSink.agent?.decisionOwner ?? null,
      conversationState: turnSink.agent?.conversationState ?? null,
      canonicalState: turnSink.agent?.canonicalState ?? null,
      intent: turnSink.agent?.intent ?? null,
      routing: turnSink.agent?.routing ?? null,
      openai: turnSink.agent?.openai ?? [],
      toolsExecuted: turnSink.agent?.toolsExecuted ?? [],
    });
    await persistTurnSheet({
      at: new Date().toISOString(),
      phase: "agent",
      jobId,
      conversationId,
      barbershopId,
      providerEventId,
      phone: maskPhone(fromPhone),
      inboundPreview: previewText(String(userTextFromJob ?? "")),
      replyPreview: previewText(turnSink.replyText ?? ""),
      state: turnSink.state ?? null,
      silencedBy: turnSink.silencedBy ?? null,
      outbound: turnSink.outbound,
      decisionOwner: turnSink.agent?.decisionOwner ?? null,
      conversationState: turnSink.agent?.conversationState ?? null,
      canonicalState: turnSink.agent?.canonicalState ?? null,
      intent: turnSink.agent?.intent ?? null,
      routing: turnSink.agent?.routing ?? null,
      openai: turnSink.agent?.openai ?? [],
      toolsExecuted: turnSink.agent?.toolsExecuted ?? [],
    }).catch((e) => {
      console.warn("[ai-worker] turn sheet:", e instanceof Error ? e.message : e);
    });
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
