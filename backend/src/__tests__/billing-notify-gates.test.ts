import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.N8N_EVENTS_WEBHOOK_URL = "https://n8n.invalid/hook";
  process.env.N8N_EVENTS_SECRET = "segredo-de-teste";
  delete process.env.BILLING_NOTIFY_PAYMENT_FAILED;
});

import { app } from "../app.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { notifyOwnerPaymentFailed, resetPaymentFailedRetryThrottleForTests, retryPaymentFailedNotices } from "../lib/billing-notify.js";
import { whatsappConnectGate } from "../lib/billing-gates.js";
import { dispatchOutboundEvents, enqueueOutboundEvent } from "../outbound/n8n-events.js";

// SEM `if (!db) return`: sem banco ou sem migrations este arquivo FALHA.
const stamp = Date.now();
const ids: string[] = [];
const ENV_ON = { BILLING_NOTIFY_PAYMENT_FAILED: "true", BILLING_GRACE_DAYS: "7" };

async function shop(label: string, o: { plan?: string; status?: string; changed?: string | null; withAdmin?: boolean } = {}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_status_changed_at)
     VALUES ($1, '5511999990000', $2, $3, '{}'::jsonb, $4, $5, $6, $7) RETURNING id`,
    [`Teste ${label}`, o.plan ?? "pro", `test-bng-${label}-${stamp}`, `cus_${label}_${stamp}`, `sub_${label}_${stamp}`, o.status ?? "active", o.changed ?? null],
  );
  const id = r.rows[0]!.id;
  ids.push(id);
  if (o.withAdmin) await admin(id, label);
  return id;
}
async function admin(id: string, label: string): Promise<void> {
  await pool.query(
    `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, phone, password_hash, role)
     VALUES (gen_random_uuid(), $1, 'Dono', $2, '5511988887777', 'x', 'admin')`,
    [id, `dono-${label}-${stamp}@example.test`],
  );
}
const logRows = async (id: string) => (await pool.query("SELECT ref FROM public.billing_notice_log WHERE barbershop_id = $1 AND kind = 'payment_failed'", [id])).rows;
const EXPIRED = "2026-01-01T00:00:00Z";

beforeAll(async () => {
  await pool.query("SELECT subscription_event_at FROM public.barbershops LIMIT 1");
  await pool.query("SELECT 1 FROM public.billing_notice_log LIMIT 1");
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FROM_EMAIL;
  resetPaymentFailedRetryThrottleForTests();
});
afterAll(async () => {
  await pool.query("DELETE FROM public.outbound_events WHERE barbershop_id = ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM public.profiles WHERE barbershop_id = ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM public.barbershops WHERE id = ANY($1::uuid[])", [ids]);
});

describe("aviso de pagamento: dedupe SÓ depois do envio, com reenvio", () => {
  it("falha do envio não grava dedupe; o reenvio funciona; depois do sucesso é duplicado", async () => {
    const id = await shop("n1", { withAdmin: true });
    const boom = vi.fn(async () => {
      throw new Error("ses down");
    });
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_1" }, { sender: boom, env: ENV_ON })).toBe("error");
    expect(await logRows(id)).toHaveLength(0); // não perde o aviso
    const ok = vi.fn(async () => {});
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_1" }, { sender: ok, env: ENV_ON })).toBe("sent");
    expect(await logRows(id)).toEqual([{ ref: "in_1" }]);
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_1" }, { sender: ok, env: ENV_ON })).toBe("duplicate");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("sem FROM_EMAIL o envio padrão LANÇA: resultado «error», nada gravado como enviado (antes: «sent»)", async () => {
    const id = await shop("n2", { withAdmin: true });
    delete process.env.FROM_EMAIL;
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_2" }, { env: ENV_ON })).toBe("error");
    expect(await logRows(id)).toHaveLength(0);
  });

  it("dono sem admin com e-mail: «no_recipient» sem gravar; quando o admin aparece, a varredura envia", async () => {
    const id = await shop("n3", { status: "past_due", changed: new Date().toISOString() });
    expect(await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_3" }, { sender: async () => {}, env: ENV_ON })).toBe("no_recipient");
    expect(await logRows(id)).toHaveLength(0);
    await admin(id, "n3");
    const sender = vi.fn(async () => {});
    const res = await retryPaymentFailedNotices({ sender, env: ENV_ON });
    expect(res.sent).toBeGreaterThanOrEqual(1);
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ to: `dono-n3-${stamp}@example.test` }));
    expect((await logRows(id)).length).toBe(1);
    // nova varredura: nada mais a reenviar para essa barbearia
    resetPaymentFailedRetryThrottleForTests();
    const again = vi.fn(async () => {});
    await retryPaymentFailedNotices({ sender: again, env: ENV_ON });
    expect(again.mock.calls.filter((c) => (c as unknown as [{ to: string }])[0].to.includes("n3"))).toHaveLength(0);
  });

  it("varredura de reenvio: ignora assinatura ativa e carência vencida; desligada pela flag; throttle", async () => {
    const active = await shop("r1", { withAdmin: true });
    const expired = await shop("r2", { status: "past_due", changed: EXPIRED, withAdmin: true });
    const sender = vi.fn(async () => {});
    expect(await retryPaymentFailedNotices({ sender, env: {} })).toEqual({ attempted: 0, sent: 0 }); // flag desligada
    await retryPaymentFailedNotices({ sender, env: ENV_ON });
    expect(await logRows(active)).toHaveLength(0);
    expect(await logRows(expired)).toHaveLength(0);
    // throttle: segunda chamada imediata não faz nada
    expect(await retryPaymentFailedNotices({ sender, env: ENV_ON })).toEqual({ attempted: 0, sent: 0 });
  });

  it("duas execuções concorrentes para a mesma fatura: um envio só", async () => {
    const id = await shop("n4", { withAdmin: true });
    const sender = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    const [a, b] = await Promise.all([
      notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_4" }, { sender, env: ENV_ON }),
      notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_4" }, { sender, env: ENV_ON }),
    ]);
    expect([a, b].sort()).toEqual(["duplicate", "sent"]);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("a data limite do e-mail parte da mudança de status gravada, não de «agora»", async () => {
    const id = await shop("n5", { status: "past_due", changed: "2026-11-10T12:00:00Z", withAdmin: true });
    const sender = vi.fn(async () => {});
    await notifyOwnerPaymentFailed({ barbershopId: id, invoiceId: "in_5" }, { sender, env: ENV_ON, now: new Date("2026-11-13T12:00:00Z") });
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ graceEndsAt: new Date("2026-11-17T12:00:00Z") }));
  });
});

describe("gates por assinatura/plano", () => {
  it("/tools: assinatura vencida → 402; plano em dia passa pela porta", async () => {
    const blocked = await shop("t1", { status: "past_due", changed: EXPIRED });
    const fine = await shop("t2", { status: "active" });
    const keyBlocked = `tk_${stamp}_blocked`;
    const keyFine = `tk_${stamp}_fine`;
    for (const [sid, key] of [[blocked, keyBlocked], [fine, keyFine]] as const) {
      await pool.query("INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash) VALUES ($1, 'teste', $2)", [sid, await bcrypt.hash(key, 4)]);
    }
    const r1 = await request(app).get("/api/tools/list_services").set("x-api-key", keyBlocked);
    expect(r1.status).toBe(402);
    expect(r1.body.code).toBe("subscription_blocked");
    const r2 = await request(app).get("/api/tools/list_services").set("x-api-key", keyFine);
    expect(r2.status).toBe(200);
  });

  it("n8n-events: assinatura vencida não envia (evento dead com motivo); plano em dia envia", async () => {
    const blocked = await shop("e1", { status: "past_due", changed: EXPIRED });
    const fine = await shop("e2", { status: "active" });
    await enqueueOutboundEvent(blocked, "appointment_created", { a: 1 });
    await enqueueOutboundEvent(fine, "appointment_created", { a: 2 });
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await dispatchOutboundEvents();
    } finally {
      vi.unstubAllGlobals();
    }
    const sentTo = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, { body: string }])[1].body)).barbershop_id as string);
    expect(sentTo).toContain(fine);
    expect(sentTo).not.toContain(blocked);
    const ev = await pool.query("SELECT status, last_error FROM public.outbound_events WHERE barbershop_id = $1", [blocked]);
    expect(ev.rows[0]).toMatchObject({ status: "dead", last_error: expect.stringContaining("assinatura inativa") });
    const ok = await pool.query("SELECT status FROM public.outbound_events WHERE barbershop_id = $1", [fine]);
    expect(ok.rows[0].status).toBe("sent");
  });

  it("conectar WhatsApp: Essencial → 403 plan_required, assinatura vencida → 402, Pro em dia → liberado (função e rota)", async () => {
    const essential = await shop("c1", { plan: "essential" });
    const blocked = await shop("c2", { plan: "pro", status: "past_due", changed: EXPIRED });
    const fine = await shop("c3", { plan: "pro" });
    expect(await whatsappConnectGate(essential)).toMatchObject({ ok: false, status: 403, code: "plan_required" });
    expect(await whatsappConnectGate(blocked)).toMatchObject({ ok: false, status: 402, code: "subscription_blocked" });
    expect(await whatsappConnectGate(fine)).toEqual({ ok: true });
    const token = (id: string) => jwt.sign({ profileId: "00000000-0000-0000-0000-000000000001", barbershopId: id, role: "admin", email: "t@test.com" }, config.jwtSecret ?? "test-secret");
    for (const path of ["/api/integrations/whatsapp/connect", "/api/integrations/whatsapp/uazapi/start", "/api/integrations/whatsapp/uazapi/link-existing"]) {
      const r1 = await request(app).post(path).set("Authorization", `Bearer ${token(essential)}`).send({});
      expect([path, r1.status, r1.body.code]).toEqual([path, 403, "plan_required"]);
      const r2 = await request(app).post(path).set("Authorization", `Bearer ${token(blocked)}`).send({});
      expect([path, r2.status, r2.body.code]).toEqual([path, 402, "subscription_blocked"]);
    }
  });
});
