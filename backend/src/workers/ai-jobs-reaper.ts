import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { config } from "../config.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";

/**
 * Reaper de ai_jobs presos em `processing`.
 *
 * Um worker que morre no meio do turno (deploy, OOM, timeout da Lambda) deixa o job em `processing` para sempre:
 * getNextJob só pega `queued`, então o cliente fica sem resposta. O reaper age sobre os jobs cujo lock passou de
 * `AI_JOB_PROCESSING_TIMEOUT_SECONDS` (padrão 240 s = timeout da Lambda worker_ai 180 s + 60 s; constante única em
 * `lib/ai-job-timing.ts`, a MESMA que o inbound usa para não criar job novo enquanto o antigo pode estar vivo).
 *
 * Por job vencido (cada um numa transação, com `FOR UPDATE SKIP LOCKED`, então várias instâncias são seguras):
 *  1. já existe outro job `queued` da mesma conversa → este vira `done` («superado por job mais novo»), nunca dois
 *     jobs reexecutando a mesma conversa (e o cliente nunca recebe duas respostas);
 *  2. `attempts >= AI_JOB_MAX_ATTEMPTS` → `dead` + atendimento humano + `agent_stuck`;
 *  3. o turno JÁ AGIU (mensagem `assistant`/`tool` da conversa ou `agenda_activity` depois do lock) → NÃO é repetido
 *     (idempotência): `dead` + atendimento humano. Reexecutar poderia duplicar uma ferramenta com efeito ou
 *     responder «horário indisponível» sobre o agendamento que o próprio agente acabou de criar;
 *  4. caso contrário volta para `queued` com backoff.
 *
 * Falhas não ficam silenciosas: se o handoff/flag falhar, a transação inteira é revertida (o job continua em
 * `processing` e é tentado de novo no próximo ciclo, nunca fica `dead` sem aviso ao humano), o erro é logado e
 * contado na métrica `ReaperErrors` (EMF no CloudWatch, sem infra nova).
 */

export type ReapResult = { requeued: number; dead: number; superseded: number; errors: number };
type Outcome = "requeued" | "dead_exhausted" | "dead_acted" | "superseded" | "skipped";

export function reaperTimeoutSeconds(): number {
  return config.aiJobProcessingTimeoutSeconds;
}

/** Métrica via CloudWatch Embedded Metric Format (a Lambda publica sozinha a partir do stdout). */
export function emitReaperMetrics(values: { ReaperRequeued?: number; ReaperDead?: number; ReaperSuperseded?: number; ReaperErrors?: number }): void {
  const names = Object.keys(values).filter((k) => (values as Record<string, number>)[k] > 0);
  if (names.length === 0) return;
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{ Namespace: "NavalhIA/AiWorker", Dimensions: [[]], Metrics: names.map((n) => ({ Name: n, Unit: "Count" })) }],
      },
      ...Object.fromEntries(names.map((n) => [n, (values as Record<string, number>)[n]])),
      message: "ai-jobs-reaper metrics",
    }),
  );
}

type Candidate = { id: string; barbershop_id: string; conversation_id: string; attempts: number; payload_json: { fromPhone?: string } | null; since: Date };

export async function reapStuckAiJobs(opts?: { timeoutSeconds?: number; maxAttempts?: number }): Promise<ReapResult> {
  const timeout = Math.max(1, Math.floor(opts?.timeoutSeconds ?? reaperTimeoutSeconds()));
  const maxAttempts = Math.max(1, Math.floor(opts?.maxAttempts ?? config.aiJobMaxAttempts ?? 5));
  const backoffBase = config.aiJobBackoffBaseSeconds ?? 2;
  const result: ReapResult = { requeued: 0, dead: 0, superseded: 0, errors: 0 };

  const candidates = await pool.query<Candidate>(
    `SELECT id, barbershop_id, conversation_id, attempts, payload_json, COALESCE(locked_at, updated_at) AS since
       FROM public.ai_jobs
      WHERE status = 'processing'
        AND COALESCE(locked_at, updated_at) < now() - make_interval(secs => $1::int)
      ORDER BY COALESCE(locked_at, updated_at)
      LIMIT 100`,
    [timeout],
  );

  for (const job of candidates.rows) {
    try {
      const outcome = await reapOne(job, { timeout, maxAttempts, backoffBase });
      if (outcome === "requeued") result.requeued++;
      else if (outcome === "dead_exhausted" || outcome === "dead_acted") {
        result.dead++;
        await recordOperationalActivity({
          barbershopId: job.barbershop_id,
          conversationId: job.conversation_id,
          clientPhone: job.payload_json?.fromPhone ?? null,
          type: "agent_stuck",
          summary:
            outcome === "dead_acted"
              ? "Agente travou depois de agir (mensagem ou agenda); o turno não foi repetido — confira a conversa"
              : "Agente travou e o processamento expirou — cliente sem resposta",
        });
      } else if (outcome === "superseded") result.superseded++;
    } catch (e) {
      // A transação do job foi revertida: ele segue em `processing` e será tentado no próximo ciclo.
      result.errors++;
      console.error("[ai-jobs-reaper] falha ao tratar job %s (será tentado de novo no próximo ciclo):", job.id, e instanceof Error ? e.message : e);
    }
  }
  emitReaperMetrics({ ReaperRequeued: result.requeued, ReaperDead: result.dead, ReaperSuperseded: result.superseded, ReaperErrors: result.errors });
  return result;
}

async function reapOne(job: Candidate, o: { timeout: number; maxAttempts: number; backoffBase: number }): Promise<Outcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Reavalia o predicado com lock de linha: se outra instância já tratou, não faz nada.
    const locked = await client.query<{ attempts: number; since: Date }>(
      `SELECT attempts, COALESCE(locked_at, updated_at) AS since
         FROM public.ai_jobs
        WHERE id = $1 AND status = 'processing'
          AND COALESCE(locked_at, updated_at) < now() - make_interval(secs => $2::int)
        FOR UPDATE SKIP LOCKED`,
      [job.id, o.timeout],
    );
    const row = locked.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return "skipped";
    }
    const reason = (txt: string) => `reaper: ${txt} (processing por mais de ${o.timeout}s)`;

    const newer = await client.query(
      `SELECT 1 FROM public.ai_jobs WHERE conversation_id = $1 AND id <> $2 AND status = 'queued' LIMIT 1`,
      [job.conversation_id, job.id],
    );
    if (newer.rows.length > 0) {
      await client.query(
        `UPDATE public.ai_jobs SET status = 'done', locked_at = NULL, locked_by = NULL, last_error = $2, updated_at = now() WHERE id = $1`,
        [job.id, reason("superado por job mais novo da mesma conversa")],
      );
      await client.query("COMMIT");
      console.warn("[ai-jobs-reaper] job %s superado por job mais novo da conversa %s (não reexecutado)", job.id, job.conversation_id);
      return "superseded";
    }

    if (row.attempts >= o.maxAttempts) {
      await markDead(client, job, reason("tentativas esgotadas"), "Job preso em processing esgotou as tentativas");
      await client.query("COMMIT");
      console.warn("[ai-jobs-reaper] job %s → dead (tentativas esgotadas), conversa %s para atendimento humano", job.id, job.conversation_id);
      return "dead_exhausted";
    }

    if (await turnAlreadyActed(client, job.conversation_id, row.since)) {
      await markDead(client, job, reason("o turno já agiu; não repetido"), "Job preso depois de o agente agir (mensagem/agenda); turno não repetido");
      await client.query("COMMIT");
      console.warn("[ai-jobs-reaper] job %s → dead (turno já agiu; não repetido), conversa %s para atendimento humano", job.id, job.conversation_id);
      return "dead_acted";
    }

    await client.query(
      `UPDATE public.ai_jobs
          SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = $2,
              run_after = now() + make_interval(secs => LEAST(power($3::numeric, attempts), 3600)::int),
              updated_at = now()
        WHERE id = $1`,
      [job.id, reason("devolvido à fila"), o.backoffBase],
    );
    await client.query("COMMIT");
    console.warn("[ai-jobs-reaper] job %s devolvido à fila (tentativa %s/%s)", job.id, row.attempts, o.maxAttempts);
    return "requeued";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** O agente já produziu efeito neste turno? (resposta ou ferramenta persistida, ou atividade de agenda, depois do lock) */
async function turnAlreadyActed(client: PoolClient, conversationId: string, since: Date): Promise<boolean> {
  const msg = await client.query(
    `SELECT 1 FROM public.ai_messages WHERE conversation_id = $1 AND role IN ('assistant', 'tool') AND created_at >= $2 LIMIT 1`,
    [conversationId, since],
  );
  if (msg.rows.length > 0) return true;
  const act = await client.query(
    `SELECT 1 FROM public.agenda_activity
      WHERE conversation_id = $1 AND created_at >= $2
        AND type IN ('appointment_created', 'rescheduled', 'cancelled', 'confirmed') LIMIT 1`,
    [conversationId, since],
  );
  return act.rows.length > 0;
}

async function markDead(client: PoolClient, job: Candidate, lastError: string, handoffReason: string): Promise<void> {
  await client.query(
    `UPDATE public.ai_jobs SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error = $2, updated_at = now() WHERE id = $1`,
    [job.id, lastError],
  );
  // Sem engolir erro: se o handoff falhar a transação reverte e o job NÃO fica dead sem o humano ser avisado.
  await client.query(`UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`, [job.conversation_id]);
  await client.query(
    `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
     VALUES ($1, $2, 'pending_review', 'job_failure', $3)`,
    [job.barbershop_id, job.conversation_id, handoffReason],
  );
}

let lastRunMs = 0;

/** Chamado a cada ciclo do worker; só executa de fato no máximo 1x por intervalo. Nunca lança (mas loga e conta o erro). */
export async function maybeReapStuckAiJobs(now = Date.now()): Promise<ReapResult | null> {
  const intervalMs = Math.max(1, config.aiJobReaperIntervalSeconds || 60) * 1000;
  if (now - lastRunMs < intervalMs) return null;
  lastRunMs = now;
  try {
    return await reapStuckAiJobs();
  } catch (e) {
    console.error("[ai-jobs-reaper] varredura falhou (jobs presos podem continuar presos):", e instanceof Error ? e.message : e);
    emitReaperMetrics({ ReaperErrors: 1 });
    return null;
  }
}

/** Só para testes. */
export function resetReaperThrottleForTests(): void {
  lastRunMs = 0;
}
