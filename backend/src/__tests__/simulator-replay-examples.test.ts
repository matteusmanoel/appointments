/**
 * Valida os roteiros de replay em backend/scripts/examples/.
 * Requer Postgres 127.0.0.1:55432. Só --llm none.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { CLOSING_TODAY_THEN_TOMORROW } from "../ai/booking-draft.js";
import { parseReplayFile } from "../ai/simulator/replay-file.js";
import { ensureSimulatorConversation, runSimulator } from "../ai/simulator/session.js";
import { simulatorClientPhone } from "../ai/simulator/namespace.js";
import { resetWhatsAppOutbound } from "../integrations/whatsapp/noop-outbound.js";
import { setSimulatorTraceEnabled } from "../ai/simulator/trace.js";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/examples");

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

type ShopFx = {
  barbershopId: string;
  slug: string;
  serviceId: string;
  barberId: string;
  todayIso: string;
  tomorrowIso: string;
};

async function seedShop(): Promise<ShopFx> {
  const slug = `sim-ex-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dates = await pool.query<{ today: string; t: string }>(
    `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
  );
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, $2, 'pro', $3, $4::jsonb) RETURNING id`,
    [`Replay examples ${slug}`, "5500000000088", slug, JSON.stringify(OPEN_WEEK)],
  );
  const barbershopId = shop.rows[0]!.id;
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
  return {
    barbershopId,
    slug,
    serviceId: service.rows[0]!.id,
    barberId: barber.rows[0]!.id,
    todayIso: dates.rows[0]!.today,
    tomorrowIso: dates.rows[0]!.t,
  };
}

async function seedNamedClient(fx: ShopFx, displayPhone: string) {
  const sandboxPhone = simulatorClientPhone(fx.barbershopId, displayPhone);
  await ensureSimulatorConversation(fx.barbershopId, displayPhone);
  await pool.query(
    `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = 'Mateus', name_confirmed = true`,
    [fx.barbershopId, sandboxPhone],
  );
  return sandboxPhone;
}

async function seedUpcoming(fx: ShopFx, displayPhone: string) {
  const sandboxPhone = await seedNamedClient(fx, displayPhone);
  const client = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients WHERE barbershop_id = $1 AND phone = $2`,
    [fx.barbershopId, sandboxPhone],
  );
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, '18:00', 30, 40, 10, 'pending') RETURNING id`,
    [fx.barbershopId, client.rows[0]!.id, fx.barberId, fx.serviceId, fx.tomorrowIso],
  );
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 40, 30, 'Corte', 0)`,
    [appt.rows[0]!.id, fx.serviceId],
  );
  return { sandboxPhone, appointmentId: appt.rows[0]!.id };
}

async function wipe(fx: ShopFx) {
  await pool.query(`DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`, [fx.barbershopId]).catch(() => undefined);
  await pool.query(`DELETE FROM public.ai_simulator_turn_traces WHERE barbershop_id = $1`, [fx.barbershopId]).catch(() => undefined);
  await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [fx.barbershopId]).catch(() => undefined);
  const convs = await pool.query<{ id: string }>(`SELECT id FROM public.ai_conversations WHERE barbershop_id = $1`, [
    fx.barbershopId,
  ]);
  for (const row of convs.rows) {
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [row.id]);
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [row.id]);
  }
  await pool.query(`DELETE FROM public.ai_conversations WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(
    `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1)`,
    [fx.barbershopId],
  );
  await pool.query(`DELETE FROM public.appointments WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershop_ai_settings WHERE barbershop_id = $1`, [fx.barbershopId]);
  await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [fx.barbershopId]);
}

describe("roteiros de replay em scripts/examples", () => {
  let fx: ShopFx;

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    fx = await seedShop();
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

  it("os arquivos de exemplo são parseáveis", () => {
    for (const name of [
      "cliente-decidido.yaml",
      "cliente-indeciso.yaml",
      "fora-do-horario.yaml",
      "voce-e-robo.yaml",
      "lembrete-confirmo.yaml",
    ]) {
      const script = parseReplayFile(join(EXAMPLES_DIR, name));
      expect(script.turns.length).toBeGreaterThan(0);
    }
    const reminder = parseReplayFile(join(EXAMPLES_DIR, "lembrete-confirmo.yaml"));
    expect(reminder.turns[0]).toEqual({ role: "system", event: "reminders" });
  });

  it("cliente decidido confirma o horário nomeado", async () => {
    const phone = "5500000000401";
    await seedNamedClient(fx, phone);
    const result = await runSimulator({
      tenant: fx.slug,
      phone,
      now: `${fx.todayIso}T10:00:00-03:00`,
      replayPath: join(EXAMPLES_DIR, "cliente-decidido.yaml"),
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Posso confirmar\?/);
    expect(result.turns[0]!.trace.totalTokens).toBe(0);
    const created = result.turns[1]!.trace.tools.some((t) => t.name === "create_appointment" && t.ok);
    expect(created || /agendad|confirmad|marcado/i.test(result.turns[1]!.reply)).toBe(true);
  });

  it("cliente indeciso recebe 2–3 horários", async () => {
    const phone = "5500000000402";
    const result = await runSimulator({
      tenant: fx.slug,
      phone,
      now: `${fx.todayIso}T10:00:00-03:00`,
      replayPath: join(EXAMPLES_DIR, "cliente-indeciso.yaml"),
      llm: "none",
      trace: false,
      print: () => {},
    });
    const reply = result.turns[0]!.reply;
    const clocks = [...reply.matchAll(/às\s+\d{1,2}h/gi)];
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    expect(clocks.length).toBeLessThanOrEqual(3);
    expect(result.turns[0]!.trace.tools.some((t) => t.name === "get_next_slots" && t.ok)).toBe(true);
    expect(result.turns[0]!.trace.totalTokens).toBe(0);
  });

  it("fora do horário usa a fala combinada com «amanhã»", async () => {
    const phone = "5500000000403";
    const result = await runSimulator({
      tenant: fx.slug,
      phone,
      now: `${fx.todayIso}T19:50:00-03:00`,
      replayPath: join(EXAMPLES_DIR, "fora-do-horario.yaml"),
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toContain(CLOSING_TODAY_THEN_TOMORROW);
    expect(result.turns[0]!.reply).toMatch(/amanhã/);
    expect(result.turns[0]!.reply).not.toMatch(/segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo/i);
    expect(result.turns[0]!.trace.totalTokens).toBe(0);
  });

  it("«você é robô?» desvia e segue o card, sem revelar IA", async () => {
    const phone = "5500000000404";
    await seedNamedClient(fx, phone);
    const result = await runSimulator({
      tenant: fx.slug,
      phone,
      now: `${fx.todayIso}T10:00:00-03:00`,
      replayPath: join(EXAMPLES_DIR, "voce-e-robo.yaml"),
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Posso confirmar\?/);
    const reply = result.turns[1]!.reply;
    expect(reply).toMatch(/Estou aqui pra te ajudar com o horário\./);
    expect(reply).toMatch(/Posso confirmar\?/);
    expect(reply).not.toMatch(/sou (um )?robô|inteligência artificial|sou (uma )?ia|secretária virtual|no-show/i);
    expect(result.turns[1]!.trace.totalTokens).toBe(0);
  });

  it("lembrete-confirmo roda o job noop e confirma presença", async () => {
    const phone = "5500000000405";
    const { appointmentId } = await seedUpcoming(fx, phone);
    const queued = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.scheduled_messages WHERE barbershop_id = $1`,
      [fx.barbershopId],
    );
    const result = await runSimulator({
      tenant: fx.slug,
      phone,
      now: `${fx.todayIso}T18:00:00-03:00`,
      replayPath: join(EXAMPLES_DIR, "lembrete-confirmo.yaml"),
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Você confirma sua presença ou prefere reagendar/i);
    expect(result.turns[1]!.reply).toMatch(/Presença confirmada/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("confirmed");
    const queuedAfter = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.scheduled_messages WHERE barbershop_id = $1`,
      [fx.barbershopId],
    );
    expect(queuedAfter.rows[0]?.n).toBe(queued.rows[0]?.n);
  });
});
