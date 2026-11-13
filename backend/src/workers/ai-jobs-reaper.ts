import { pool } from "../db.js";
import { config } from "../config.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";

/**
 * Reaper de ai_jobs presos em `processing`.
 *
 * Um worker que morre no meio do turno (deploy, OOM, timeout da Lambda) deixa o job em `processing` para sempre:
 * getNextJob só pega `queued`, então o cliente fica sem resposta. O reaper devolve à fila os jobs cujo lock passou
 * de `AI_JOB_PROCESSING_TIMEOUT_SECONDS` (padrão 600 s, bem acima de um turno normal do agente) e, se as tentativas
 * já se esgotaram (`attempts >= AI_JOB_MAX_ATTEMPTS`; `attempts` é incrementado quando o job é pego), manda para o
 * dead-letter (`status = 'dead'`, que o schema já prevê) e marca a conversa para atendimento humano.
 *
 * Roda dentro do ciclo do worker existente (`runAiWorkerCycle`, usado pelo loop e pela Lambda), no máximo uma vez
 * por `AI_JOB_REAPER_INTERVAL_SECONDS` por processo. Sem infra nova. Várias instâncias rodando juntas são seguras:
 * cada UPDATE reavalia o predicado e só uma instância muda cada linha.
 */

export type ReapResult = { requeued: number; dead: number };

export function reaperTimeoutSeconds(): number {
  const n = config.aiJobProcessingTimeoutSeconds;
  return Number.isFinite(n) && n > 0 ? n : 600;
}

export async function reapStuckAiJobs(opts?: { timeoutSeconds?: number; maxAttempts?: number }): Promise<ReapResult> {
  const timeout = Math.max(1, Math.floor(opts?.timeoutSeconds ?? reaperTimeoutSeconds()));
  const maxAttempts = Math.max(1, Math.floor(opts?.maxAttempts ?? config.aiJobMaxAttempts ?? 5));
  const reason = `reaper: job preso em processing por mais de ${timeout}s (worker provavelmente morreu)`;

  // 1) Esgotou tentativas → dead-letter.
  const dead = await pool.query<{ id: string; barbershop_id: string; conversation_id: string; payload_json: { fromPhone?: string } | null }>(
    `UPDATE public.ai_jobs
        SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error = $3, updated_at = now()
      WHERE status = 'processing'
        AND COALESCE(locked_at, updated_at) < now() - make_interval(secs => $1::int)
        AND attempts >= $2::int
      RETURNING id, barbershop_id, conversation_id, payload_json`,
    [timeout, maxAttempts, reason]
  );
  for (const j of dead.rows) {
    console.warn("[ai-jobs-reaper] job %s → dead (attempts esgotadas), conversa %s para atendimento humano", j.id, j.conversation_id);
    await markConversationForHuman(j.barbershop_id, j.conversation_id);
    await recordOperationalActivity({
      barbershopId: j.barbershop_id,
      conversationId: j.conversation_id,
      clientPhone: j.payload_json?.fromPhone ?? null,
      type: "agent_stuck",
      summary: "Agente travou e o processamento expirou — cliente sem resposta",
    });
  }

  // 2) Ainda tem tentativas → volta para a fila com backoff.
  const requeued = await pool.query<{ id: string; attempts: number }>(
    `UPDATE public.ai_jobs
        SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = $3,
            run_after = now() + make_interval(secs => LEAST(power($4::numeric, attempts), 3600)::int),
            updated_at = now()
      WHERE status = 'processing'
        AND COALESCE(locked_at, updated_at) < now() - make_interval(secs => $1::int)
        AND attempts < $2::int
      RETURNING id, attempts`,
    [timeout, maxAttempts, reason, config.aiJobBackoffBaseSeconds ?? 2]
  );
  for (const j of requeued.rows) {
    console.warn("[ai-jobs-reaper] job %s devolvido à fila (tentativa %s/%s)", j.id, j.attempts, maxAttempts);
  }
  return { requeued: requeued.rowCount ?? 0, dead: dead.rowCount ?? 0 };
}

async function markConversationForHuman(barbershopId: string, conversationId: string): Promise<void> {
  try {
    await pool.query(`UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`, [conversationId]);
  } catch {
    /* coluna opcional */
  }
  try {
    await pool.query(
      `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
       VALUES ($1, $2, 'pending_review', 'job_reaper', 'Job preso em processing esgotou as tentativas')`,
      [barbershopId, conversationId]
    );
  } catch {
    /* tabela opcional */
  }
}

let lastRunMs = 0;

/** Chamado a cada ciclo do worker; só executa de fato no máximo 1x por intervalo. Nunca lança. */
export async function maybeReapStuckAiJobs(now = Date.now()): Promise<ReapResult | null> {
  const intervalMs = Math.max(1, config.aiJobReaperIntervalSeconds || 60) * 1000;
  if (now - lastRunMs < intervalMs) return null;
  lastRunMs = now;
  try {
    return await reapStuckAiJobs();
  } catch (e) {
    console.error("[ai-jobs-reaper] falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Só para testes. */
export function resetReaperThrottleForTests(): void {
  lastRunMs = 0;
}
