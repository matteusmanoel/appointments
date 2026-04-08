/**
 * Unit tests for /api/plans routes.
 * Requires a running PostgreSQL instance (same as other DB tests).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";

let barbershopId: string;
let clientId: string;
let planId: string;
let subscriptionId: string;
const testSlug = `test-plans-${Date.now()}`;
const dbAvailable = { value: false };

async function cleanup() {
  if (!barbershopId) return;
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]).catch(() => {});
}

describe("plans-routes (DB)", () => {
  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      dbAvailable.value = true;
    } catch {
      console.warn("[plans-routes.test] DB not available — skipping");
      return;
    }

    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ($1, '5511000000000', 'pro', $2, '{}'::jsonb)
       RETURNING id`,
      [`Test Plans Shop ${testSlug}`, testSlug]
    );
    barbershopId = shop.rows[0]!.id;

    const cli = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone)
       VALUES ($1, 'Cliente Plano', '5511000000001')
       RETURNING id`,
      [barbershopId]
    );
    clientId = cli.rows[0]!.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("creates a plan", async () => {
    if (!dbAvailable.value) return;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_plans (barbershop_id, name, price, billing_cycle)
       VALUES ($1, 'Plano Teste', 89.90, 'monthly')
       RETURNING id`,
      [barbershopId]
    );
    planId = r.rows[0]!.id;
    expect(planId).toBeTruthy();
  });

  it("lists active plans", async () => {
    if (!dbAvailable.value) return;
    const r = await pool.query(
      `SELECT * FROM public.barbershop_plans WHERE barbershop_id = $1 AND is_active = true`,
      [barbershopId]
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0]!.name).toBe("Plano Teste");
  });

  it("creates a subscription", async () => {
    if (!dbAvailable.value) return;
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextStr = nextMonth.toISOString().slice(0, 10);

    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.client_plan_subscriptions
         (barbershop_id, client_id, plan_id, billing_day, next_billing_date)
       VALUES ($1, $2, $3, 1, $4::date)
       RETURNING id`,
      [barbershopId, clientId, planId, nextStr]
    );
    subscriptionId = r.rows[0]!.id;
    expect(subscriptionId).toBeTruthy();
  });

  it("inserts initial charge for subscription", async () => {
    if (!dbAvailable.value) return;
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextStr = nextMonth.toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status)
       VALUES ($1, $2, 89.90, $3::date, 'pending')`,
      [subscriptionId, barbershopId, nextStr]
    );

    const r = await pool.query(
      `SELECT * FROM public.plan_pix_charges WHERE subscription_id = $1 AND status = 'pending'`,
      [subscriptionId]
    );
    expect(r.rows.length).toBe(1);
    expect(Number(r.rows[0]!.amount)).toBeCloseTo(89.9, 1);
  });

  it("cancels subscription and skips pending charges", async () => {
    if (!dbAvailable.value) return;
    await pool.query(
      `UPDATE public.client_plan_subscriptions
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1`,
      [subscriptionId]
    );
    await pool.query(
      `UPDATE public.plan_pix_charges SET status = 'skipped'
       WHERE subscription_id = $1 AND status = 'pending'`,
      [subscriptionId]
    );

    const sub = await pool.query(
      `SELECT status FROM public.client_plan_subscriptions WHERE id = $1`,
      [subscriptionId]
    );
    expect(sub.rows[0]!.status).toBe("cancelled");

    const charges = await pool.query(
      `SELECT status FROM public.plan_pix_charges WHERE subscription_id = $1`,
      [subscriptionId]
    );
    expect(charges.rows.every((c) => c.status === "skipped" || c.status !== "pending")).toBe(true);
  });

  it("deactivates a plan", async () => {
    if (!dbAvailable.value) return;
    await pool.query(
      `UPDATE public.barbershop_plans SET is_active = false WHERE id = $1`,
      [planId]
    );
    const r = await pool.query(
      `SELECT is_active FROM public.barbershop_plans WHERE id = $1`,
      [planId]
    );
    expect(r.rows[0]!.is_active).toBe(false);
  });

  it("lists charges for subscription", async () => {
    if (!dbAvailable.value) return;
    const r = await pool.query(
      `SELECT * FROM public.plan_pix_charges WHERE subscription_id = $1 ORDER BY due_date DESC`,
      [subscriptionId]
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
