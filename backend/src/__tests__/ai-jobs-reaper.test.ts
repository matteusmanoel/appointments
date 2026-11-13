import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { pool } from "../db.js";
import { createPublicRoutesFixtures, deletePublicRoutesFixtures, type PublicRoutesFixture } from "./helpers/public-routes.js";
import { reapStuckAiJobs, maybeReapStuckAiJobs, resetReaperThrottleForTests } from "../workers/ai-jobs-reaper.js";

describe("reaper de ai_jobs presos em processing", () => {
  let fx: PublicRoutesFixture | null = null;
  let conversationId = "";

  const mkJob = async (o: { status?: string; attempts?: number; lockedAgoSec?: number | null; runAfterOffsetSec?: number }) => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_jobs (barbershop_id, conversation_id, payload_json, status, attempts, locked_at, locked_by, run_after)
       VALUES ($1, $2, '{"fromPhone":"5511999990002","text":"oi"}'::jsonb, $3, $4,
               CASE WHEN $5::int IS NULL THEN NULL ELSE now() - make_interval(secs => $5::int) END,
               'worker-morto', now() + make_interval(secs => $6::int))
       RETURNING id`,
      [fx!.barbershopId, conversationId, o.status ?? "processing", o.attempts ?? 1, o.lockedAgoSec ?? null, o.runAfterOffsetSec ?? 0]
    );
    return r.rows[0].id;
  };
  const get = async (id: string) =>
    (await pool.query("SELECT status, attempts, locked_at, locked_by, last_error, run_after > now() AS in_future FROM public.ai_jobs WHERE id = $1", [id])).rows[0];

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    fx = await createPublicRoutesFixtures({});
    conversationId = (
      await pool.query<{ id: string }>(
        "INSERT INTO public.ai_conversations (barbershop_id, external_thread_id) VALUES ($1, $2) RETURNING id",
        [fx.barbershopId, `reaper-${Date.now()}`]
      )
    ).rows[0].id;
  });
  beforeEach(async () => {
    if (fx) await pool.query("DELETE FROM public.ai_jobs WHERE barbershop_id = $1", [fx.barbershopId]);
    resetReaperThrottleForTests();
  });
  afterAll(async () => {
    if (!fx) return;
    await pool.query("DELETE FROM public.ai_jobs WHERE barbershop_id = $1", [fx.barbershopId]);
    await pool.query("DELETE FROM public.agenda_activity WHERE barbershop_id = $1", [fx.barbershopId]).catch(() => undefined);
    await pool.query("DELETE FROM public.ai_conversations WHERE barbershop_id = $1", [fx.barbershopId]);
    await deletePublicRoutesFixtures([fx.barbershopId]);
  });

  it("job em processing além do timeout volta para queued, sem lock e com backoff (run_after no futuro)", async () => {
    if (!fx) return;
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
    if (!fx) return;
    const fresh = await mkJob({ attempts: 1, lockedAgoSec: 30 });
    const queued = await mkJob({ status: "queued", attempts: 0 });
    const done = await mkJob({ status: "done", attempts: 1, lockedAgoSec: 5000 });
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(fresh)).status).toBe("processing");
    expect((await get(queued)).status).toBe("queued");
    expect((await get(done)).status).toBe("done");
  });

  it("tentativas esgotadas → dead-letter, conversa marcada para humano e atividade registrada", async () => {
    if (!fx) return;
    const exhausted = await mkJob({ attempts: 5, lockedAgoSec: 900 });
    const res = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(res.dead).toBeGreaterThanOrEqual(1);
    const j = await get(exhausted);
    expect(j.status).toBe("dead");
    expect(j.locked_by).toBeNull();
    expect(j.last_error).toMatch(/reaper/);
    const conv = await pool.query("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [conversationId]).catch(() => null);
    if (conv) expect(conv.rows[0].needs_human_followup).toBe(true);
    const act = await pool.query("SELECT 1 FROM public.agenda_activity WHERE barbershop_id = $1 AND type = 'agent_stuck'", [fx.barbershopId]).catch(() => null);
    if (act) expect(act.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("lock nulo em processing usa updated_at como referência", async () => {
    if (!fx) return;
    const id = await mkJob({ attempts: 1, lockedAgoSec: null });
    await pool.query("UPDATE public.ai_jobs SET updated_at = now() - interval '1 hour' WHERE id = $1", [id]);
    await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect((await get(id)).status).toBe("queued");
  });

  it("duas varreduras simultâneas não duplicam nem quebram (idempotente)", async () => {
    if (!fx) return;
    const id = await mkJob({ attempts: 2, lockedAgoSec: 900 });
    const [a, b] = await Promise.all([reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 }), reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 })]);
    expect(a.requeued + b.requeued).toBeGreaterThanOrEqual(1);
    expect((await get(id)).status).toBe("queued");
    const again = await reapStuckAiJobs({ timeoutSeconds: 600, maxAttempts: 5 });
    expect(again.requeued).toBe(0);
  });

  it("job devolvido é pego de novo pelo claim do worker (status queued + run_after vencido)", async () => {
    if (!fx) return;
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
    if (!fx) return;
    await mkJob({ attempts: 1, lockedAgoSec: 7200 });
    const first = await maybeReapStuckAiJobs(1_000_000);
    expect(first).not.toBeNull();
    expect(await maybeReapStuckAiJobs(1_000_000 + 1000)).toBeNull();
    expect(await maybeReapStuckAiJobs(1_000_000 + 61_000)).not.toBeNull();
  });
});
