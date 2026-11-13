import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  aiUsageAlertEnabled,
  aiUsageAlertThresholdPct,
  maybeAlertAiUsage,
  usagePeriod,
  usageReachedThreshold,
} from "../ai/usage-alert.js";

describe("regra do aviso de uso da IA (pura)", () => {
  it("flag padrão desligada; limiar padrão 80, com fallback para valores inválidos", () => {
    expect(aiUsageAlertEnabled({})).toBe(false);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: "false" })).toBe(false);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: " True " })).toBe(true);
    expect(aiUsageAlertThresholdPct({})).toBe(80);
    expect(aiUsageAlertThresholdPct({ AI_USAGE_ALERT_THRESHOLD_PCT: "90" })).toBe(90);
    for (const bad of ["0", "100", "abc", "-5"]) expect(aiUsageAlertThresholdPct({ AI_USAGE_ALERT_THRESHOLD_PCT: bad })).toBe(80);
  });
  it("dispara em >= 80% do limite; plano sem IA (limite 0) nunca", () => {
    expect(usageReachedThreshold(399, 500, 80)).toBe(false);
    expect(usageReachedThreshold(400, 500, 80)).toBe(true);
    expect(usageReachedThreshold(1999, 2000, 80)).toBe(true);
    expect(usageReachedThreshold(5, 0, 80)).toBe(false);
    expect(usageReachedThreshold(0, 0, 80)).toBe(false);
  });
  it("período é o mês no fuso de São Paulo", () => {
    expect(usagePeriod(new Date("2026-11-13T12:00:00Z"))).toBe("2026-11");
    // 01/12 00:30 UTC ainda é 30/11 21:30 em São Paulo
    expect(usagePeriod(new Date("2026-12-01T00:30:00Z"))).toBe("2026-11");
    expect(usagePeriod(new Date("2026-12-01T03:30:00Z"))).toBe("2026-12");
  });
  it("flag desligada: não chama o remetente e nem toca o banco", async () => {
    const sender = vi.fn();
    expect(await maybeAlertAiUsage({ barbershopId: "x", used: 450, limit: 500 }, { sender, env: {} })).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
  });
  it("abaixo do limiar: nada", async () => {
    const sender = vi.fn();
    expect(await maybeAlertAiUsage({ barbershopId: "x", used: 10, limit: 500 }, { sender, env: { AI_USAGE_ALERT_ENABLED: "true" } })).toBe("below");
    expect(sender).not.toHaveBeenCalled();
  });
});

describe("aviso de uso da IA (banco; remetente injetado, sem envio real)", () => {
  let ok = false;
  let pool: typeof import("../db.js").pool;
  const stamp = Date.now();
  let shopId = "";

  beforeAll(async () => {
    ({ pool } = await import("../db.js"));
    try {
      await pool.query("SELECT 1 FROM public.ai_usage_alerts LIMIT 1");
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
         VALUES ('Teste alerta IA', '5511999990000', 'pro', $1, '{}'::jsonb) RETURNING id`,
        [`test-ua-${stamp}`],
      );
      shopId = r.rows[0]!.id;
      await pool.query(
        `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, phone, password_hash, role)
         VALUES (gen_random_uuid(), $1, 'Dono', $2, '5511988887777', 'x', 'admin')`,
        [shopId, `dono-ua-${stamp}@example.test`],
      );
      ok = true;
    } catch {
      ok = false;
    }
    expect(ok, "migration ai_usage_alerts não aplicada no banco de teste").toBe(true);
  });
  afterAll(async () => {
    if (!ok) return;
    await pool.query("DELETE FROM public.profiles WHERE barbershop_id = $1", [shopId]);
    await pool.query("DELETE FROM public.barbershops WHERE id = $1", [shopId]);
  });

  const env = { AI_USAGE_ALERT_ENABLED: "true" };
  it("envia 1x por mês ao admin com uso/limite/percentual; repetições no mesmo mês são duplicata; mês novo avisa de novo", async () => {
    const sender = vi.fn(async () => {});
    const now = new Date("2026-11-13T12:00:00Z");
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { sender, env, now })).toBe("sent");
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ to: `dono-ua-${stamp}@example.test`, used: 400, limit: 500, thresholdPct: 80, barbershopName: "Teste alerta IA" }),
    );
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 450, limit: 500 }, { sender, env, now })).toBe("duplicate");
    expect(sender).toHaveBeenCalledTimes(1);
    const dec = new Date("2026-12-15T12:00:00Z");
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 410, limit: 500 }, { sender, env, now: dec })).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it("falha do remetente não propaga", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ses down");
    });
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { sender: boom, env, now: new Date("2027-01-10T12:00:00Z") })).toBe("error");
  });

  it("sem e-mail de admin → no_recipient (não envia)", async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Sem admin', '5511999990001', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-ua2-${stamp}`],
    );
    try {
      const sender = vi.fn();
      expect(await maybeAlertAiUsage({ barbershopId: r.rows[0]!.id, used: 400, limit: 500 }, { sender, env })).toBe("no_recipient");
      expect(sender).not.toHaveBeenCalled();
    } finally {
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [r.rows[0]!.id]);
    }
  });
});
