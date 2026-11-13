import { describe, expect, it } from "vitest";
import { evaluateSubscriptionAccess } from "../billing-access.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";
import { pool } from "../db.js";

const D = (s: string) => new Date(s);
const base = { stripeSubscriptionId: "sub_1", statusChangedAt: null as Date | null, periodEnd: null as Date | null };

describe("evaluateSubscriptionAccess", () => {
  it("sem assinatura Stripe (PIX/manual/legado) → liberado", () => {
    expect(evaluateSubscriptionAccess({ ...base, stripeSubscriptionId: null, status: "canceled" }).allowed).toBe(true);
  });
  it("active/trialing → ok", () => {
    expect(evaluateSubscriptionAccess({ ...base, status: "active" }).level).toBe("ok");
    expect(evaluateSubscriptionAccess({ ...base, status: "trialing" }).level).toBe("ok");
  });
  it("past_due: tolerância de 7 dias com aviso, depois bloqueia", () => {
    const changed = D("2026-11-01T12:00:00Z");
    const during = evaluateSubscriptionAccess({ ...base, status: "past_due", statusChangedAt: changed }, D("2026-11-05T12:00:00Z"), 7);
    expect(during).toMatchObject({ allowed: true, level: "grace" });
    expect(during.message).toMatch(/Atualize o pagamento/);
    const after = evaluateSubscriptionAccess({ ...base, status: "past_due", statusChangedAt: changed }, D("2026-11-09T12:00:00Z"), 7);
    expect(after).toMatchObject({ allowed: false, level: "blocked" });
  });
  it("canceled: segue até o fim do período pago, depois bloqueia", () => {
    const periodEnd = D("2026-11-20T00:00:00Z");
    expect(evaluateSubscriptionAccess({ ...base, status: "canceled", periodEnd }, D("2026-11-10T00:00:00Z")).allowed).toBe(true);
    expect(evaluateSubscriptionAccess({ ...base, status: "canceled", periodEnd }, D("2026-11-21T00:00:00Z")).allowed).toBe(false);
    expect(evaluateSubscriptionAccess({ ...base, status: "canceled" }, D("2026-11-21T00:00:00Z")).allowed).toBe(false);
  });
});

describe("limite de IA por plano", () => {
  it("Essencial (sem IA) não é mais ilimitado: hardExceeded", async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    const slug = `test-limit-${Date.now()}`;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Teste limite', '5511999990000', 'essential', $1, '{}'::jsonb) RETURNING id`,
      [slug],
    );
    try {
      const u = await getUsageAndLimit(r.rows[0]!.id);
      expect(u.limit).toBe(0);
      expect(u.hardExceeded).toBe(true);
    } finally {
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [r.rows[0]!.id]);
    }
  });
});
