import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import Stripe from "stripe";

const SECRET = "whsec_teste_assinatura";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

describe("Stripe: invoice.payment_failed e subscription.updated/deleted", () => {
  let ok = false;
  let pool: typeof import("../db.js").pool;
  let app: typeof import("../app.js").app;
  const stamp = Date.now();
  const cus = `cus_sub_${stamp}`;
  const sub = `sub_sub_${stamp}`;
  let shopId = "";
  let n = 0;

  beforeAll(async () => {
    ({ pool } = await import("../db.js"));
    ({ app } = await import("../app.js"));
    try {
      await pool.query("SELECT subscription_event_at FROM public.barbershops LIMIT 1");
      await pool.query("SELECT 1 FROM public.stripe_events LIMIT 1");
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours, stripe_customer_id, stripe_subscription_id, subscription_status)
         VALUES ('Teste assinatura', '5511999990000', 'pro', $1, '{}'::jsonb, $2, $3, 'active') RETURNING id`,
        [`test-sub-${stamp}`, cus, sub],
      );
      shopId = r.rows[0]!.id;
      ok = true;
    } catch {
      ok = false;
    }
  });
  afterAll(async () => {
    if (!ok) return;
    await pool.query("DELETE FROM public.stripe_events WHERE event_id LIKE $1", [`evt_sub_${stamp}%`]);
    await pool.query("DELETE FROM public.barbershops WHERE id = $1", [shopId]);
  });

  const send = (type: string, object: object, created = Math.floor(Date.now() / 1000)) => {
    const evt = { id: `evt_sub_${stamp}_${++n}`, object: "event", type, created, data: { object } };
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app).post("/api/billing/webhook").set("content-type", "application/json").set("stripe-signature", header).send(payload);
  };
  const row = async () =>
    (await pool.query<{ subscription_status: string; subscription_status_changed_at: Date | null }>(
      "SELECT subscription_status, subscription_status_changed_at FROM public.barbershops WHERE id = $1",
      [shopId],
    )).rows[0]!;

  it("invoice.payment_failed → past_due com início da tolerância", async () => {
    if (!ok) return;
    expect((await send("invoice.payment_failed", { id: "in_1", object: "invoice", customer: cus })).status).toBe(200);
    const r = await row();
    expect(r.subscription_status).toBe("past_due");
    expect(r.subscription_status_changed_at).toBeTruthy();
  });

  it("invoice.paid → volta a active", async () => {
    if (!ok) return;
    expect((await send("invoice.paid", { id: "in_2", object: "invoice", customer: cus })).status).toBe(200);
    expect((await row()).subscription_status).toBe("active");
  });

  it("subscription.deleted → canceled com fim de período; evento atrasado não sobrescreve", async () => {
    if (!ok) return;
    const t = Math.floor(Date.now() / 1000) + 100;
    const end = t + 86_400;
    expect((await send("customer.subscription.deleted", { id: sub, object: "subscription", status: "canceled", current_period_end: end, items: { data: [] } }, t)).status).toBe(200);
    expect((await row()).subscription_status).toBe("canceled");
    // evento antigo ("active") chegando depois não pode ressuscitar a assinatura
    expect((await send("customer.subscription.updated", { id: sub, object: "subscription", status: "active", items: { data: [] } }, t - 500)).status).toBe(200);
    expect((await row()).subscription_status).toBe("canceled");
  });

  it("subscription de barbearia inexistente → 500 (Stripe reenvia, não perde o evento)", async () => {
    if (!ok) return;
    expect((await send("customer.subscription.updated", { id: `sub_inexistente_${stamp}`, object: "subscription", status: "canceled", items: { data: [] } })).status).toBe(500);
  });
});
