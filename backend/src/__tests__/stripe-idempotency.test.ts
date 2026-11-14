import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import Stripe from "stripe";

const SECRET = "whsec_teste_idempotencia";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

describe("Stripe webhook: idempotência por event.id", () => {
  let ok = false;
  let pool: typeof import("../db.js").pool;
  let app: typeof import("../app.js").app;
  const stamp = Date.now();
  const cus = `cus_idem_${stamp}`;
  const email = `idem-${stamp}@example.test`;

  beforeAll(async () => {
    vi_reset();
    ({ pool } = await import("../db.js"));
    ({ app } = await import("../app.js"));
    try {
      await pool.query("SELECT 1");
      await pool.query("SELECT 1 FROM public.stripe_events LIMIT 1");
      ok = true;
    } catch {
      ok = false;
    }
  });
  afterAll(async () => {
    if (!ok) return;
    await pool.query("DELETE FROM public.stripe_events WHERE event_id LIKE $1", [`evt_idem_${stamp}%`]);
    const shops = await pool.query<{ id: string; account_id: string | null }>("SELECT id, account_id FROM public.barbershops WHERE stripe_customer_id = $1", [cus]);
    for (const s of shops.rows) {
      await pool.query("DELETE FROM public.checkout_onboarding WHERE email = $1", [email]);
      await pool.query("DELETE FROM public.account_memberships WHERE account_id = $1", [s.account_id]).catch(() => {});
      await pool.query("DELETE FROM public.profiles WHERE barbershop_id = $1", [s.id]);
      await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = $1", [s.id]);
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [s.id]);
      if (s.account_id) await pool.query("DELETE FROM public.accounts WHERE id = $1", [s.account_id]);
    }
  });

  const send = (evt: object) => {
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app).post("/api/billing/webhook").set("content-type", "application/json").set("stripe-signature", header).send(payload);
  };

  it("reentrega do mesmo event.id não reprocessa (senha temporária guardada permanece a original)", async () => {
    if (!ok) return;
    const evt = {
      id: `evt_idem_${stamp}`, object: "event", type: "checkout.session.completed",
      data: { object: { id: `cs_idem_${stamp}`, object: "checkout.session", mode: "subscription", customer: cus, customer_email: email, subscription: `sub_idem_${stamp}`, status: "complete", payment_status: "paid", metadata: { barbershop_name: `Idem ${stamp}`, plan: "pro" } } },
    };
    expect((await send(evt)).status).toBe(200);
    const first = await pool.query<{ temporary_password: string }>("SELECT temporary_password FROM public.checkout_onboarding WHERE email = $1", [email]);
    expect((await send(evt)).status).toBe(200);
    const again = await pool.query<{ temporary_password: string }>("SELECT temporary_password FROM public.checkout_onboarding WHERE email = $1", [email]);
    expect(again.rows[0]?.temporary_password).toBe(first.rows[0]?.temporary_password);
    const ev = await pool.query("SELECT processed_at FROM public.stripe_events WHERE event_id = $1", [evt.id]);
    expect(ev.rows[0]?.processed_at).toBeTruthy();
  });

  it("outro event.id para a mesma sessão (retry do Stripe com id novo) também não troca a senha guardada", async () => {
    if (!ok) return;
    const evt = {
      id: `evt_idem_${stamp}_b`, object: "event", type: "checkout.session.completed",
      data: { object: { id: `cs_idem_${stamp}`, object: "checkout.session", mode: "subscription", customer: cus, customer_email: email, subscription: `sub_idem_${stamp}`, status: "complete", payment_status: "paid", metadata: { barbershop_name: `Idem ${stamp}`, plan: "pro" } } },
    };
    const before = await pool.query<{ temporary_password: string }>("SELECT temporary_password FROM public.checkout_onboarding WHERE email = $1", [email]);
    expect((await send(evt)).status).toBe(200);
    const after = await pool.query<{ temporary_password: string }>("SELECT temporary_password FROM public.checkout_onboarding WHERE email = $1", [email]);
    expect(after.rows[0]?.temporary_password).toBe(before.rows[0]?.temporary_password);
  });
});

function vi_reset() {
  /* config.ts lê STRIPE_WEBHOOK_SECRET na importação; definido no topo do arquivo antes dos imports dinâmicos */
}
