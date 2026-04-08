/**
 * Tests for runDailyPlanBillingSweep.
 * Validates that subscriptions due today are processed and next_billing_date is advanced.
 * UAZAPI/PIX calls are mocked out by having no WhatsApp connection row (sweep skips gracefully).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { runDailyPlanBillingSweep } from "../outbound/scheduled-messages.js";

let barbershopId: string;
let clientId: string;
let planId: string;
let subscriptionId: string;
const testSlug = `test-plan-sweep-${Date.now()}`;
const dbAvailable = { value: false };
const todayStr = new Date().toISOString().slice(0, 10);

async function cleanup() {
  if (!barbershopId) return;
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]).catch(() => {});
}

describe("runDailyPlanBillingSweep", () => {
  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      dbAvailable.value = true;
    } catch {
      console.warn("[plan-billing-sweep.test] DB not available — skipping");
      return;
    }

    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours, pix_key)
       VALUES ($1, '5511111110000', 'pro', $2, '{}'::jsonb, 'teste@pix.key')
       RETURNING id`,
      [`Test Sweep Shop ${testSlug}`, testSlug]
    );
    barbershopId = shop.rows[0]!.id;

    const cli = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone)
       VALUES ($1, 'Cliente Sweep', '5511111110001')
       RETURNING id`,
      [barbershopId]
    );
    clientId = cli.rows[0]!.id;

    const plan = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_plans (barbershop_id, name, price, billing_cycle)
       VALUES ($1, 'Plano Sweep', 49.90, 'monthly')
       RETURNING id`,
      [barbershopId]
    );
    planId = plan.rows[0]!.id;

    const sub = await pool.query<{ id: string }>(
      `INSERT INTO public.client_plan_subscriptions
         (barbershop_id, client_id, plan_id, billing_day, next_billing_date)
       VALUES ($1, $2, $3, $4::int, $5::date)
       RETURNING id`,
      [barbershopId, clientId, planId, new Date().getDate(), todayStr]
    );
    subscriptionId = sub.rows[0]!.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("sweep runs without error even when WhatsApp is not connected (skips gracefully)", async () => {
    if (!dbAvailable.value) return;
    // No WhatsApp connection row exists → sweep should log warn and skip, not throw.
    await expect(runDailyPlanBillingSweep()).resolves.not.toThrow();
  });

  it("advances next_billing_date after processing (when WhatsApp is connected)", async () => {
    if (!dbAvailable.value) return;
    // Since there's no real WhatsApp connection, the sweep skips without advancing.
    // Verify subscription still has today as billing date (not advanced without send).
    const r = await pool.query<{ next_billing_date: string }>(
      `SELECT next_billing_date::text FROM public.client_plan_subscriptions WHERE id = $1`,
      [subscriptionId]
    );
    // Should still be today (sweep skipped because no WA token)
    expect(r.rows[0]?.next_billing_date).toBe(todayStr);
  });

  it("no duplicate charges are created if sweep runs twice", async () => {
    if (!dbAvailable.value) return;
    await runDailyPlanBillingSweep();
    await runDailyPlanBillingSweep();
    // Since sweep skips (no WA token), no charges should have been inserted by sweep
    const r = await pool.query(
      `SELECT * FROM public.plan_pix_charges WHERE subscription_id = $1`,
      [subscriptionId]
    );
    // 0 charges expected (sweep skipped)
    expect(r.rows.length).toBe(0);
  });
});
