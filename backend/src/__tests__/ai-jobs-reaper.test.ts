import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { pool } from "../db.js";
import { createPublicRoutesFixtures, deletePublicRoutesFixtures, type PublicRoutesFixture } from "./helpers/public-routes.js";
import { bumpOrEnqueueJob } from "../integrations/whatsapp/inbound.js";
import { config } from "../config.js";
import { reapStuckAiJobs, maybeReapStuckAiJobs, resetReaperThrottleForTests } from "../workers/ai-jobs-reaper.js";

describe("reaper de ai_jobs presos em processing", () => {
  let fx: PublicRoutesFixture;
  let conversationId = "";

  const mkJob = async (o: { status?: string; attempts?: number; lockedAgoSec?: number | null; runAfterOffsetSec?: number }) => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_jobs (barbershop_id, conversation_id, payload_json, status, attempts, locked_at, locked_by, run_after)
       VALUES ($1, $2, '{"fromPhone":"5511999990002","text":"oi"}'::jsonb, $3, $4,
               CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(secs => $5::int) END,
               'worker-morto', now() + make_interval(secs => $6::int))
       RETURNING id`,
      [fx.barbershopId, conversationId, o.status ?? "processing", o.attempts ?? 1, o.lockedAgoSec ?? null, o.runAfterOffsetSec ?? 0]
    );
    return r.rows[0].id;
  };
  const get = async (id: string) =>
    (await pool.query("SELECT status, attempts, locked_at, locked_by, last_error, run_after > now() AS in_future FROM public.ai_jobs WHERE id = $1", [id])).rows[0];

  beforeAll(async () => {
    // Sem banco, o teste FALHA aqui (não passa em branco).
    fx = await createPublicRoutesFixtures({});
    conversationId = (
      await pool.query<{ id: string }>(
        "INSERT INTO public.ai_conversations (barbershop_id, external_thread_id) VALUES ($1, $2) RETURNING id",
        [fx.barbershopId, `reaper-${Date.now()}`]
      )
    ).rows[0].id;
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM public.ai_jobs WHERE barbershop_id = $1", [fx.barbershopId]);
    await pool.query("DELETE FROM public.ai_messages WHERE conversation_id = $1", [conversationId]);
    await pool.query("DELETE FROM public.ai_handoff_events WHERE conversation_id = $1", [conversationId]);
    await pool.query("DELETE FROM public.agenda_activity WHERE barbershop_id = $1", [fx.barbershopId]);
    await pool.query("UPDATE public.ai_conversations SET needs_human_followup = false WHERE id = $1", [conversationId]);
    resetReaperThrottleForTests();
  });
  afterAll(async () => {
    await pool.query("DELETE FROM public.ai_jobs WHERE barbershop_id = $1", [fx.barbershopId]);
    await pool.query("DELETE FROM public.agenda_activity WHERE barbershop_id = $1", [fx.barbershopId]).catch(() => undefined);
    await pool.query("DELETE FROM public.ai_handoff_events WHERE barbershop_id = $1", [fx.barbershopId]).catch(() => undefined);
    await pool.query("DELETE FROM public.ai_conversations WHERE barbershop_id = $1", [fx.barbershopId]);
    await deletePublicRoutesFixtures([fx.barbershopId]);
  });

  it("job em processing além do timeout volta para queued, sem lock e com backoff (run_after no futuro)", async () => {
    const stuck = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    const j = await get(stuck);
    expect(j.status).toBe("queued");
    expect(j.locked_at).toBeNull();
    expect(j.locked_by).toBeNull();
    expect(j.in_future).toBe(true);
    expect(j.last_error).toMatch(/reaper/);
    expect(j.attempts).toBe(1); // tentativa já contada no claim; reaper não altera
  });

  it("não toca em job recente, em job queued/done e em processing dentro do prazo", async () => {
    const fresh = await mkJob({ attempts: 1, lockedAgoSec: 30 });
    const queued = await mkJob({ status: "queued", attempts: 0 });
    const done = await mkJob({ status: "done", attempts: 1, lockedAgoSec: 5000 });
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(fresh)).status).toBe("processing");
    expect((await get(queued)).status).toBe("queued");
    expect((await get(done)).status).toBe("done");
  });

  it("tentativas esgotadas → dead-letter, conversa marcada para humano e atividade registrada", async () => {
    const exhausted = await mkJob({ attempts: 5, lockedAgoSec: 900 });
    const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(res.dead).toBeGreaterThanOrEqual(1);
    const j = await get(exhausted);
    expect(j.status).toBe("dead");
    expect(j.locked_by).toBeNull();
    expect(j.last_error).toMatch(/reaper/);
    const conv = await pool.query("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [conversationId]);
    expect(conv.rows[0].needs_human_followup).toBe(true);
    const ev = await pool.query("SELECT triggered_by, event_type FROM public.ai_handoff_events WHERE conversation_id = $1", [conversationId]);
    expect(ev.rows).toEqual([{ triggered_by: "job_failure", event_type: "pending_review" }]);
    const act = await pool.query("SELECT 1 FROM public.agenda_activity WHERE barbershop_id = $1 AND type = 'agent_stuck'", [fx.barbershopId]);
    expect(act.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("tentativas esgotadas vão para dead-letter mesmo com assinatura bloqueada (IA pausada por cobrança)", async () => {
    // O reaper não deve consultar assinatura: jobs esgotados têm de virar dead + handoff humano
    // mesmo quando o atendimento automático está pausado por billing. Este teste trava o contrato.
    await pool.query(
      `UPDATE public.barbershops
          SET stripe_subscription_id = 'sub_test_reaper_blocked',
              subscription_status = 'canceled',
              subscription_current_period_end = now() - interval '1 day',
              subscription_status_changed_at = now() - interval '30 days'
        WHERE id = $1`,
      [fx.barbershopId]
    );
    try {
      const exhausted = await mkJob({ attempts: 5, lockedAgoSec: 900 });
      const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
      expect(res.dead).toBeGreaterThanOrEqual(1);
      expect(res.errors).toBe(0);
      expect((await get(exhausted)).status).toBe("dead");
      expect((await pool.query("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [conversationId])).rows[0].needs_human_followup).toBe(true);
      const ev = await pool.query("SELECT triggered_by, event_type FROM public.ai_handoff_events WHERE conversation_id = $1", [conversationId]);
      expect(ev.rows).toEqual([{ triggered_by: "job_failure", event_type: "pending_review" }]);
      const act = await pool.query("SELECT 1 FROM public.agenda_activity WHERE barbershop_id = $1 AND type = 'agent_stuck'", [fx.barbershopId]);
      expect(act.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.query(
        `UPDATE public.barbershops
            SET stripe_subscription_id = NULL,
                subscription_status = NULL,
                subscription_current_period_end = NULL,
                subscription_status_changed_at = NULL
          WHERE id = $1`,
        [fx.barbershopId]
      );
    }
  });

  it("lock nulo em processing usa updated_at como referência", async () => {
    const id = await mkJob({ attempts: 1, lockedAgoSec: null });
    await pool.query("UPDATE public.ai_jobs SET updated_at = now() - interval '1 hour' WHERE id = $1", [id]);
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(id)).status).toBe("queued");
  });

  it("duas varreduras simultâneas não duplicam nem quebram (idempotente)", async () => {
    const id = await mkJob({ attempts: 2, lockedAgoSec: 900 });
    const [a, b] = await Promise.all([reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 }), reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 })]);
    expect(a.requeued + b.requeued).toBeGreaterThanOrEqual(1);
    expect((await get(id)).status).toBe("queued");
    const again = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(again.requeued).toBe(0);
  });

  it("job devolvido é pego de novo pelo claim do worker (status queued + run_after vencido)", async () => {
    const id = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    await pool.query("UPDATE public.ai_jobs SET run_after = now() - interval '1 second' WHERE id = $1", [id]);
    const claim = await pool.query(
      `UPDATE public.ai_jobs SET status = 'processing', locked_at = now(), attempts = attempts + 1
       WHERE id = (SELECT id FROM public.ai_jobs WHERE id = $1 AND status = 'queued' AND run_after <= now() FOR UPDATE SKIP LOCKED) RETURNING attempts`,
      [id]
    );
    expect(claim.rows[0].attempts).toBe(2);
  });

  it("maybeReapStuckAiJobs respeita o intervalo (throttle) e nunca lança", async () => {
    await mkJob({ attempts: 1, lockedAgoSec: 7200 });
    const first = await maybeReapStuckAiJobs(1_000_000);
    expect(first).not.toBeNull();
    expect(await maybeReapStuckAiJobs(1_000_000 + 1000)).toBeNull();
    expect(await maybeReapStuckAiJobs(1_000_000 + 61_000)).not.toBeNull();
  });
  it("DUPLICADO: se já há outro job queued da conversa, o antigo vira done (superado) e NÃO volta à fila", async () => {
    const old = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    const newer = await mkJob({ status: "queued", attempts: 0 });
    const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(res.superseded).toBe(1);
    const j = await get(old);
    expect(j.status).toBe("done");
    expect(j.last_error).toMatch(/superado por job mais novo/);
    expect((await get(newer)).status).toBe("queued");
    const queued = await pool.query("SELECT count(*)::int AS n FROM public.ai_jobs WHERE conversation_id = $1 AND status = 'queued'", [conversationId]);
    expect(queued.rows[0].n).toBe(1);
  });

  it("IDEMPOTÊNCIA: turno que já respondeu (assistant depois do lock) NÃO é repetido: dead + atendimento humano", async () => {
    const id = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    await pool.query("INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', 'Agendei para amanhã às 10h')", [conversationId]);
    const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(res.dead).toBe(1);
    expect(res.requeued).toBe(0);
    const j = await get(id);
    expect(j.status).toBe("dead");
    expect(j.last_error).toMatch(/já agiu; não repetido/);
    expect((await pool.query("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [conversationId])).rows[0].needs_human_followup).toBe(true);
    const act = await pool.query("SELECT summary FROM public.agenda_activity WHERE barbershop_id = $1 AND type = 'agent_stuck'", [fx.barbershopId]);
    expect(act.rows[0].summary).toMatch(/depois de agir/);
  });

  it("IDEMPOTÊNCIA: ferramenta persistida (role tool) e atividade de agenda depois do lock também contam como «já agiu»", async () => {
    const a = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    await pool.query("INSERT INTO public.ai_messages (conversation_id, role, content, tool_name) VALUES ($1, 'tool', '{}', 'create_appointment')", [conversationId]);
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(a)).status).toBe("dead");
    await pool.query("DELETE FROM public.ai_messages WHERE conversation_id = $1", [conversationId]);
    const b = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    await pool.query(
      "INSERT INTO public.agenda_activity (barbershop_id, conversation_id, type, actor, summary) VALUES ($1, $2, 'appointment_created', 'ai', 'x')",
      [fx.barbershopId, conversationId]
    );
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(b)).status).toBe("dead");
  });

  it("mensagem do agente ANTES do lock não conta: o job volta à fila normalmente", async () => {
    await pool.query("INSERT INTO public.ai_messages (conversation_id, role, content, created_at) VALUES ($1, 'assistant', 'resposta do turno anterior', now() - interval '2 hours')", [conversationId]);
    const id = await mkJob({ attempts: 1, lockedAgoSec: 900 });
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(id)).status).toBe("queued");
  });

  it("FALHA NÃO É SILENCIOSA: se o handoff falhar, a transação reverte (job continua processing), loga e conta o erro", async () => {
    const id = await mkJob({ attempts: 5, lockedAgoSec: 900 });
    await pool.query(`CREATE OR REPLACE FUNCTION public.test_reaper_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'handoff quebrado (teste)'; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER test_reaper_fail_trg BEFORE INSERT ON public.ai_handoff_events FOR EACH ROW
       WHEN (NEW.conversation_id = '${conversationId}'::uuid) EXECUTE FUNCTION public.test_reaper_fail()`); // trigger só desta conversa: testes em paralelo não são afetados
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
      expect(res.errors).toBe(1);
      expect(res.dead).toBe(0);
      const j = await get(id);
      expect(j.status).toBe("processing"); // NÃO ficou dead sem aviso ao humano
      expect(err.mock.calls.flat().join(" ")).toMatch(/falha ao tratar job/);
      const emf = out.mock.calls.map((c) => String(c[0])).find((l) => l.includes("ReaperErrors"));
      expect(emf).toBeTruthy();
      expect(JSON.parse(emf!)._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: "ReaperErrors", Unit: "Count" }]);
    } finally {
      err.mockRestore();
      out.mockRestore();
      await pool.query("DROP TRIGGER IF EXISTS test_reaper_fail_trg ON public.ai_handoff_events");
      await pool.query("DROP FUNCTION IF EXISTS public.test_reaper_fail()");
    }
    // sem o defeito, o próximo ciclo conclui
    const res2 = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(res2.dead).toBe(1);
    expect((await get(id)).status).toBe("dead");
  });

  it("INBOUND × REAPER (mesmo limite): processing dentro do prazo não gera job novo; vencido gera 1 e o antigo é superado (nunca 2 queued)", async () => {
    const timeout = config.aiJobProcessingTimeoutSeconds;
    expect(timeout).toBeGreaterThanOrEqual(195);
    const msg = { barbershopId: fx.barbershopId, conversationId, fromPhone: "5511999990002", text: "oi", logPrefix: "test" };
    const alive = await mkJob({ attempts: 1, lockedAgoSec: timeout - 20 }); // ainda pode estar rodando
    await bumpOrEnqueueJob(msg);
    expect((await pool.query("SELECT count(*)::int AS n FROM public.ai_jobs WHERE conversation_id = $1 AND status = 'queued'", [conversationId])).rows[0].n).toBe(0);
    expect((await get(alive)).status).toBe("processing");
    await pool.query("UPDATE public.ai_jobs SET locked_at = now() - make_interval(secs => $2::int) WHERE id = $1", [alive, timeout + 20]); // Lambda já morreu
    await bumpOrEnqueueJob(msg);
    expect((await pool.query("SELECT count(*)::int AS n FROM public.ai_jobs WHERE conversation_id = $1 AND status = 'queued'", [conversationId])).rows[0].n).toBe(1);
    await reapStuckAiJobs(); // limite padrão da config
    expect((await get(alive)).status).toBe("done");
    expect((await pool.query("SELECT count(*)::int AS n FROM public.ai_jobs WHERE conversation_id = $1 AND status = 'queued'", [conversationId])).rows[0].n).toBe(1);
  });

  it("migrations: CHECK de triggered_by aceita job_failure e delivery_failure; o índice cobre a expressão do reaper", async () => {
    const chk = await pool.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ai_handoff_events_triggered_by_check'");
    expect(chk.rows[0].d).toContain("job_failure");
    expect(chk.rows[0].d).toContain("delivery_failure");
    const idx = await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'ai_jobs_processing_since_idx'");
    expect(idx.rows[0].indexdef).toMatch(/COALESCE\(locked_at, updated_at\)/);
  });
});
