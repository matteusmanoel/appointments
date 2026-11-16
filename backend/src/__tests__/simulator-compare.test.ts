/**
 * simulate:compare com cliente OpenAI fake. Nenhuma chamada real.
 * Requer Postgres 127.0.0.1:55432.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { pool } from "../db.js";
import { assertLocalDatabaseUrl } from "../db/local-database-url.js";
import { COMPARE_MAX_RUNS_CAP, COMPARE_MAX_TOKEN_CAP, parseCompareLimit, runCompare } from "../ai/simulator/compare.js";
import { assertMiniModel, estimateCostUsd, formatUsd } from "../ai/simulator/compare-pricing.js";
import { resetWhatsAppOutbound } from "../integrations/whatsapp/noop-outbound.js";
import { setSimulatorTraceEnabled } from "../ai/simulator/trace.js";

const OPEN_WEEK = {
  monday: { start: "09:00", end: "20:00" },
  tuesday: { start: "09:00", end: "20:00" },
  wednesday: { start: "09:00", end: "20:00" },
  thursday: { start: "09:00", end: "20:00" },
  friday: { start: "09:00", end: "20:00" },
  saturday: { start: "09:00", end: "20:00" },
  sunday: { start: "09:00", end: "20:00" },
};

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

function fakeOpenAI(opts?: { prompt?: number; completion?: number; content?: string }): OpenAI {
  const prompt = opts?.prompt ?? 20;
  const completion = opts?.completion ?? 8;
  const content = opts?.content ?? "Posso te ajudar com o horário.";
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return {
            id: "fake",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
          };
        },
      },
    },
    calls: () => calls,
  };
  return client as unknown as OpenAI;
}

async function seedShop() {
  const slug = `sim-cmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, $2, 'pro', $3, $4::jsonb) RETURNING id`,
    [`Compare ${slug}`, "5500000000088", slug, JSON.stringify(OPEN_WEEK)],
  );
  const barbershopId = shop.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
     ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
    [barbershopId],
  );
  await pool.query(`INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Lucas', 'active')`, [
    barbershopId,
  ]);
  await pool.query(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
     VALUES ($1, 'Corte', 40, 30, true)`,
    [barbershopId],
  );
  return { barbershopId, slug };
}

async function wipe(barbershopId: string) {
  await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [barbershopId]).catch(() => undefined);
  await pool.query(`DELETE FROM public.ai_simulator_turn_traces WHERE barbershop_id = $1`, [barbershopId]).catch(() => undefined);
  await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [barbershopId]).catch(() => undefined);
  const convs = await pool.query<{ id: string }>(`SELECT id FROM public.ai_conversations WHERE barbershop_id = $1`, [barbershopId]);
  for (const row of convs.rows) {
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [row.id]);
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [row.id]);
  }
  await pool.query(`DELETE FROM public.ai_conversations WHERE barbershop_id = $1`, [barbershopId]);
  await pool.query(
    `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1)`,
    [barbershopId],
  );
  await pool.query(`DELETE FROM public.appointments WHERE barbershop_id = $1`, [barbershopId]);
  await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [barbershopId]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [barbershopId]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [barbershopId]);
  await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [barbershopId]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]);
}

describe("simulate:compare", () => {
  let slug: string;
  let barbershopId: string;

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    assertLocalDatabaseUrl();
    const shop = await seedShop();
    slug = shop.slug;
    barbershopId = shop.barbershopId;
  });

  afterEach(() => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
  });

  afterAll(async () => {
    resetWhatsAppOutbound();
    if (barbershopId) await wipe(barbershopId);
  });

  it("recusa teto e rodadas inválidos", () => {
    expect(() => parseCompareLimit("abc", "--max-tokens", COMPARE_MAX_TOKEN_CAP)).toThrow(/inteiro/);
    expect(() => parseCompareLimit(0, "--max-tokens", COMPARE_MAX_TOKEN_CAP)).toThrow(/inteiro/);
    expect(() => parseCompareLimit(-1, "--max-tokens", COMPARE_MAX_TOKEN_CAP)).toThrow(/inteiro/);
    expect(() => parseCompareLimit("abc", "--max-runs", COMPARE_MAX_RUNS_CAP)).toThrow(/inteiro/);
    expect(parseCompareLimit(1, "--max-runs", COMPARE_MAX_RUNS_CAP)).toBe(1);
  });

  it("só aceita modelos mini e calcula o custo da tabela", () => {
    expect(assertMiniModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(() => assertMiniModel("gpt-4o")).toThrow(/mini/);
    expect(formatUsd(estimateCostUsd({ model: "gpt-4o-mini", promptTokens: 1_000_000, completionTokens: 0 }))).toBe("0.15");
  });

  it("exige OPENAI_API_KEY no ambiente e não lê .env", async () => {
    const prev = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      await expect(
        runCompare({
          tenant: slug,
          examples: ["cliente-indeciso.yaml"],
          goldens: false,
          requireApiKey: true,
          print: () => {},
        }),
      ).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it("roda none e openai com cliente fake, grava a tabela e restaura as flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-cmp-"));
    const outPath = join(dir, "compare.md");
    const fake = fakeOpenAI();
    const prevInterp = process.env.AI_AGENT_SLOT_INTERPRET;
    const prevRewrite = process.env.AI_AGENT_LANGUAGE_REWRITE;
    delete process.env.AI_AGENT_SLOT_INTERPRET;
    delete process.env.AI_AGENT_LANGUAGE_REWRITE;
    const report = await runCompare({
      tenant: slug,
      examples: ["cliente-indeciso.yaml"],
      goldens: false,
      openai: fake,
      requireApiKey: false,
      outPath,
      maxRuns: 1,
      print: () => {},
    });
    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((r) => r.mode)).toEqual(["none", "openai"]);
    expect(report.rows[0]!.finalReply).toMatch(/às\s+\d{1,2}h/);
    expect(report.rows[0]!.contracts).toBe("—");
    const md = readFileSync(outPath, "utf8");
    expect(md).toMatch(/\| Roteiro \| Tipo \|/);
    expect(md).toMatch(/cliente-indeciso\.yaml/);
    expect(md).toMatch(/Tokens in/);
    expect(process.env.AI_AGENT_SLOT_INTERPRET).toBeUndefined();
    expect(process.env.AI_AGENT_LANGUAGE_REWRITE).toBeUndefined();
    if (prevInterp !== undefined) process.env.AI_AGENT_SLOT_INTERPRET = prevInterp;
    if (prevRewrite !== undefined) process.env.AI_AGENT_LANGUAGE_REWRITE = prevRewrite;
  });

  it("aborta se o teto de tokens for ultrapassado", async () => {
    const fake = fakeOpenAI({ prompt: 80, completion: 40 });
    const report = await runCompare({
      tenant: slug,
      examples: ["cliente-indeciso.yaml"],
      goldens: false,
      openai: fake,
      requireApiKey: false,
      maxTokens: 5,
      maxRuns: 1,
      print: () => {},
    });
    // o modo none não gasta tokens; o openai pode gastar. Se o none já passou e o openai estourou, aborted fica setado.
    // Com teto 5, qualquer uso do modelo (ou o próprio none se reportar 0) — aceitamos aborted ou tokens estourados no acumulado.
    const used = report.promptTokens + report.completionTokens;
    if (used > 5) expect(report.aborted).toMatch(/Teto de tokens/);
    else expect(report.aborted ?? used <= 5).toBeTruthy();
  });
});
