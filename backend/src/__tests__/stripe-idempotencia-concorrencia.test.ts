import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SECRET = "whsec_teste_concorrencia";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

// FROM_EMAIL ligado e SES simulado: permite contar quantos e-mails de boas-vindas saíram (nunca vai ao SES de verdade).
vi.mock("../config.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../config.js")>();
  return { ...m, config: { ...m.config, fromEmail: "no-reply@teste.local" } };
});
const sendOnboardingEmail = vi.fn(async () => undefined);
vi.mock("../lib/ses.js", async (importOriginal) => {
  const m = await importOriginal<typeof import("../lib/ses.js")>();
  return { ...m, sendOnboardingEmail: (...a: unknown[]) => (sendOnboardingEmail as (...x: unknown[]) => unknown)(...a) };
});

type Billing = typeof import("../routes/billing.js");

describe("Stripe: idempotência atômica do evento e provisionamento único por cliente", () => {
  let ok = false;
  let pool: typeof import("../db.js").pool;
  let app: typeof import("../app.js").app;
  let billing: Billing;
  const stamp = Date.now();
  const customers: string[] = [];

  const newCustomer = (tag: string) => {
    const c = `cus_conc_${stamp}_${tag}`;
    customers.push(c);
    return c;
  };
  const emailOf = (cus: string) => `${cus}@example.test`;
  const session = (cus: string, sessionId = `cs_${cus}`, name = `Conc ${cus}`, extra: Record<string, unknown> = {}, email = emailOf(cus)) =>
    ({
      id: sessionId,
      object: "checkout.session",
      mode: "subscription",
      customer: cus,
      customer_email: email,
      subscription: `sub_${cus}`,
      status: "complete",
      payment_status: "paid",
      metadata: { barbershop_name: name, phone: "11999990000", plan: "pro" },
      ...extra,
    }) as unknown as Stripe.Checkout.Session;
  const checkoutEvent = (id: string, cus: string, sessionId?: string, type = "checkout.session.completed", extra: Record<string, unknown> = {}, email?: string) => ({
    id,
    object: "event",
    type,
    data: { object: session(cus, sessionId, undefined, extra, email) },
  });
  const sendWebhook = (evt: object) => {
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app).post("/api/billing/webhook").set("content-type", "application/json").set("stripe-signature", header).send(payload);
  };
  const extraShops: string[] = [];
  const profilesWithEmail = async (email: string) =>
    Number((await pool.query<{ n: string }>("SELECT count(*) n FROM public.profiles WHERE LOWER(TRIM(email)) = $1", [email])).rows[0].n);
  const counts = async (cus: string) => {
    const shops = await pool.query<{ id: string; account_id: string | null; slug: string }>(
      "SELECT id, account_id, slug FROM public.barbershops WHERE stripe_customer_id = $1",
      [cus],
    );
    const ids = shops.rows.map((r) => r.id);
    const accIds = shops.rows.map((r) => r.account_id).filter(Boolean);
    const one = async (sql: string, p: unknown[]) => Number((await pool.query<{ n: string }>(sql, p)).rows[0].n);
    return {
      shops: shops.rows.length,
      slugs: shops.rows.map((r) => r.slug),
      accounts: accIds.length ? await one("SELECT count(*) n FROM public.accounts WHERE id = ANY($1::uuid[])", [accIds]) : 0,
      admins: await one("SELECT count(*) n FROM public.profiles WHERE barbershop_id = ANY($1::uuid[]) AND role = 'admin'", [ids]),
      memberships: accIds.length ? await one("SELECT count(*) n FROM public.account_memberships WHERE account_id = ANY($1::uuid[])", [accIds]) : 0,
      keys: await one("SELECT count(*) n FROM public.barbershop_api_keys WHERE barbershop_id = ANY($1::uuid[])", [ids]),
    };
  };

  beforeAll(async () => {
    ({ pool } = await import("../db.js"));
    ({ app } = await import("../app.js"));
    billing = await import("../routes/billing.js");
    try {
      await pool.query("SELECT 1 FROM public.stripe_events LIMIT 1");
      await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'ux_barbershops_stripe_customer_id'");
      ok = true;
    } catch {
      ok = false;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sendOnboardingEmail.mockClear();
  });

  afterAll(async () => {
    if (!ok) return;
    await pool.query("DELETE FROM public.stripe_events WHERE event_id LIKE $1", [`evt_conc_${stamp}%`]);
    await pool.query("DELETE FROM public.billing_manual_reviews WHERE stripe_customer_id LIKE $1", [`cus_conc_${stamp}%`]);
    for (const id of extraShops) {
      const acc = await pool.query<{ account_id: string | null }>("SELECT account_id FROM public.barbershops WHERE id = $1", [id]);
      await pool.query("DELETE FROM public.profiles WHERE barbershop_id = $1", [id]);
      await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = $1", [id]);
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [id]);
      if (acc.rows[0]?.account_id) await pool.query("DELETE FROM public.accounts WHERE id = $1", [acc.rows[0].account_id]);
    }
    for (const cus of customers) {
      const shops = await pool.query<{ id: string; account_id: string | null }>(
        "SELECT id, account_id FROM public.barbershops WHERE stripe_customer_id = $1",
        [cus],
      );
      await pool.query("DELETE FROM public.checkout_onboarding WHERE email = $1", [emailOf(cus)]);
      for (const s of shops.rows) {
        await pool.query("DELETE FROM public.account_memberships WHERE account_id = $1", [s.account_id]).catch(() => {});
        await pool.query("DELETE FROM public.profiles WHERE barbershop_id = $1", [s.id]);
        await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = $1", [s.id]);
        await pool.query("DELETE FROM public.barbershops WHERE id = $1", [s.id]);
        if (s.account_id) await pool.query("DELETE FROM public.accounts WHERE id = $1", [s.account_id]);
      }
    }
  });

  // ---------- (b) provisionamento único por cliente ----------

  it("6 provisionamentos simultâneos do MESMO cliente criam 1 tenant só e 1 e-mail de boas-vindas", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("mesmo");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => billing.provisionFromCheckoutSession(session(cus))));
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const c = await counts(cus);
    expect(c).toMatchObject({ shops: 1, accounts: 1, admins: 1, memberships: 1, keys: 1 });
    expect(sendOnboardingEmail).toHaveBeenCalledTimes(1);
    const ob = await pool.query("SELECT 1 FROM public.checkout_onboarding WHERE email = $1", [emailOf(cus)]);
    expect(ob.rowCount).toBe(1);
  });

  it("webhook (3 event.ids diferentes, retry do Stripe) + fallback de /billing/session ao mesmo tempo: 1 tenant", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("corrida");
    const ev = (n: number) => checkoutEvent(`evt_conc_${stamp}_corrida_${n}`, cus) as unknown as Stripe.Event;
    await Promise.all([
      billing.processStripeEventOnce(ev(1)),
      billing.processStripeEventOnce(ev(2)),
      billing.processStripeEventOnce(ev(3)),
      billing.provisionFromCheckoutSession(session(cus)),
      billing.provisionFromCheckoutSession(session(cus)),
    ]);
    expect(await counts(cus)).toMatchObject({ shops: 1, accounts: 1, admins: 1, memberships: 1, keys: 1 });
    expect(sendOnboardingEmail).toHaveBeenCalledTimes(1);
  });

  it("5 clientes DIFERENTES com o mesmo nome de barbearia, ao mesmo tempo: 5 tenants, slugs distintos, nenhum erro", async (ctx) => {
    if (!ok) return ctx.skip();
    const cs = Array.from({ length: 5 }, (_, i) => newCustomer(`dif${i}`));
    const results = await Promise.allSettled(
      cs.map((c) => billing.provisionFromCheckoutSession(session(c, `cs_${c}`, `Barbearia Igual ${stamp}`))),
    );
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const all = await Promise.all(cs.map(counts));
    expect(all.every((c) => c.shops === 1 && c.accounts === 1 && c.admins === 1)).toBe(true);
    expect(new Set(all.map((c) => c.slugs[0])).size).toBe(5);
  });

  it("índice único: o banco recusa 2 barbearias com o mesmo stripe_customer_id (e permite várias sem cliente)", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = `cus_conc_${stamp}_idx`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = (slug: string, c: string | null) =>
        client.query("INSERT INTO public.barbershops (name, slug, stripe_customer_id) VALUES ($1, $2, $3)", ["Idx", slug, c]);
      await ins(`idx-a-${stamp}`, cus);
      await client.query("SAVEPOINT s1");
      await expect(ins(`idx-b-${stamp}`, cus)).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK TO SAVEPOINT s1");
      await ins(`idx-c-${stamp}`, null);
      await ins(`idx-d-${stamp}`, null);
      await ins(`idx-e-${stamp}`, "");
      await ins(`idx-f-${stamp}`, "");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("migration: com duplicados existentes falha com mensagem clara e não apaga nem altera nada", async (ctx) => {
    if (!ok) return ctx.skip();
    const sql = readFileSync(join(__dirname, "../../../supabase/migrations/20261114000000_barbershops_stripe_customer_unique.sql"), "utf-8");
    const cus = `cus_conc_${stamp}_dup`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP INDEX IF EXISTS public.ux_barbershops_stripe_customer_id");
      for (const n of ["a", "b"]) {
        await client.query("INSERT INTO public.barbershops (name, slug, stripe_customer_id) VALUES ('Dup', $1, $2)", [`dup-${n}-${stamp}`, cus]);
      }
      await client.query("SAVEPOINT m");
      await expect(client.query(sql)).rejects.toThrow(/barbearias duplicadas.*Nenhum dado foi apagado/s);
      await client.query("ROLLBACK TO SAVEPOINT m");
      const still = await client.query("SELECT count(*)::int n FROM public.barbershops WHERE stripe_customer_id = $1", [cus]);
      expect(still.rows[0].n).toBe(2);
    } finally {
      await client.query("ROLLBACK"); // o DROP INDEX também volta
      client.release();
    }
    const idx = await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'ux_barbershops_stripe_customer_id'");
    expect(idx.rowCount).toBe(1);
  });

  it("migration: sem duplicados é idempotente (roda de novo sem erro)", async (ctx) => {
    if (!ok) return ctx.skip();
    const sql = readFileSync(join(__dirname, "../../../supabase/migrations/20261114000000_barbershops_stripe_customer_unique.sql"), "utf-8");
    await expect(pool.query(sql)).resolves.toBeDefined();
  });

  // ---------- (a) idempotência atômica do evento ----------

  it("8 entregas simultâneas do mesmo event.id: o handler roda 1 vez; processed_at só no sucesso", async (ctx) => {
    if (!ok) return ctx.skip();
    const id = `evt_conc_${stamp}_atomico`;
    let calls = 0;
    const handler = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 150));
    };
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => billing.processStripeEventOnce({ id, type: "x.test" }, handler)),
    );
    expect(calls).toBe(1);
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(outcomes.filter((o) => o !== "processed").every((o) => o === "in_progress" || o === "duplicate")).toBe(true);
    const row = await pool.query("SELECT processed_at FROM public.stripe_events WHERE event_id = $1", [id]);
    expect(row.rows[0].processed_at).toBeTruthy();
    // reentrega depois de concluído: duplicate, sem rodar o handler
    expect(await billing.processStripeEventOnce({ id, type: "x.test" }, handler)).toBe("duplicate");
    expect(calls).toBe(1);
  });

  it("falha do handler libera o evento: o reenvio processa de novo (nada de processed_at falso)", async (ctx) => {
    if (!ok) return ctx.skip();
    const id = `evt_conc_${stamp}_falha`;
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error("falha simulada");
    };
    await expect(billing.processStripeEventOnce({ id, type: "x.test" }, flaky)).rejects.toThrow("falha simulada");
    const after = await pool.query("SELECT 1 FROM public.stripe_events WHERE event_id = $1", [id]);
    expect(after.rowCount).toBe(0);
    expect(await billing.processStripeEventOnce({ id, type: "x.test" }, flaky)).toBe("processed");
    expect(calls).toBe(2);
    const row = await pool.query("SELECT processed_at FROM public.stripe_events WHERE event_id = $1", [id]);
    expect(row.rows[0].processed_at).toBeTruthy();
  });

  it("lease: entrega em andamento responde in_progress; reivindicação vencida (processo morreu) é retomada", async (ctx) => {
    if (!ok) return ctx.skip();
    const fresh = `evt_conc_${stamp}_lease_novo`;
    const stale = `evt_conc_${stamp}_lease_velho`;
    await pool.query("INSERT INTO public.stripe_events (event_id, type) VALUES ($1, 'x.test')", [fresh]);
    await pool.query("INSERT INTO public.stripe_events (event_id, type, received_at) VALUES ($1, 'x.test', now() - interval '10 minutes')", [stale]);
    const handler = vi.fn(async () => undefined);
    expect(await billing.processStripeEventOnce({ id: fresh, type: "x.test" }, handler)).toBe("in_progress");
    expect(handler).not.toHaveBeenCalled();
    expect(await billing.processStripeEventOnce({ id: stale, type: "x.test" }, handler)).toBe("processed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("erro ao gravar processed_at NÃO é engolido (sobe para o webhook responder 500)", async (ctx) => {
    if (!ok) return ctx.skip();
    const id = `evt_conc_${stamp}_marca`;
    const orig = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) =>
      typeof args[0] === "string" && args[0].startsWith("UPDATE public.stripe_events")
        ? Promise.reject(new Error("banco indisponível"))
        : orig(...args)) as never);
    await expect(billing.processStripeEventOnce({ id, type: "x.test" }, async () => undefined)).rejects.toThrow("banco indisponível");
  });

  // ---------- reassinatura com o mesmo e-mail (B3) ----------

  it("reassinatura com o MESMO e-mail (assinatura anterior cancelada): reaproveita tenant e perfil, não cria perfil, vincula o novo cliente e reativa", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus1 = newCustomer("resub1");
    const cus2 = newCustomer("resub2");
    const email = emailOf(cus1);
    await billing.provisionFromCheckoutSession(session(cus1));
    sendOnboardingEmail.mockClear();
    const before = await pool.query<{ id: string; account_id: string }>("SELECT id, account_id FROM public.barbershops WHERE stripe_customer_id = $1", [cus1]);
    await pool.query("UPDATE public.barbershops SET subscription_status = 'canceled', billing_plan = 'essential' WHERE id = $1", [before.rows[0].id]);

    const out = await billing.provisionFromCheckoutSession(session(cus2, `cs_${cus2}`, undefined, { metadata: { barbershop_name: "Outro Nome", phone: "11999990000", plan: "premium" } }, email));
    expect(out).toMatchObject({ kind: "reactivated", barbershopId: before.rows[0].id });
    const shop = await pool.query("SELECT id, account_id, stripe_customer_id, stripe_subscription_id, subscription_status, billing_plan FROM public.barbershops WHERE id = $1", [before.rows[0].id]);
    expect(shop.rows[0]).toMatchObject({ account_id: before.rows[0].account_id, stripe_customer_id: cus2, stripe_subscription_id: `sub_${cus2}`, subscription_status: "active", billing_plan: "premium" });
    expect(await profilesWithEmail(email)).toBe(1);
    expect(await pool.query("SELECT 1 FROM public.barbershops WHERE stripe_customer_id = ANY($1)", [[cus1, cus2]]).then((r) => r.rowCount)).toBe(1);
    // nenhuma senha/e-mail novos e nada que autorize JWT passwordless para a 2ª compra
    expect(sendOnboardingEmail).not.toHaveBeenCalled();
    expect((await pool.query("SELECT 1 FROM public.checkout_onboarding WHERE stripe_session_id = $1", [`cs_${cus2}`])).rowCount).toBe(0);
  });

  it("HTTP: reassinatura + reentrega do mesmo evento respondem 200 (antes: 23505 → 500 em toda reentrega) e não duplicam nada", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus1 = newCustomer("rehttp1");
    const cus2 = newCustomer("rehttp2");
    const email = emailOf(cus1);
    expect((await sendWebhook(checkoutEvent(`evt_conc_${stamp}_rehttp1`, cus1))).status).toBe(200);
    await pool.query("UPDATE public.barbershops SET subscription_status = 'canceled' WHERE stripe_customer_id = $1", [cus1]);
    const evt2 = checkoutEvent(`evt_conc_${stamp}_rehttp2`, cus2, undefined, "checkout.session.completed", {}, email);
    expect((await sendWebhook(evt2)).status).toBe(200);
    expect((await sendWebhook(evt2)).status).toBe(200); // reentrega depois do sucesso
    // novo event.id para a mesma sessão (retry do Stripe com id novo): continua 200
    expect((await sendWebhook({ ...evt2, id: `evt_conc_${stamp}_rehttp2b` })).status).toBe(200);
    expect(await profilesWithEmail(email)).toBe(1);
    const shops = await pool.query("SELECT stripe_customer_id, subscription_status FROM public.barbershops WHERE stripe_customer_id = ANY($1)", [[cus1, cus2]]);
    expect(shops.rows).toEqual([{ stripe_customer_id: cus2, subscription_status: "active" }]);
  });

  it("e-mail de tenant com assinatura VIVA de outro cliente: não vincula, registra revisão manual, 200 (nunca dá a conta alheia ao pagador)", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus1 = newCustomer("vivo1");
    const cus2 = newCustomer("vivo2");
    const email = emailOf(cus1);
    await billing.provisionFromCheckoutSession(session(cus1));
    const evt = checkoutEvent(`evt_conc_${stamp}_vivo2`, cus2, undefined, "checkout.session.completed", {}, email);
    expect((await sendWebhook(evt)).status).toBe(200);
    const shop = await pool.query("SELECT stripe_customer_id, subscription_status FROM public.barbershops WHERE stripe_customer_id = ANY($1)", [[cus1, cus2]]);
    expect(shop.rows).toEqual([{ stripe_customer_id: cus1, subscription_status: "active" }]);
    expect(await profilesWithEmail(email)).toBe(1);
    const rev = await pool.query("SELECT reason, stripe_customer_id FROM public.billing_manual_reviews WHERE stripe_session_id = $1", [`cs_${cus2}`]);
    expect(rev.rows).toEqual([{ reason: "email_de_tenant_com_assinatura_ativa_de_outro_cliente", stripe_customer_id: cus2 }]);
    expect((await pool.query("SELECT 1 FROM public.checkout_onboarding WHERE stripe_session_id = $1", [`cs_${cus2}`])).rowCount).toBe(0);
    expect((await sendWebhook(evt)).status).toBe(200); // reentrega: continua 200
  });

  it("e-mail de tenant sem cliente Stripe (cadastro manual/seed): não vincula, revisão manual, 200", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("semcli");
    const email = emailOf(cus);
    const shop = await pool.query<{ id: string }>("INSERT INTO public.barbershops (name, slug) VALUES ('Manual', $1) RETURNING id", [`manual-${stamp}`]);
    extraShops.push(shop.rows[0].id);
    await pool.query("INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role) VALUES (gen_random_uuid(), $1, 'Dono', $2, 'x', 'admin')", [shop.rows[0].id, email]);
    const out = await billing.provisionFromCheckoutSession(session(cus));
    expect(out).toMatchObject({ kind: "review", reason: "email_de_tenant_sem_cliente_stripe" });
    expect((await pool.query("SELECT stripe_customer_id FROM public.barbershops WHERE id = $1", [shop.rows[0].id])).rows[0].stripe_customer_id).toBeNull();
  });

  it("mesmo cliente com e-mail que pertence a OUTRO tenant: mantém o tenant do cliente, não cria perfil, revisão manual, sem erro", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("outro");
    await billing.provisionFromCheckoutSession(session(cus));
    const otherEmail = `dono-outro-${stamp}@example.test`;
    const other = await pool.query<{ id: string }>("INSERT INTO public.barbershops (name, slug) VALUES ('Alheio', $1) RETURNING id", [`alheio-${stamp}`]);
    extraShops.push(other.rows[0].id);
    await pool.query("INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role) VALUES (gen_random_uuid(), $1, 'Dono', $2, 'x', 'admin')", [other.rows[0].id, otherEmail]);
    const out = await billing.provisionFromCheckoutSession(session(cus, `cs_${cus}_2`, undefined, {}, otherEmail));
    expect(out).toMatchObject({ kind: "existing" });
    expect(await profilesWithEmail(otherEmail)).toBe(1);
    const rev = await pool.query("SELECT reason FROM public.billing_manual_reviews WHERE stripe_session_id = $1", [`cs_${cus}_2`]);
    expect(rev.rows).toEqual([{ reason: "email_pertence_a_outro_tenant" }]);
  });

  it("2 clientes Stripe DIFERENTES com o mesmo e-mail pagando ao mesmo tempo: 1 tenant, 1 perfil, o outro vai para revisão (sem 23505)", async (ctx) => {
    if (!ok) return ctx.skip();
    const a = newCustomer("sima");
    const b = newCustomer("simb");
    const email = emailOf(a);
    const results = await Promise.allSettled([
      billing.provisionFromCheckoutSession(session(a)),
      billing.provisionFromCheckoutSession(session(b, undefined, undefined, {}, email)),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await profilesWithEmail(email)).toBe(1);
    expect((await pool.query("SELECT 1 FROM public.barbershops WHERE stripe_customer_id = ANY($1)", [[a, b]])).rowCount).toBe(1);
    const kinds = results.map((r) => (r as PromiseFulfilledResult<{ kind: string }>).value.kind).sort();
    expect(kinds).toEqual(["created", "review"]);
  });

  // ---------- I-2: só provisiona com pagamento confirmado ----------

  it("sessão não paga (payment_status=unpaid) é ignorada com 200; async_payment_succeeded provisiona; async_payment_failed não", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("unpaid");
    const unpaid = { payment_status: "unpaid" };
    expect((await sendWebhook(checkoutEvent(`evt_conc_${stamp}_unpaid1`, cus, undefined, "checkout.session.completed", unpaid))).status).toBe(200);
    expect((await counts(cus)).shops).toBe(0);
    expect((await sendWebhook(checkoutEvent(`evt_conc_${stamp}_unpaid2`, cus, undefined, "checkout.session.async_payment_failed", unpaid))).status).toBe(200);
    expect((await counts(cus)).shops).toBe(0);
    expect((await sendWebhook(checkoutEvent(`evt_conc_${stamp}_unpaid3`, cus, undefined, "checkout.session.async_payment_succeeded", { payment_status: "paid" }))).status).toBe(200);
    expect(await counts(cus)).toMatchObject({ shops: 1, admins: 1 });
  });

  it("no_payment_required (ex.: cupom 100%) também provisiona", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("free");
    expect((await sendWebhook(checkoutEvent(`evt_conc_${stamp}_free`, cus, undefined, "checkout.session.completed", { payment_status: "no_payment_required" }))).status).toBe(200);
    expect((await counts(cus)).shops).toBe(1);
  });

  // ---------- HTTP: webhook assinado, entregas duplicadas em paralelo ----------

  it("HTTP: 6 entregas paralelas do mesmo checkout.session.completed → só 200/409, 1 tenant, 1 e-mail; depois 200", async (ctx) => {
    if (!ok) return ctx.skip();
    const cus = newCustomer("http");
    const evt = checkoutEvent(`evt_conc_${stamp}_http`, cus);
    const send = () => {
      const payload = JSON.stringify(evt);
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
      return request(app).post("/api/billing/webhook").set("content-type", "application/json").set("stripe-signature", header).send(payload);
    };
    const res = await Promise.all(Array.from({ length: 6 }, send));
    const statuses = res.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(await counts(cus)).toMatchObject({ shops: 1, accounts: 1, admins: 1, memberships: 1, keys: 1 });
    expect(sendOnboardingEmail).toHaveBeenCalledTimes(1);
    expect((await send()).status).toBe(200);
    expect(sendOnboardingEmail).toHaveBeenCalledTimes(1);
    const row = await pool.query("SELECT processed_at FROM public.stripe_events WHERE event_id = $1", [evt.id]);
    expect(row.rows[0].processed_at).toBeTruthy();
  });
});
