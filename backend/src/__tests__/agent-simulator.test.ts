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
import { assertLocalDatabaseUrl, isLocalDatabaseUrl } from "../db/local-database-url.js";
import { SIMULATOR_CHANNEL, simulatorClientPhone, simulatorThreadId } from "../ai/simulator/namespace.js";
import {
  maskSimulatorTraceValue,
  purgeExpiredSimulatorTurnTraces,
} from "../ai/simulator/trace.js";
import { sendPixPlanCharge } from "../ai/tools.js";
import { scheduleClientPhotoSync } from "../clients/sync-contact-photo.js";
import { recordAgendaChangeFromAppointment } from "../agenda/record-agenda-change.js";
import { scheduleReminderForAppointment } from "../outbound/scheduled-messages.js";
import { getUsageAndLimit } from "../ai/usage-limits.js";

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
      barbershop_id uuid NOT NULL,
      conversation_id uuid NOT NULL,
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
  await pool.query(`ALTER TABLE public.ai_simulator_turn_traces DROP CONSTRAINT IF EXISTS ai_simulator_turn_traces_barbershop_id_fkey`);
  await pool.query(`ALTER TABLE public.ai_simulator_turn_traces DROP CONSTRAINT IF EXISTS ai_simulator_turn_traces_conversation_id_fkey`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ai_simulator_turn_traces_created_at_idx ON public.ai_simulator_turn_traces (created_at)`);
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
    expect(fromJson.turns[0]?.role).toBe("user");
    expect(fromJson.turns[0] && fromJson.turns[0].role !== "system" ? fromJson.turns[0].text : undefined).toBe("Pode ser o próximo");
    expect(fromYaml.now).toBe("2026-11-14T18:08:00-03:00");
    expect(fromYaml.turns[0]?.role).toBe("user");
    expect(fromYaml.turns[0] && fromYaml.turns[0].role !== "system" ? fromYaml.turns[0].text : undefined).toBe("Pode ser o próximo");
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

describe("simulador — isolamento, noop e relógio", () => {
  const shops: string[] = [];

  afterEach(() => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
  });

  afterAll(async () => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
    for (const id of shops) {
      await pool.query(`DELETE FROM public.ai_simulator_turn_traces WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      await pool.query(`DELETE FROM public.plan_pix_charges WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      await pool.query(`DELETE FROM public.client_plan_subscriptions WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      await pool.query(`DELETE FROM public.barbershop_plans WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      await pool.query(`DELETE FROM public.appointment_waitlist WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [id]).catch(() => undefined);
      const convs = await pool.query<{ id: string }>(`SELECT id FROM public.ai_conversations WHERE barbershop_id = $1`, [id]);
      for (const row of convs.rows) {
        await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [row.id]);
        await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [row.id]);
      }
      await pool.query(`DELETE FROM public.ai_conversations WHERE barbershop_id = $1`, [id]);
      await pool.query(
        `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1)`,
        [id],
      );
      await pool.query(`DELETE FROM public.appointments WHERE barbershop_id = $1`, [id]);
      await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [id]);
      await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [id]);
      await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [id]);
      await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [id]);
      await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [id]);
    }
  });

  async function seedShop(suffix: string) {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    await ensureTraceTable();
    const slug = `sim-iso-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours, pix_key, pix_holder_name)
       VALUES ($1, $2, 'pro', $3, $4::jsonb, 'chavepix-teste', 'Loja') RETURNING id`,
      [`Iso ${slug}`, "5500000000098", slug, JSON.stringify(CAVALIER_HOURS)],
    );
    const barbershopId = shop.rows[0]!.id;
    shops.push(barbershopId);
    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
       VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
       ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
      [barbershopId],
    );
    const barber = await pool.query<{ id: string }>(
      `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Lucas', 'active') RETURNING id`,
      [barbershopId],
    );
    const service = await pool.query<{ id: string }>(
      `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
       VALUES ($1, 'Corte', 40, 30, true) RETURNING id`,
      [barbershopId],
    );
    return { barbershopId, slug, barberId: barber.rows[0]!.id, serviceId: service.rows[0]!.id };
  }

  it("o now do replay é usado quando --now não vem, e o horário sem fuso é America/Sao_Paulo", async () => {
    const shop = await seedShop("clock");
    const dir = mkdtempSync(join(tmpdir(), "sim-now-"));
    const path = join(dir, "replay.json");
    writeFileSync(
      path,
      JSON.stringify({
        now: "2026-11-14 18:08",
        turns: [{ role: "user", text: "Quero agendar só o corte pra hoje" }],
      }),
    );
    const result = await runSimulator({
      tenant: shop.slug,
      replayPath: path,
      llm: "none",
      print: () => {},
    });
    expect(result.simulatedNow).toBe("2026-11-14 18:08");
    const parsed = parseSimulatedNow("2026-11-14 18:08")!;
    const wall = wallClockFrom(parsed, "America/Sao_Paulo");
    expect(wall.todayStr).toBe("2026-11-14");
    expect(wall.nowMins).toBe(18 * 60 + 8);
    expect(result.turns[0]!.reply).toMatch(/Já estamos encerrando|às\s+\d{1,2}h/);
  });

  it("não reaproveita conversa nem cliente real e não altera a contagem de uso", async () => {
    const shop = await seedShop("ns");
    const realPhone = "5511988776655";
    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed)
       VALUES ($1, 'Maria Real', $2, true) RETURNING id`,
      [shop.barbershopId, realPhone],
    );
    const realConv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', $2, false) RETURNING id`,
      [shop.barbershopId, realPhone],
    );
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', 'horário confirmado')`,
      [realConv.rows[0]!.id],
    );
    const usageBefore = await getUsageAndLimit(shop.barbershopId);
    const result = await runSimulator({
      tenant: shop.slug,
      phone: realPhone,
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Oi, quero só o corte amanhã" }],
      llm: "none",
      print: () => {},
    });
    expect(result.conversationId).not.toBe(realConv.rows[0]!.id);
    const conv = await pool.query<{ channel: string; external_thread_id: string; is_sandbox: boolean }>(
      `SELECT channel, external_thread_id, is_sandbox FROM public.ai_conversations WHERE id = $1`,
      [result.conversationId],
    );
    expect(conv.rows[0]).toEqual({
      channel: SIMULATOR_CHANNEL,
      external_thread_id: simulatorThreadId(realPhone),
      is_sandbox: true,
    });
    const real = await pool.query<{ is_sandbox: boolean; n: string }>(
      `SELECT c.is_sandbox, (SELECT count(*)::text FROM public.ai_messages m WHERE m.conversation_id = c.id) AS n
       FROM public.ai_conversations c WHERE id = $1`,
      [realConv.rows[0]!.id],
    );
    expect(real.rows[0]?.is_sandbox).toBe(false);
    expect(real.rows[0]?.n).toBe("1");
    const still = await pool.query<{ name: string }>(`SELECT name FROM public.clients WHERE id = $1`, [
      client.rows[0]!.id,
    ]);
    expect(still.rows[0]?.name).toBe("Maria Real");
    const usageAfter = await getUsageAndLimit(shop.barbershopId);
    expect(usageAfter.used).toBe(usageBefore.used);
    const sandboxPhone = simulatorClientPhone(shop.barbershopId, realPhone);
    expect(sandboxPhone).not.toBe(realPhone.replace(/\D/g, ""));
    const aliased = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.clients WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
      [shop.barbershopId, realPhone],
    );
    expect(aliased.rows[0]?.n).toBe("1");
  });

  it("no modo simulador não envia foto, não consome waitlist, não marca PIX como sent e não enfileira scheduled_messages", async () => {
    const shop = await seedShop("noop");
    useNoopWhatsAppOutbound();

    const photo = vi.spyOn(evo, "fetchProfilePictureUrl").mockImplementation(async () => {
      throw new Error("Evolution foto não deveria ser chamada");
    });
    try {
      scheduleClientPhotoSync(shop.barbershopId, "5500000000777");
      await new Promise((r) => setTimeout(r, 30));
      expect(photo).not.toHaveBeenCalled();
    } finally {
      photo.mockRestore();
    }

    const holder = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed)
       VALUES ($1, 'Fila', '5500000000333', true) RETURNING id`,
      [shop.barbershopId],
    );
    const appt = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments
         (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       VALUES ($1, $2, $3, $4, '2026-11-17', '15:00', 30, 40, 16, 'cancelled') RETURNING id`,
      [shop.barbershopId, holder.rows[0]!.id, shop.barberId, shop.serviceId],
    );
    const wait = await pool.query<{ id: string }>(
      `INSERT INTO public.appointment_waitlist
         (barbershop_id, client_phone, client_name, desired_date, desired_time, service_id, barber_id, status)
       VALUES ($1, '5500000000444', 'Espera', '2026-11-17', '15:00', $2, $3, 'active') RETURNING id`,
      [shop.barbershopId, shop.serviceId, shop.barberId],
    );
    const claimed = await recordAgendaChangeFromAppointment({
      barbershopId: shop.barbershopId,
      appointmentId: appt.rows[0]!.id,
      type: "cancelled",
      actor: "system",
    });
    expect(claimed.waitlistCandidate).toBeNull();
    const waitStatus = await pool.query<{ status: string }>(
      `SELECT status FROM public.appointment_waitlist WHERE id = $1`,
      [wait.rows[0]!.id],
    );
    expect(waitStatus.rows[0]?.status).toBe("active");

    const plan = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_plans (barbershop_id, name, price, billing_cycle, is_active)
       VALUES ($1, 'Plano teste', 80, 'monthly', true) RETURNING id`,
      [shop.barbershopId],
    );
    const sub = await pool.query<{ id: string }>(
      `INSERT INTO public.client_plan_subscriptions
         (barbershop_id, client_id, plan_id, status, billing_day, next_billing_date)
       VALUES ($1, $2, $3, 'active', 1, '2026-12-01') RETURNING id`,
      [shop.barbershopId, holder.rows[0]!.id, plan.rows[0]!.id],
    );
    const charge = await pool.query<{ id: string }>(
      `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, status, due_date)
       VALUES ($1, $2, 80, 'pending', '2026-11-20') RETURNING id`,
      [sub.rows[0]!.id, shop.barbershopId],
    );
    const pix = await sendPixPlanCharge(shop.barbershopId, {
      subscription_id: sub.rows[0]!.id,
      client_phone: "5500000000333",
    });
    expect((pix as { skipped_send?: boolean }).skipped_send).toBe(true);
    const chargeRow = await pool.query<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at::text FROM public.plan_pix_charges WHERE id = $1`,
      [charge.rows[0]!.id],
    );
    expect(chargeRow.rows[0]?.status).toBe("pending");
    expect(chargeRow.rows[0]?.sent_at).toBeNull();
    expect(listWhatsAppOutboundAttempts().some((a) => a.method === "sendPixRequest" || a.method === "sendText")).toBe(
      false,
    );

    const beforeJobs = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.scheduled_messages WHERE barbershop_id = $1`,
      [shop.barbershopId],
    );
    await scheduleReminderForAppointment({
      barbershopId: shop.barbershopId,
      appointmentId: appt.rows[0]!.id,
      publicToken: "tok",
      clientPhone: "5500000000333",
      clientName: "Fila",
      barberName: "Lucas",
      serviceNames: ["Corte"],
      scheduledDate: "2026-11-17",
      scheduledTime: "15:00",
      slug: shop.slug,
      timezone: "America/Sao_Paulo",
    });
    const afterJobs = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.scheduled_messages WHERE barbershop_id = $1`,
      [shop.barbershopId],
    );
    expect(afterJobs.rows[0]?.n).toBe(beforeJobs.rows[0]?.n);
  });

  it("o CLI não grava trace por padrão, mascara telefone e respeita o TTL", async () => {
    const shop = await seedShop("trace");
    const result = await runSimulator({
      tenant: shop.slug,
      phone: "5511999887766",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã" }],
      llm: "none",
      print: () => {},
    });
    const none = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.ai_simulator_turn_traces WHERE conversation_id = $1`,
      [result.conversationId],
    );
    expect(none.rows[0]?.n).toBe("0");

    setSimulatorTraceEnabled(true);
    const id = await saveSimulatorTurnTrace({
      barbershopId: shop.barbershopId,
      conversationId: result.conversationId,
      turnIndex: 1,
      userMessage: "Meu WhatsApp é 5511999887766",
      intent: { phone: "5511999887766" },
      draft: { barber_name: "Lucas" },
      tools: [{ name: "check_availability", ok: true, args: { client_phone: "5511999887766" } }],
      finalReply: "Te chamo no 5511999887766",
      aiExposure: null,
      latencyMs: 1,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(id).toBeTruthy();
    const stored = await pool.query<{ user_message: string; final_reply: string; intent: unknown; tools: unknown }>(
      `SELECT user_message, final_reply, intent, tools FROM public.ai_simulator_turn_traces WHERE id = $1`,
      [id],
    );
    expect(stored.rows[0]?.user_message).not.toMatch(/5511999887766/);
    expect(stored.rows[0]?.user_message).toMatch(/\*\*\*/);
    expect(JSON.stringify(stored.rows[0]?.intent)).not.toMatch(/5511999887766/);
    expect(JSON.stringify(maskSimulatorTraceValue({ phone: "5511999887766" }))).not.toMatch(/5511999887766/);

    await pool.query(
      `UPDATE public.ai_simulator_turn_traces SET created_at = now() - interval '10 days' WHERE id = $1`,
      [id],
    );
    const purged = await purgeExpiredSimulatorTurnTraces(7);
    expect(purged).toBeGreaterThanOrEqual(1);
    const leftover = await pool.query(`SELECT 1 FROM public.ai_simulator_turn_traces WHERE id = $1`, [id]);
    expect(leftover.rows).toHaveLength(0);
  });

  it("a guarda recusa URL remota também quando o CLI seria iniciado", () => {
    expect(isLocalDatabaseUrl(process.env.DATABASE_URL ?? "")).toBe(true);
    expect(() => assertLocalDatabaseUrl("postgres://u:segredo@db.neon.tech/app")).toThrow(
      /o host não é local/,
    );
  });
});
