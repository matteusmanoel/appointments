/**
 * Simulador CLI: mesmo runAgent, Postgres local, sem WhatsApp.
 * Falha se o banco (127.0.0.1:55432) não estiver no ar.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "../db.js";
import { CLOSING_TODAY_THEN_TOMORROW } from "../ai/booking-draft.js";
import { parseReplayFile, parseSimpleYaml } from "../ai/simulator/replay-file.js";
import { parseSimulatedNow, runWithSimulatedNow, getSimulatedNow, wallClockFrom } from "../ai/simulator/clock.js";
import {
  isSimulatorTraceEnabled,
  saveSimulatorTurnTrace,
  setSimulatorTraceEnabled,
  type SimulatorTurnTrace,
} from "../ai/simulator/trace.js";
import { runSimulator } from "../ai/simulator/session.js";
import {
  useNoopWhatsAppOutbound,
  resetWhatsAppOutbound,
  listWhatsAppOutboundAttempts,
  isNoopWhatsAppOutbound,
} from "../integrations/whatsapp/noop-outbound.js";
import { getWhatsApp, getWhatsAppOrNull, ensureWhatsAppSession } from "../integrations/whatsapp/index.js";
import { sendBarbershopLocationToClient } from "../lib/send-barbershop-location.js";
import * as evo from "../integrations/whatsapp/evolution-client.js";
import * as uazapi from "../integrations/uazapi/client.js";

const WEEKDAY_NAME_RE = /segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo/i;
const CAVALIER_HOURS = {
  monday: { start: "09:00", end: "20:00" },
  tuesday: { start: "09:00", end: "20:00" },
  wednesday: { start: "09:00", end: "20:00" },
  thursday: { start: "09:00", end: "20:00" },
  friday: { start: "09:00", end: "20:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function ensureTraceTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ai_simulator_turn_traces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
      turn_index integer NOT NULL,
      simulated_now timestamptz,
      user_message text NOT NULL,
      intent jsonb,
      draft jsonb,
      tools jsonb,
      final_reply text,
      ai_exposure jsonb,
      latency_ms integer,
      prompt_tokens integer,
      completion_tokens integer,
      total_tokens integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

type ShopFx = {
  barbershopId: string;
  slug: string;
  conversationIds: string[];
};

async function seedCavalier(): Promise<ShopFx> {
  const slug = `sim-cavalier-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours, latitude, longitude, address)
     VALUES ($1, $2, 'pro', $3, $4::jsonb, -25.5, -54.5, 'Rua Teste 1') RETURNING id`,
    [`Cavalier Sim ${slug}`, "5500000000099", slug, JSON.stringify(CAVALIER_HOURS)],
  );
  const barbershopId = shop.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
     ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true, timezone = 'America/Sao_Paulo'`,
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
  return { barbershopId, slug, conversationIds: [] };
}

async function wipe(fx: ShopFx) {
  await pool.query(`DELETE FROM public.ai_simulator_turn_traces WHERE barbershop_id = $1`, [fx.barbershopId]);
  const convs = await pool.query<{ id: string }>(`SELECT id FROM public.ai_conversations WHERE barbershop_id = $1`, [
    fx.barbershopId,
  ]);
  for (const row of convs.rows) {
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [row.id]);
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [row.id]);
  }
  await pool.query(`DELETE FROM public.ai_conversations WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [fx.barbershopId]);
}

describe("simulador — parser e relógio", () => {
  it("lê JSON e YAML de replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-replay-"));
    const jsonPath = join(dir, "c.json");
    const yamlPath = join(dir, "c.yaml");
    writeFileSync(
      jsonPath,
      JSON.stringify({
        now: "2026-11-14T18:08:00-03:00",
        turns: [{ role: "user", text: "Pode ser o próximo" }],
      }),
    );
    writeFileSync(
      yamlPath,
      ["now: 2026-11-14T18:08:00-03:00", "turns:", "  - user: Pode ser o próximo", ""].join("\n"),
    );
    const fromJson = parseReplayFile(jsonPath);
    const fromYaml = parseReplayFile(yamlPath);
    expect(fromJson.now).toBe("2026-11-14T18:08:00-03:00");
    expect(fromJson.turns[0]?.text).toBe("Pode ser o próximo");
    expect(fromYaml.now).toBe("2026-11-14T18:08:00-03:00");
    expect(fromYaml.turns[0]?.text).toBe("Pode ser o próximo");
    expect((parseSimpleYaml("turns:\n  - user: oi") as { turns: Array<{ text: string }> }).turns[0].text).toBe("oi");
  });

  it("interpreta --now sem fuso como America/Sao_Paulo", () => {
    const d = parseSimulatedNow("2026-11-14 18:08");
    expect(d).toBeTruthy();
    const wall = wallClockFrom(d!, "America/Sao_Paulo");
    expect(wall.todayStr).toBe("2026-11-14");
    expect(wall.nowMins).toBe(18 * 60 + 8);
    expect(getSimulatedNow()).toBeUndefined();
    runWithSimulatedNow("2026-11-14T18:08:00-03:00", () => {
      expect(getSimulatedNow()?.toISOString()).toBe(d!.toISOString());
    });
    expect(getSimulatedNow()).toBeUndefined();
  });
});

describe("simulador — noop WhatsApp e Postgres", () => {
  let fx: ShopFx;

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    await ensureTraceTable();
    fx = await seedCavalier();
  });

  afterEach(() => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
  });

  afterAll(async () => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
    if (fx) await wipe(fx);
  });

  it("o provider noop registra o envio e não chama Evolution nem Uazapi", async () => {
    const evoText = vi.spyOn(evo, "sendText").mockImplementation(async () => {
      throw new Error("Evolution não deveria ser chamada");
    });
    const evoLoc = vi.spyOn(evo, "sendLocation").mockImplementation(async () => {
      throw new Error("Evolution não deveria ser chamada");
    });
    const uazPing = vi.spyOn(uazapi, "pingUazapi").mockImplementation(async () => {
      throw new Error("Uazapi não deveria ser chamada");
    });
    try {
      useNoopWhatsAppOutbound();
      expect(isNoopWhatsAppOutbound()).toBe(true);
      const session = await getWhatsApp("00000000-0000-0000-0000-000000000000");
      const orNull = await getWhatsAppOrNull(fx.barbershopId);
      const ensured = await ensureWhatsAppSession(fx.barbershopId);
      await session.sendText("5500000000001", "oi do simulador");
      await orNull?.sendLocation("5500000000001", {
        lat: -25,
        lng: -54,
        name: "Loja",
        address: "Rua",
      });
      await ensured.sendSticker?.("5500000000001", "https://example.invalid/sticker.webp");
      const sent = await sendBarbershopLocationToClient(fx.barbershopId, "5500000000001");
      expect("ok" in sent).toBe(true);
      const methods = listWhatsAppOutboundAttempts().map((a) => a.method);
      expect(methods).toContain("sendText");
      expect(methods).toContain("sendLocation");
      expect(methods).toContain("sendSticker");
      expect(evoText).not.toHaveBeenCalled();
      expect(evoLoc).not.toHaveBeenCalled();
      expect(uazPing).not.toHaveBeenCalled();
    } finally {
      evoText.mockRestore();
      evoLoc.mockRestore();
      uazPing.mockRestore();
    }
  });

  it("não grava trace quando a flag está desligada", async () => {
    setSimulatorTraceEnabled(false);
    expect(isSimulatorTraceEnabled()).toBe(false);
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', '5500000000002', true) RETURNING id`,
      [fx.barbershopId],
    );
    const id = await saveSimulatorTurnTrace({
      barbershopId: fx.barbershopId,
      conversationId: conv.rows[0]!.id,
      turnIndex: 1,
      userMessage: "oi",
      intent: null,
      draft: null,
      tools: [],
      finalReply: "olá",
      aiExposure: null,
      latencyMs: 1,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(id).toBeNull();
  });

  it("reproduz «Pode ser o próximo» no sábado às 18:08 com fala de encerramento e 2–3 horários, grava trace e não envia WhatsApp", async () => {
    const evoText = vi.spyOn(evo, "sendText").mockImplementation(async () => {
      throw new Error("Evolution não deveria ser chamada");
    });
    try {
      const logs: string[] = [];
      const result = await runSimulator({
        tenant: fx.slug,
        phone: "5500000000001",
        now: "2026-11-14T18:08:00-03:00",
        turns: [
          { role: "user", text: "Quero agendar um corte pra hoje" },
          { role: "user", text: "Só o corte mesmo" },
          { role: "user", text: "Pode ser o próximo" },
        ],
        llm: "none",
        trace: true,
        print: (line) => logs.push(line),
      });
      expect(result.phoneMasked).toBe("***0001");
      expect(result.turns).toHaveLength(3);
      const offer = result.turns.find((t) => t.reply.includes(CLOSING_TODAY_THEN_TOMORROW));
      expect(offer, "algum turno deve oferecer horários com a fala de encerramento").toBeTruthy();
      expect(offer!.reply).toMatch(/às\s+\d{1,2}h/);
      expect(offer!.reply).not.toMatch(WEEKDAY_NAME_RE);
      expect(offer!.reply).not.toMatch(/Qual hora você prefere/);
      expect(offer!.trace.tools.some((t) => t.name === "get_next_slots" && t.ok && t.args)).toBe(true);
      expect(result.turns[2]!.reply.trim().length).toBeGreaterThan(0);
      expect(result.turns[2]!.reply).not.toMatch(/Qual hora você prefere/);
      expect(result.turns.every((t) => t.trace.latencyMs >= 0)).toBe(true);
      expect(logs.join("\n")).toContain("WhatsApp: noop");
      expect(logs.join("\n")).toContain(CLOSING_TODAY_THEN_TOMORROW);

      const rows = await pool.query<{ user_message: string; final_reply: string }>(
        `SELECT user_message, final_reply FROM public.ai_simulator_turn_traces
         WHERE conversation_id = $1 ORDER BY turn_index`,
        [result.conversationId],
      );
      expect(rows.rows).toHaveLength(3);
      expect(rows.rows[2]?.user_message).toBe("Pode ser o próximo");
      expect(rows.rows.some((r) => (r.final_reply ?? "").includes(CLOSING_TODAY_THEN_TOMORROW))).toBe(true);
      expect(evoText).not.toHaveBeenCalled();
    } finally {
      evoText.mockRestore();
    }
  });
});
