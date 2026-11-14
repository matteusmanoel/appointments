import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHardCapTurn, IA_PAUSED_BY_LIMIT_REASON } from "../ai/usage-cap.js";
import {
  USAGE_ALERT_KEY_HARD_CAP,
  USAGE_ALERT_KEY_LIMIT,
  maybeAlertAiUsage,
  maybeAlertAiUsageHardCap,
  maybeAlertAiUsageLimit,
  resetUsageAlertCacheForTests,
} from "../ai/usage-alert.js";
import { buildAiUsageAlertTexts } from "../lib/ses.js";

describe("silêncio no teto (sem mensagem ao cliente)", () => {
  it("não há texto ao cliente nem AI_HARD_CAP_CUSTOMER_MESSAGE no código do teto", () => {
    const cap = readFileSync(new URL("../ai/usage-cap.ts", import.meta.url), "utf8");
    expect(cap).not.toContain("AI_HARD_CAP_CUSTOMER_MESSAGE");
    expect(cap).not.toContain("DEFAULT_HARD_CAP_CUSTOMER_MESSAGE");
    expect(cap).not.toContain("hardCapCustomerMessage");
    const src = readFileSync(new URL("../workers/ai-worker.ts", import.meta.url), "utf8");
    expect(src).not.toContain("AI_HARD_CAP_CUSTOMER_MESSAGE");
  });
});

describe("texto do e-mail ao dono (margem real e aviso do teto)", () => {
  it("80%: diz quantas respostas faltam, a margem até o teto e que no teto o agente fica em silêncio", () => {
    const t = buildAiUsageAlertTexts({ barbershopName: "Barbearia X", used: 400, limit: 500, thresholdPct: 80 });
    const all = t.paragraphs.join(" ");
    expect(t.subject).toContain("80%");
    expect(all).toContain("400 de 500");
    expect(all).toContain("Faltam 100 respostas para o limite");
    expect(all).toContain("mais 500 de margem");
    expect(all).toContain("teto de 1000");
    expect(all).toMatch(/fica em silêncio com o cliente/);
    expect(all).not.toMatch(/aviso curto/);
  });
  it("100%: a IA segue por mais N até o teto; teto: IA parou e o agente fica em silêncio", () => {
    const l = buildAiUsageAlertTexts({ barbershopName: "B", used: 500, limit: 500, thresholdPct: 100, kind: "limit" }).paragraphs.join(" ");
    expect(l).toContain("100% do limite");
    expect(l).toContain("mais 500 respostas, até o teto de 1000");
    expect(l).toMatch(/fica em silêncio com o cliente/);
    expect(l).not.toMatch(/aviso curto/);
    const c = buildAiUsageAlertTexts({ barbershopName: "B", used: 1000, limit: 500, thresholdPct: 200, kind: "hard_cap" });
    expect(c.subject).toMatch(/parou de responder/);
    expect(c.paragraphs.join(" ")).toContain("1000 de 1000");
    expect(c.paragraphs.join(" ")).toMatch(/fica em silêncio com o cliente/);
    expect(c.paragraphs.join(" ")).not.toMatch(/aviso curto/);
  });
});

describe("teto de uso da IA: silêncio com o cliente, registro 1x e alertas ao dono 1x (remetente injetado, sem envio real)", () => {
  let pool: typeof import("../db.js").pool;
  const stamp = Date.now();
  let shopId = "";
  const convs: string[] = [];
  const env = { AI_USAGE_ALERT_ENABLED: "true", AI_USAGE_OWNER_EMAIL_ENABLED: "true" };
  const now = new Date("2027-05-10T12:00:00Z");

  async function mkConv(sandbox = false): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', $2, $3) RETURNING id`,
      [shopId, `5511${stamp}${convs.length}`, sandbox],
    );
    convs.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }
  const alertRows = async () => (await pool.query("SELECT period, threshold_pct FROM public.ai_usage_alerts WHERE barbershop_id = $1", [shopId])).rows;
  const noticeRows = async () => (await pool.query("SELECT 1 FROM public.ai_hard_cap_notices WHERE conversation_id = ANY($1::uuid[])", [convs])).rows;

  beforeAll(async () => {
    ({ pool } = await import("../db.js"));
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Teste teto IA', '5511999990000', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-cap-${stamp}`],
    );
    shopId = r.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, phone, password_hash, role)
       VALUES (gen_random_uuid(), $1, 'Dono', $2, '5511988887777', 'x', 'admin')`,
      [shopId, `dono-cap-${stamp}@example.test`],
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM public.agenda_activity WHERE barbershop_id = $1", [shopId]);
    await pool.query("DELETE FROM public.ai_handoff_events WHERE barbershop_id = $1", [shopId]);
    await pool.query("DELETE FROM public.ai_conversations WHERE barbershop_id = $1", [shopId]);
    await pool.query("DELETE FROM public.profiles WHERE barbershop_id = $1", [shopId]);
    await pool.query("DELETE FROM public.barbershops WHERE id = $1", [shopId]);
  });
  beforeEach(() => resetUsageAlertCacheForTests());

  it("no teto, o cliente permanece em silêncio; o evento é gravado UMA vez por conversa e mês", async () => {
    const sender = vi.fn(async () => {});
    const c1 = await mkConv();
    const c2 = await mkConv();
    const p = { barbershopId: shopId, used: 1000, limit: 500 };

    const first = await handleHardCapTurn({ ...p, conversationId: c1 }, { sender, env, now });
    expect(first).toMatchObject({ reply: "", event: "recorded", ownerAlert: "sent" });
    for (let i = 0; i < 3; i++) {
      const again = await handleHardCapTurn({ ...p, used: 1001 + i, conversationId: c1 }, { sender, env, now });
      expect(again).toMatchObject({ reply: "", event: "already_recorded" });
    }
    const other = await handleHardCapTurn({ ...p, conversationId: c2 }, { sender, env, now });
    expect(other).toMatchObject({ reply: "", event: "recorded" });
    const nextMonth = new Date("2027-06-10T12:00:00Z");
    const next = await handleHardCapTurn({ ...p, conversationId: c1 }, { sender, env, now: nextMonth });
    expect(next).toMatchObject({ reply: "", event: "recorded" });
    expect(await noticeRows()).toHaveLength(3); // c1/maio, c2/maio, c1/junho
  });

  it("na primeira vez no mês marca a conversa para a atendente («IA pausada por limite»); no mesmo mês não repete; nada vai ao cliente", async () => {
    const sender = vi.fn(async () => {});
    const month = new Date("2028-01-10T12:00:00Z");
    const c = await mkConv();
    const first = await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 1000, limit: 500 }, { sender, env, now: month });
    expect(first).toMatchObject({ reply: "", event: "recorded" });
    const conv = await pool.query<{ needs_human_followup: boolean }>(
      "SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1",
      [c],
    );
    expect(conv.rows[0]!.needs_human_followup).toBe(true);
    const handoff = await pool.query<{ reason: string }>(
      "SELECT reason FROM public.ai_handoff_events WHERE conversation_id = $1 AND reason = $2",
      [c, IA_PAUSED_BY_LIMIT_REASON],
    );
    expect(handoff.rows).toHaveLength(1);
    expect(handoff.rows[0]!.reason).toBe(IA_PAUSED_BY_LIMIT_REASON);
    const acts = await pool.query<{ summary: string; type: string }>(
      "SELECT summary, type FROM public.agenda_activity WHERE conversation_id = $1 AND summary = $2",
      [c, IA_PAUSED_BY_LIMIT_REASON],
    );
    expect(acts.rows).toHaveLength(1);
    expect(acts.rows[0]!.type).toBe("agent_silenced");
    await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 1001, limit: 500 }, { sender, env, now: month });
    expect((await pool.query("SELECT 1 FROM public.ai_handoff_events WHERE conversation_id = $1", [c])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM public.agenda_activity WHERE conversation_id = $1 AND summary = $2", [c, IA_PAUSED_BY_LIMIT_REASON])).rowCount).toBe(1);
    const sb = await mkConv(true);
    await handleHardCapTurn({ barbershopId: shopId, conversationId: sb, used: 1000, limit: 500 }, { sender, env, now: month });
    const sbFlag = await pool.query<{ needs_human_followup: boolean }>("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [sb]);
    expect(sbFlag.rows[0]!.needs_human_followup).toBe(false);
  });

  it("se um efeito falha depois do claim, a transação dá ROLLBACK e o próximo turno pode gravar de novo", async () => {
    const sender = vi.fn(async () => {});
    const month = new Date("2028-02-10T12:00:00Z");
    const c = await mkConv();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missingShop = "00000000-0000-0000-0000-000000000000";
    const failed = await handleHardCapTurn(
      { barbershopId: missingShop, conversationId: c, used: 1000, limit: 500 },
      { sender, env, now: month },
    );
    warn.mockRestore();
    expect(failed).toMatchObject({ reply: "", event: "not_applicable" });
    expect((await pool.query("SELECT 1 FROM public.ai_hard_cap_notices WHERE conversation_id = $1", [c])).rowCount).toBe(0);
    expect(
      (await pool.query<{ needs_human_followup: boolean }>("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [c]))
        .rows[0]!.needs_human_followup,
    ).toBe(false);
    expect((await pool.query("SELECT 1 FROM public.ai_handoff_events WHERE conversation_id = $1", [c])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM public.agenda_activity WHERE conversation_id = $1 AND summary = $2", [c, IA_PAUSED_BY_LIMIT_REASON])).rowCount).toBe(0);

    const retried = await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 1000, limit: 500 }, { sender, env, now: month });
    expect(retried).toMatchObject({ reply: "", event: "recorded" });
    expect((await pool.query("SELECT 1 FROM public.ai_hard_cap_notices WHERE conversation_id = $1", [c])).rowCount).toBe(1);
    expect(
      (await pool.query<{ needs_human_followup: boolean }>("SELECT needs_human_followup FROM public.ai_conversations WHERE id = $1", [c]))
        .rows[0]!.needs_human_followup,
    ).toBe(true);
  });

  it("AI_HARD_CAP_CUSTOMER_MESSAGE, se ainda estiver no ambiente, é ignorada: reply continua vazia", async () => {
    const c = await mkConv();
    const r = await handleHardCapTurn(
      { barbershopId: shopId, conversationId: c, used: 1000, limit: 500 },
      { sender: vi.fn(async () => {}), env: { ...env, AI_HARD_CAP_CUSTOMER_MESSAGE: "Texto aprovado." }, now },
    );
    expect(r.reply).toBe("");
    expect(r.event).toBe("recorded");
  });

  it("o dono recebe o alerta de teto UMA vez no mês (kind hard_cap, chave 200)", async () => {
    const sender = vi.fn(async () => {});
    const month = new Date("2027-07-10T12:00:00Z");
    const c = await mkConv();
    for (let i = 0; i < 4; i++) {
      await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 1000 + i, limit: 500 }, { sender, env, now: month });
    }
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ to: `dono-cap-${stamp}@example.test`, kind: "hard_cap", used: 1000, limit: 500, thresholdPct: USAGE_ALERT_KEY_HARD_CAP }),
    );
    expect((await alertRows()).filter((r) => r.period === "2027-07" && r.threshold_pct === USAGE_ALERT_KEY_HARD_CAP)).toHaveLength(1);
  });

  it("o dono recebe o alerta de 100% UMA vez no mês, separado do de 80%; abaixo de 100% não dispara", async () => {
    const sender = vi.fn(async () => {});
    const month = new Date("2027-08-10T12:00:00Z");
    const params = (used: number) => ({ barbershopId: shopId, used, limit: 500 });
    expect(await maybeAlertAiUsageLimit(params(499), { sender, env, now: month })).toBe("below");
    expect(await maybeAlertAiUsage(params(400), { sender, env, now: month })).toBe("sent"); // 80%
    expect(await maybeAlertAiUsageLimit(params(500), { sender, env, now: month })).toBe("sent");
    expect(await maybeAlertAiUsageLimit(params(501), { sender, env, now: month })).toBe("duplicate");
    resetUsageAlertCacheForTests();
    expect(await maybeAlertAiUsageLimit(params(502), { sender, env, now: month })).toBe("duplicate"); // também pelo banco
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "limit", thresholdPct: USAGE_ALERT_KEY_LIMIT, used: 500 }));
    expect(await maybeAlertAiUsageHardCap(params(999), { sender, env, now: month })).toBe("below");
  });

  it("e-mail ao dono desligado (ausente ou false): não envia, mas o teto ainda é gravado com AI_USAGE_ALERT_ENABLED=true", async () => {
    const sender = vi.fn(async () => {});
    const month = new Date("2027-12-10T12:00:00Z");
    const before = (await noticeRows()).length;
    const c1 = await mkConv();
    const unset = { AI_USAGE_ALERT_ENABLED: "true" };
    const r1 = await handleHardCapTurn({ barbershopId: shopId, conversationId: c1, used: 1000, limit: 500 }, { sender, env: unset, now: month });
    expect(r1).toMatchObject({ reply: "", ownerAlert: "disabled", event: "recorded" });
    const c2 = await mkConv();
    const off = { AI_USAGE_ALERT_ENABLED: "true", AI_USAGE_OWNER_EMAIL_ENABLED: "false" };
    const r2 = await handleHardCapTurn({ barbershopId: shopId, conversationId: c2, used: 1000, limit: 500 }, { sender, env: off, now: month });
    expect(r2).toMatchObject({ reply: "", ownerAlert: "disabled", event: "recorded" });
    expect(await maybeAlertAiUsage({ barbershopId: shopId, used: 400, limit: 500 }, { sender, env: unset, now: month })).toBe("disabled");
    expect(await maybeAlertAiUsageLimit({ barbershopId: shopId, used: 500, limit: 500 }, { sender, env: off, now: month })).toBe("disabled");
    expect(await maybeAlertAiUsageHardCap({ barbershopId: shopId, used: 1000, limit: 500 }, { sender, env: unset, now: month })).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
    expect(await noticeRows()).toHaveLength(before + 2);
    expect((await alertRows()).filter((x) => x.period === "2027-12")).toHaveLength(0);
  });

  it("alertas desligados (AI_USAGE_ALERT_ENABLED=false): nada sai, nem e-mail nem registro, e o cliente permanece em silêncio", async () => {
    const sender = vi.fn(async () => {});
    const off = { AI_USAGE_ALERT_ENABLED: "false" };
    const month = new Date("2027-09-10T12:00:00Z");
    const c = await mkConv();
    const before = (await noticeRows()).length;
    const r = await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 1000, limit: 500 }, { sender, env: off, now: month });
    expect(r).toEqual({ reply: "", ownerAlert: "disabled", event: "disabled" });
    expect(await maybeAlertAiUsageLimit({ barbershopId: shopId, used: 500, limit: 500 }, { sender, env: off, now: month })).toBe("disabled");
    expect(await maybeAlertAiUsageHardCap({ barbershopId: shopId, used: 1000, limit: 500 }, { sender, env: off, now: month })).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
    expect(await noticeRows()).toHaveLength(before);
    expect((await alertRows()).filter((x) => x.period === "2027-09")).toHaveLength(0);
  });

  it("plano sem IA (limite 0) e conversa sandbox ficam em silêncio; falha do e-mail não impede o registro", async () => {
    const sender = vi.fn(async () => {});
    const month = new Date("2027-10-10T12:00:00Z");
    const c = await mkConv();
    expect(await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 5, limit: 0 }, { sender, env, now: month })).toMatchObject({
      reply: "",
      event: "not_applicable",
    });
    const sb = await mkConv(true);
    expect((await handleHardCapTurn({ barbershopId: shopId, conversationId: sb, used: 1000, limit: 500 }, { sender, env, now: month })).reply).toBe("");
    const boom = vi.fn(async () => {
      throw new Error("ses down");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await handleHardCapTurn({ barbershopId: shopId, conversationId: c, used: 1000, limit: 500 }, { sender: boom, env, now: new Date("2027-11-10T12:00:00Z") });
    warn.mockRestore();
    expect(r).toMatchObject({ ownerAlert: "error", event: "recorded", reply: "" });
  });

  it("o worker usa o tratamento do teto nos dois ramos (nativo e n8n) e a resposta do teto é sempre vazia", () => {
    const src = readFileSync(new URL("../workers/ai-worker.ts", import.meta.url), "utf8");
    expect((src.match(/handleHardCapTurn\(/g) ?? []).length).toBe(2);
    expect(src).toContain("maybeAlertAiUsageLimit(");
    expect(src).toContain("reply = cap.reply");
  });
});
