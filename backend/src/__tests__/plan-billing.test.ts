import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import {
  AUTO_BILLING_OFF_REASON,
  cancelQueuedPlanBilling,
  enqueueManualCharge,
  ensureAutoBillingQueued,
  recordPlanChargeReceipt,
  runPlanBillingCycleSweep,
} from "../outbound/plan-billing.js";
import { loadDispatchUsage } from "../outbound/dispatch-gate.js";

const TZ = "America/Sao_Paulo";

describe("cobrança de plano (DB)", () => {
  let barbershopId: string | null = null;
  let subscriptionId = "";
  let chargeId = "";
  let todaySp = "";

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      const col = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'client_plan_subscriptions' AND column_name = 'auto_billing'`,
      );
      if (col.rows.length === 0) return;
    } catch {
      return;
    }
    todaySp = (await pool.query<{ d: string }>(`SELECT (now() AT TIME ZONE $1)::date::text AS d`, [TZ])).rows[0]!.d;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, pix_key)
       VALUES ('Test Plan Billing', '5511900000088', 'pro', $1, '45988432998')
       RETURNING id`,
      [`test-plan-billing-${Date.now()}`],
    );
    barbershopId = shop.rows[0]!.id;
    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Cliente Plano', '5545999990088') RETURNING id`,
      [barbershopId],
    );
    const plan = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_plans (barbershop_id, name, price, billing_cycle)
       VALUES ($1, 'Mensal', 89.90, 'monthly') RETURNING id`,
      [barbershopId],
    );
    const sub = await pool.query<{ id: string }>(
      `INSERT INTO public.client_plan_subscriptions (barbershop_id, client_id, plan_id, billing_day, next_billing_date)
       VALUES ($1, $2, $3, 1, $4::date) RETURNING id`,
      [barbershopId, client.rows[0]!.id, plan.rows[0]!.id, todaySp],
    );
    subscriptionId = sub.rows[0]!.id;
  });

  afterAll(async () => {
    if (!barbershopId) return;
    await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [barbershopId]).catch(() => {});
    await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [barbershopId]).catch(() => {});
    await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]).catch(() => {});
  });

  const queuedFor = async () =>
    (
      await pool.query<{ kind: string; status: string }>(
        `SELECT payload_json->>'kind' AS kind, status FROM public.scheduled_messages
         WHERE barbershop_id = $1 AND type = 'plan_billing' ORDER BY created_at, payload_json->>'kind'`,
        [barbershopId],
      )
    ).rows;

  it("generates one charge per due date and moves the cycle, sending nothing while manual", async () => {
    if (!barbershopId) return;
    await runPlanBillingCycleSweep();
    await runPlanBillingCycleSweep();
    const charges = await pool.query<{ id: string; due_date: string; status: string }>(
      `SELECT id, due_date::text AS due_date, status FROM public.plan_pix_charges WHERE subscription_id = $1`,
      [subscriptionId],
    );
    expect(charges.rows).toHaveLength(1);
    expect(charges.rows[0]!.due_date).toBe(todaySp);
    expect(charges.rows[0]!.status).toBe("pending");
    chargeId = charges.rows[0]!.id;
    const sub = await pool.query<{ next: string; expected: string }>(
      `SELECT next_billing_date::text AS next, ($2::date + interval '1 month')::date::text AS expected
       FROM public.client_plan_subscriptions WHERE id = $1`,
      [subscriptionId, todaySp],
    );
    expect(sub.rows[0]!.next).toBe(sub.rows[0]!.expected);
    expect(await queuedFor()).toHaveLength(0);
  });

  it("keeps a single live charge per due date", async () => {
    if (!barbershopId) return;
    await expect(
      pool.query(
        `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status)
         VALUES ($1, $2, 89.90, $3::date, 'sent')`,
        [subscriptionId, barbershopId, todaySp],
      ),
    ).rejects.toThrow(/plan_pix_charges_subscription_due_live_uniq/);
  });

  it("queues due date and day +10 once with the automatic switch on", async () => {
    if (!barbershopId) return;
    await pool.query(`UPDATE public.client_plan_subscriptions SET auto_billing = true WHERE id = $1`, [subscriptionId]);
    expect(await ensureAutoBillingQueued(subscriptionId)).toBe(2);
    expect(await ensureAutoBillingQueued(subscriptionId)).toBe(0);
    await runPlanBillingCycleSweep();
    const rows = await queuedFor();
    expect(rows.map((r) => r.kind).sort()).toEqual(["day10", "due"]);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
  });

  it("does not bring back a send the operator cancelled, but restores the ones the switch dropped", async () => {
    if (!barbershopId) return;
    await pool.query(
      `UPDATE public.scheduled_messages SET status = 'skipped', last_error = 'Cancelado manualmente pelo gestor'
       WHERE barbershop_id = $1 AND type = 'plan_billing' AND payload_json->>'kind' = 'due'`,
      [barbershopId],
    );
    expect(
      await cancelQueuedPlanBilling({
        barbershopId: barbershopId!,
        subscriptionId,
        reason: AUTO_BILLING_OFF_REASON,
        automaticOnly: true,
      }),
    ).toBe(1);
    expect(await ensureAutoBillingQueued(subscriptionId)).toBe(1);
    const queued = (await queuedFor()).filter((r) => r.status === "queued").map((r) => r.kind);
    expect(queued).toEqual(["day10"]);
  });

  it("queues the operator's send once, even on double click", async () => {
    if (!barbershopId) return;
    const first = await enqueueManualCharge(barbershopId, chargeId);
    const second = await enqueueManualCharge(barbershopId, chargeId);
    expect(first.kind).toBe("queued");
    expect(second.kind).toBe("queued");
    const manual = (await queuedFor()).filter((r) => r.kind === "manual" && r.status === "queued");
    expect(manual).toHaveLength(1);
  });

  it("pays the month only on the operator's receipt and cancels what was still queued", async () => {
    if (!barbershopId) return;
    expect((await recordPlanChargeReceipt({ barbershopId, chargeId, method: "cash" })).kind).toBe("paid");
    const charge = await pool.query<{ status: string; paid_method: string }>(
      `SELECT status, paid_method FROM public.plan_pix_charges WHERE id = $1`,
      [chargeId],
    );
    expect(charge.rows[0]).toEqual({ status: "paid", paid_method: "cash" });
    expect((await queuedFor()).filter((r) => r.status === "queued")).toHaveLength(0);
    expect((await recordPlanChargeReceipt({ barbershopId, chargeId, method: "pix" })).kind).toBe("not_open");
    expect((await enqueueManualCharge(barbershopId, chargeId)).kind).toBe("not_open");
  });

  it("counts sent plan charges toward the daily cap", async () => {
    if (!barbershopId) return;
    const before = await loadDispatchUsage(barbershopId, TZ);
    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, updated_at)
       VALUES ($1, 'plan_billing', '5545999990088', '{}'::jsonb, 'sent', now(), now())`,
      [barbershopId],
    );
    const after = await loadDispatchUsage(barbershopId, TZ);
    expect(after.sentToday).toBe(before.sentToday + 1);
  });
});
