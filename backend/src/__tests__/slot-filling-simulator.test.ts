/**
 * Os 4 fluxos básicos (agendar, reagendar, cancelar, lembrar) pelo simulador CLI.
 * Requer Postgres 127.0.0.1:55432.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { runSimulator } from "../ai/simulator/session.js";
import { resetWhatsAppOutbound } from "../integrations/whatsapp/noop-outbound.js";
import { setSimulatorTraceEnabled } from "../ai/simulator/trace.js";
import { buildReminder24h } from "../outbound/templates.js";

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
  tomorrowIso: string;
};

async function seedShop(suffix: string): Promise<ShopFx> {
  const slug = `slot-sim-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dates = await pool.query<{ t: string }>(
    `SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
  );
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, $2, 'pro', $3, $4::jsonb) RETURNING id`,
    [`Slot sim ${slug}`, "5500000000088", slug, JSON.stringify(OPEN_WEEK)],
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
    tomorrowIso: dates.rows[0]!.t,
  };
}

async function insertUpcoming(fx: ShopFx, phone: string): Promise<string> {
  const client = await pool.query<{ id: string }>(
    `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true) RETURNING id`,
    [fx.barbershopId, phone],
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
  return appt.rows[0]!.id;
}

async function seedReminder(fx: ShopFx, conversationId: string, appointmentId: string, phone: string) {
  const text = buildReminder24h({
    clientName: "Mateus",
    date: fx.tomorrowIso,
    time: "18:00",
    todayIso: fx.tomorrowIso, // "amanhã" relative doesn't matter for the RSVP phrase
    serviceNames: "Corte",
    barberName: "Lucas",
    totalPrice: 40,
    alreadyConfirmed: false,
  });
  await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
    conversationId,
    text,
  ]);
  await pool.query(
    `INSERT INTO public.agenda_activity
       (barbershop_id, appointment_id, conversation_id, type, actor, client_name, client_phone, scheduled_date, scheduled_time, summary)
     VALUES ($1, $2, $3, 'reminder_sent', 'system', 'Mateus', $4, $5::date, '18:00', 'reminder 24h')`,
    [fx.barbershopId, appointmentId, conversationId, phone, fx.tomorrowIso],
  );
}

async function wipe(fx: ShopFx) {
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

describe("fluxos básicos pelo simulador", () => {
  const shops: ShopFx[] = [];
  let scheduleFx: ShopFx;
  let cancelFx: ShopFx;
  let remindFx: ShopFx;
  let reschedFx: ShopFx;

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    scheduleFx = await seedShop("schedule");
    cancelFx = await seedShop("cancel");
    remindFx = await seedShop("remind");
    reschedFx = await seedShop("resched");
    shops.push(scheduleFx, cancelFx, remindFx, reschedFx);
  });

  afterEach(() => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
  });

  afterAll(async () => {
    resetWhatsAppOutbound();
    setSimulatorTraceEnabled(false);
    for (const fx of shops) await wipe(fx);
  });

  it("agendar: oferece 2–3 horários quando falta a hora, sem LLM", async () => {
    const result = await runSimulator({
      tenant: scheduleFx.slug,
      phone: "5500000000101",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero agendar só o corte amanhã" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const reply = result.turns[0]!.reply;
    expect(reply).toMatch(/às\s+\d{1,2}h/);
    expect(reply).not.toMatch(/Qual hora você prefere/);
    expect(result.turns[0]!.trace.tools.some((t) => t.name === "get_next_slots" && t.ok)).toBe(true);
    expect(result.turns[0]!.trace.totalTokens).toBe(0);
  });

  it("cancelar: cancela o horário futuro e não oferece vaga", async () => {
    const phone = "5500000000102";
    const appointmentId = await insertUpcoming(cancelFx, phone);
    const result = await runSimulator({
      tenant: cancelFx.slug,
      phone,
      turns: [{ role: "user", text: "Quero cancelar meu horário" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/cancelado/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("cancelled");
  });

  it("lembrar: «confirmo» confirma presença sem chamar o LLM", async () => {
    const phone = "5500000000103";
    const appointmentId = await insertUpcoming(remindFx, phone);
    const boot = await runSimulator({
      tenant: remindFx.slug,
      phone,
      turns: [],
      interactive: false,
      llm: "none",
      trace: false,
      print: () => {},
    }).catch(() => null);
    // Garante a conversa sandbox mesmo sem turnos? runSimulator exige replay ou interactive.
    // Cria a conversa direto:
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', $2, true)
       ON CONFLICT (barbershop_id, channel, external_thread_id) DO UPDATE SET is_sandbox = true
       RETURNING id`,
      [remindFx.barbershopId, phone],
    );
    void boot;
    await seedReminder(remindFx, conv.rows[0]!.id, appointmentId, phone);
    const result = await runSimulator({
      tenant: remindFx.slug,
      phone,
      turns: [{ role: "user", text: "Confirmo" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Presença confirmada/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("confirmed");
  });

  it("lembrar: pedido de remarcação oferece horários e mantém o agendamento", async () => {
    const phone = "5500000000104";
    const appointmentId = await insertUpcoming(reschedFx, phone);
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
       VALUES ($1, 'whatsapp', $2, true)
       ON CONFLICT (barbershop_id, channel, external_thread_id) DO UPDATE SET is_sandbox = true
       RETURNING id`,
      [reschedFx.barbershopId, phone],
    );
    await seedReminder(reschedFx, conv.rows[0]!.id, appointmentId, phone);
    const result = await runSimulator({
      tenant: reschedFx.slug,
      phone,
      turns: [{ role: "user", text: "Preciso remarcar, pode ser o próximo" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.turns[0]!.reply).not.toMatch(/cancelado/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("pending");
  });
});
