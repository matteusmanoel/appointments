import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiUsageAlertEnabled,
  aiUsageAlertThresholdPct,
  maybeAlertAiUsage,
  resetUsageAlertCacheForTests,
  usagePeriod,
  usageReachedThreshold,
} from "../ai/usage-alert.js";

describe("regra do aviso de uso da IA (pura)", () => {
  it("flag padrão ligada; desliga só com false/0/off/no; limiar padrão 80, com fallback para valores inválidos", () => {
    expect(aiUsageAlertEnabled({})).toBe(true);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: "" })).toBe(true);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: "false" })).toBe(false);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: "0" })).toBe(false);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: "off" })).toBe(false);
    expect(aiUsageAlertEnabled({ AI_USAGE_ALERT_ENABLED: "no" })).toBe(false);
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
    expect(await maybeAlertAiUsage({ barbershopId: "x", used: 450, limit: 500 }, { sender, env: { AI_USAGE_ALERT_ENABLED: "false" } })).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
  });
  it("flag padrão ligada: com uso no limiar não retorna disabled", async () => {
    const sender = vi.fn();
    // env vazio = ligado; shop inexistente → no_recipient ou error, nunca disabled
    const result = await maybeAlertAiUsage({ barbershopId: "00000000-0000-0000-0000-000000000000", used: 450, limit: 500 }, { sender, env: {} });
    expect(result).not.toBe("disabled");
    expect(["no_recipient", "error", "sent"]).toContain(result);
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
  const rows = async (id: string) => (await pool.query("SELECT period FROM public.ai_usage_alerts WHERE barbershop_id = $1", [id])).rows;
  beforeEach(() => resetUsageAlertCacheForTests());
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

  it("falha do remetente não propaga E não consome o aviso do mês: o próximo turno reenvia", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ses down");
    });
    const now = new Date("2027-01-10T12:00:00Z");
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { sender: boom, env, now })).toBe("error");
    expect((await rows(shopId)).filter((r) => r.period === "2027-01")).toHaveLength(0);
    const ok = vi.fn(async () => {});
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 410, limit: 500 }, { sender: ok, env, now })).toBe("sent");
    expect(ok).toHaveBeenCalledTimes(1);
    expect((await rows(shopId)).filter((r) => r.period === "2027-01")).toHaveLength(1);
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 420, limit: 500 }, { sender: ok, env, now })).toBe("duplicate");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  describe("sem FROM_EMAIL", () => {
    afterEach(() => {
      delete process.env.FROM_EMAIL;
    });
    it("o envio padrão lança: «error», nada consumido (antes: «sent» sem ter enviado)", async () => {
      delete process.env.FROM_EMAIL;
      const now = new Date("2027-02-10T12:00:00Z");
      expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { env, now })).toBe("error");
      expect((await rows(shopId)).filter((r) => r.period === "2027-02")).toHaveLength(0);
    });
  });

  it("execuções concorrentes no mesmo mês: um envio só", async () => {
    const sender = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    const now = new Date("2027-03-10T12:00:00Z");
    const [a, b] = await Promise.all([
      maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { sender, env, now }),
      maybeAlertAiUsage({ barbershopId: shopId, used: 401, limit: 500 }, { sender, env, now }),
    ]);
    expect([a, b].sort()).toEqual(["duplicate", "sent"]);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("cache por processo: depois de resolvido, turnos seguintes não consultam o banco", async () => {
    const sender = vi.fn(async () => {});
    const now = new Date("2027-04-10T12:00:00Z");
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { sender, env, now })).toBe("sent");
    const spy = vi.spyOn(pool, "connect");
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 450, limit: 500 }, { sender, env, now })).toBe("duplicate");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("o mês do contador de uso e o do dedupe usam o mesmo fuso (America/Sao_Paulo)", async () => {
    // 01/12 01:00 UTC ainda é 30/11 22:00 em São Paulo: pertence a novembro nas duas regras
    const r = await pool.query<{ start: Date }>(
      `SELECT (date_trunc('month', timestamptz '2026-12-01 01:00+00' AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS start`,
    );
    expect(r.rows[0]!.start.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(usagePeriod(new Date("2026-12-01T01:00:00Z"))).toBe("2026-11");
    const src = (await import("node:fs")).readFileSync(new URL("../ai/usage-limits.ts", import.meta.url), "utf8");
    expect(src).toContain("AT TIME ZONE 'America/Sao_Paulo'");
  });

  it("sem e-mail de admin → no_recipient (não envia e não consome o aviso do mês)", async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Sem admin', '5511999990001', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-ua2-${stamp}`],
    );
    try {
      const sender = vi.fn();
      expect(await maybeAlertAiUsage({ barbershopId: r.rows[0]!.id, used: 400, limit: 500 }, { sender, env })).toBe("no_recipient");
      expect(sender).not.toHaveBeenCalled();
      expect(await rows(r.rows[0]!.id)).toHaveLength(0);
    } finally {
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [r.rows[0]!.id]);
    }
  });
});
