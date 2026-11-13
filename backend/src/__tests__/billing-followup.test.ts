import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aiGateState, getSubscriptionAccess, planBackfill } from "../billing-access.js";
import { notifyOwnerPaymentFailed, paymentFailedNotifyEnabled } from "../lib/billing-notify.js";

const SECRET = "whsec_teste_followup";
vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_teste_followup";
});
const D = (s: string) => new Date(s);
const NOW = D("2026-11-13T12:00:00Z");

describe("planBackfill (regra pura)", () => {
  const base = { stripeSubscriptionId: "sub_x", statusChangedAt: null as Date | null, periodEnd: null as Date | null };
  it("past_due sem data de referência: tolerância começa agora", () => {
    expect(planBackfill({ ...base, status: "past_due" }, NOW, 7)).toEqual({ statusChangedAt: NOW });
    expect(planBackfill({ ...base, status: "unpaid", statusChangedAt: D("2026-11-01T00:00:00Z") }, NOW, 7)).toEqual({});
  });
  it("canceled sem fim de período: despedida de 7 dias; com fim, intocado", () => {
    expect(planBackfill({ ...base, status: "canceled" }, NOW, 7)).toEqual({ periodEnd: D("2026-11-20T12:00:00Z") });
    expect(planBackfill({ ...base, status: "canceled", periodEnd: D("2026-11-01T00:00:00Z") }, NOW, 7)).toEqual({});
  });
  it("active, trialing e sem assinatura Stripe: nada a preencher", () => {
    expect(planBackfill({ ...base, status: "active" }, NOW, 7)).toEqual({});
    expect(planBackfill({ ...base, stripeSubscriptionId: null, status: "past_due" }, NOW, 7)).toEqual({});
  });
});

describe("notifyOwnerPaymentFailed (atrás de flag, sem envio real)", () => {
  it("flag: padrão desligada", () => {
    expect(paymentFailedNotifyEnabled({})).toBe(false);
    expect(paymentFailedNotifyEnabled({ BILLING_NOTIFY_PAYMENT_FAILED: "false" })).toBe(false);
    expect(paymentFailedNotifyEnabled({ BILLING_NOTIFY_PAYMENT_FAILED: " TRUE " })).toBe(true);
  });
  it("desligada: não chama o remetente e não toca o banco", async () => {
    const sender = vi.fn();
    expect(await notifyOwnerPaymentFailed({ barbershopId: "x", invoiceId: "in_1" }, { sender, env: {} })).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("cobrança: banco", () => {
  let ok = false;
  let pool: typeof import("../db.js").pool;
  let app: typeof import("../app.js").app;
  const stamp = Date.now();
  const ids: string[] = [];
  let n = 0;

  async function shop(label: string, cols: Record<string, unknown>, plan = "pro"): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours, stripe_customer_id, stripe_subscription_id, subscription_status,
                                       subscription_status_changed_at, subscription_current_period_end)
       VALUES ($1, '5511999990000', $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8) RETURNING id`,
      [
        `Teste ${label}`,
        plan,
        `test-bf-${label}-${stamp}`,
        `cus_${label}_${stamp}`,
        `sub_${label}_${stamp}`,
        cols.status ?? "active",
        cols.changed ?? null,
        cols.periodEnd ?? null,
      ],
    );
    ids.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    ({ pool } = await import("../db.js"));
    ({ app } = await import("../app.js"));
    try {
      await pool.query("SELECT subscription_event_at FROM public.barbershops LIMIT 1");
      await pool.query("SELECT 1 FROM public.stripe_events LIMIT 1");
      await pool.query("SELECT 1 FROM public.billing_notice_log LIMIT 1");
      ok = true;
    } catch {
      ok = false;
    }
    // não passar em silêncio: sem as migrations os testes de banco não provam nada
    expect(ok, "migrations de cobrança não aplicadas no banco de teste").toBe(true);
  });
  afterAll(async () => {
    if (!ok) return;
    await pool.query("DELETE FROM public.stripe_events WHERE event_id LIKE $1", [`evt_bf_${stamp}%`]);
    await pool.query("DELETE FROM public.scheduled_messages WHERE barbershop_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM public.profiles WHERE barbershop_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM public.barbershops WHERE id = ANY($1::uuid[])", [ids]);
  });

  const send = (type: string, object: object, created: number) => {
    const evt = { id: `evt_bf_${stamp}_${++n}`, object: "event", type, created, data: { object } };
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app).post("/api/billing/webhook").set("content-type", "application/json").set("stripe-signature", header).send(payload);
  };
  const status = async (id: string) =>
    (await pool.query<{ subscription_status: string }>("SELECT subscription_status FROM public.barbershops WHERE id = $1", [id])).rows[0]!.subscription_status;
  const t0 = Math.floor(Date.now() / 1000);

  it("migration: backfill de past_due e canceled existentes (executa o SQL da migration)", async () => {
    const pastDue = await shop("bf1", { status: "past_due" });
    const canceled = await shop("bf2", { status: "canceled" });
    const pastDueKept = await shop("bf3", { status: "past_due", changed: "2026-10-01T00:00:00Z" });
    const active = await shop("bf4", { status: "active" });
    const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/20261113131000_billing_backfill_notice_log.sql"), "utf8");
    await pool.query(sql);
    const q = async (id: string) =>
      (await pool.query<{ c: Date | null; p: Date | null }>(
        "SELECT subscription_status_changed_at AS c, subscription_current_period_end AS p FROM public.barbershops WHERE id = $1",
        [id],
      )).rows[0]!;
    const a = await q(pastDue);
    expect(a.c).toBeTruthy();
    expect(Date.now() - a.c!.getTime()).toBeLessThan(60_000); // tolerância começa na migration
    const b = await q(canceled);
    expect(b.p!.getTime() - Date.now()).toBeGreaterThan(6 * 86_400_000);
    expect(b.p!.getTime() - Date.now()).toBeLessThan(8 * 86_400_000);
    expect((await q(pastDueKept)).c!.toISOString()).toBe("2026-10-01T00:00:00.000Z"); // não reinicia quem já tem data
    const c = await q(active);
    expect(c.c).toBeNull();
    expect(c.p).toBeNull();
    // idempotente: segunda execução não muda nada
    const before = await q(pastDue);
    await pool.query(sql);
    expect((await q(pastDue)).c!.getTime()).toBe(before.c!.getTime());
  });

  it("leitura: past_due legado sem data é preenchido uma vez e a tolerância não desliza", async () => {
    const id = await shop("rd1", { status: "past_due" });
    const first = await getSubscriptionAccess(id);
    expect(first).toMatchObject({ allowed: true, level: "grace" });
    const stored = (await pool.query<{ c: Date }>("SELECT subscription_status_changed_at AS c FROM public.barbershops WHERE id = $1", [id])).rows[0]!.c;
    expect(stored).toBeTruthy();
    const second = await getSubscriptionAccess(id);
    expect(second.graceEndsAt!.getTime()).toBe(first.graceEndsAt!.getTime());
  });

  it("ordem: invoice.payment_failed atrasado depois de invoice.paid mais novo é ignorado", async () => {
    const id = await shop("ord1", { status: "active" });
    const cus = `cus_ord1_${stamp}`;
    expect((await send("invoice.payment_failed", { id: "in_a", object: "invoice", customer: cus }, t0)).status).toBe(200);
    expect(await status(id)).toBe("past_due");
    expect((await send("invoice.paid", { id: "in_a", object: "invoice", customer: cus }, t0 + 60)).status).toBe(200);
    expect(await status(id)).toBe("active");
    // falha MAIS VELHA (t0+10) chegando depois do paid (t0+60): não reverte
    expect((await send("invoice.payment_failed", { id: "in_b", object: "invoice", customer: cus }, t0 + 10)).status).toBe(200);
    expect(await status(id)).toBe("active");
    // falha mais nova que o paid: aplica
    expect((await send("invoice.payment_failed", { id: "in_c", object: "invoice", customer: cus }, t0 + 120)).status).toBe(200);
    expect(await status(id)).toBe("past_due");
  });

  it("dedupe: invoice.paid + invoice.payment_succeeded da mesma fatura e reentrega do mesmo event.id são no-op; falhas repetidas não renovam a tolerância", async () => {
    const id = await shop("dd1", { status: "active" });
    const cus = `cus_dd1_${stamp}`;
    await send("invoice.payment_failed", { id: "in_d1", object: "invoice", customer: cus }, t0);
    const changed1 = (await pool.query<{ c: Date }>("SELECT subscription_status_changed_at AS c FROM public.barbershops WHERE id = $1", [id])).rows[0]!.c;
    await new Promise((r) => setTimeout(r, 15));
    await send("invoice.payment_failed", { id: "in_d2", object: "invoice", customer: cus }, t0 + 5); // retry do Stripe
    const changed2 = (await pool.query<{ c: Date }>("SELECT subscription_status_changed_at AS c FROM public.barbershops WHERE id = $1", [id])).rows[0]!.c;
    expect(changed2.getTime()).toBe(changed1.getTime());
    await send("invoice.paid", { id: "in_d2", object: "invoice", customer: cus }, t0 + 30);
    const afterPaid = (await pool.query<{ c: Date }>("SELECT subscription_status_changed_at AS c FROM public.barbershops WHERE id = $1", [id])).rows[0]!.c;
    await new Promise((r) => setTimeout(r, 15));
    await send("invoice.payment_succeeded", { id: "in_d2", object: "invoice", customer: cus }, t0 + 30);
    const afterSucceeded = (await pool.query<{ c: Date }>("SELECT subscription_status_changed_at AS c FROM public.barbershops WHERE id = $1", [id])).rows[0]!.c;
    expect(afterSucceeded.getTime()).toBe(afterPaid.getTime());
    expect(await status(id)).toBe("active");
  });

  it("aviso ao dono: flag ligada envia 1x por fatura (injetado, sem envio real); retry do Stripe não duplica", async () => {
    const id = await shop("nt1", { status: "active" });
    await pool.query(
      `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, phone, password_hash, role)
       VALUES (gen_random_uuid(), $1, 'Dono', $2, '5511988887777', 'x', 'admin')`,
      [id, `dono-${stamp}@example.test`],
    );
    const sender = vi.fn(async () => {});
    const env = { BILLING_NOTIFY_PAYMENT_FAILED: "true", BILLING_GRACE_DAYS: "7" };
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_n1" }, { sender, env, now: NOW })).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ to: `dono-${stamp}@example.test`, graceEndsAt: D("2026-11-20T12:00:00Z") }));
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_n1" }, { sender, env })).toBe("duplicate");
    expect(sender).toHaveBeenCalledTimes(1);
    // erro do remetente não propaga (webhook do Stripe não pode falhar por causa do aviso)
    const boom = vi.fn(async () => {
      throw new Error("ses down");
    });
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_n2" }, { sender: boom, env })).toBe("error");
  });

  it("webhook com a flag desligada (padrão) não envia nada: fatura com falha só muda o estado", async () => {
    delete process.env.BILLING_NOTIFY_PAYMENT_FAILED;
    const id = await shop("nt2", { status: "active" });
    expect((await send("invoice.payment_failed", { id: "in_nt2", object: "invoice", customer: `cus_nt2_${stamp}` }, t0)).status).toBe(200);
    expect(await status(id)).toBe("past_due");
    const log = await pool.query("SELECT 1 FROM public.billing_notice_log WHERE barbershop_id = $1", [id]);
    expect(log.rowCount).toBe(0);
  });

  it("porta da IA (vale para o ramo n8n): Essencial, assinatura vencida e plano normal", async () => {
    const essential = await shop("g1", { status: "active" }, "essential");
    const blocked = await shop("g2", { status: "past_due", changed: "2026-01-01T00:00:00Z" }, "pro");
    const fine = await shop("g3", { status: "active" }, "pro");
    expect(await aiGateState(essential)).toBe("hard_limit");
    expect(await aiGateState(blocked)).toBe("subscription_blocked");
    expect(await aiGateState(fine)).toBeNull();
  });

  it("worker de envios: assinatura inativa pausa cobrança de planos, reativação e lembretes (antes passavam)", async () => {
    const { runScheduledMessagesCycle } = await import("../workers/scheduled-messages-worker.js");
    const blocked = await shop("w1", { status: "past_due", changed: "2026-01-01T00:00:00Z" });
    const fine = await shop("w2", { status: "active" });
    const insert = async (shopId: string, type: string, phone: string) =>
      (await pool.query<{ id: string }>(
        `INSERT INTO public.scheduled_messages (barbershop_id, to_phone, type, status, payload_json, run_after)
         VALUES ($1, $2, $3, 'queued', '{}'::jsonb, now() - interval '1 minute') RETURNING id`,
        [shopId, phone, type],
      )).rows[0]!.id;
    const jobs = [
      await insert(blocked, "plan_billing", "5545900001001"),
      await insert(blocked, "reactivation", "5545900001002"),
      await insert(blocked, "reminder_24h", "5545900001003"),
    ];
    const okJob = await insert(fine, "plan_billing", "5545900001004");
    await runScheduledMessagesCycle({ maxBatches: 60 });
    for (const id of jobs) {
      const r = await pool.query<{ status: string; last_error: string | null }>("SELECT status, last_error FROM public.scheduled_messages WHERE id = $1", [id]);
      expect(r.rows[0]).toMatchObject({ status: "skipped", last_error: "Assinatura inativa: envio automático pausado" });
    }
    const fineRow = await pool.query<{ last_error: string | null }>("SELECT last_error FROM public.scheduled_messages WHERE id = $1", [okJob]);
    expect(fineRow.rows[0]!.last_error ?? "").not.toContain("Assinatura inativa");
  });
});
