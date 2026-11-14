/**
 * Os 4 fluxos básicos (agendar, reagendar, cancelar, lembrar) pelo simulador CLI.
 * Requer Postgres 127.0.0.1:55432.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { runSimulator } from "../ai/simulator/session.js";
import { createFakeSlotInterpreter } from "../ai/agent/slot-interpreter.js";
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
  let extraFx: ShopFx;

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    scheduleFx = await seedShop("schedule");
    cancelFx = await seedShop("cancel");
    remindFx = await seedShop("remind");
    reschedFx = await seedShop("resched");
    extraFx = await seedShop("extra");
    await pool.query(
      `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Eduardo', 'active')`,
      [extraFx.barbershopId],
    );
    shops.push(scheduleFx, cancelFx, remindFx, reschedFx, extraFx);
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

  it("intérprete fake preenche slots quando as regras não extraem, sem loop de tools", async () => {
    const fake = createFakeSlotInterpreter((input) => ({
      intent: "schedule",
      service: "Corte",
      barber: "any",
      date: "2026-11-17",
      time: "14:00",
    }));
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000111",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Fecha o visual do combinado na folha quatorze" }],
      llm: "none",
      slotInterpreter: fake,
      trace: false,
      print: () => {},
    });
    const turn = result.turns[0]!;
    expect(turn.reply).toMatch(/Posso confirmar\?/);
    expect(turn.reply).toMatch(/14h|14:00|às 14/);
    expect(turn.trace.tools.some((t) => t.name === "check_availability" && t.ok)).toBe(true);
    expect(turn.trace.tools.every((t) => t.name !== "create_appointment")).toBe(true);
    expect(turn.trace.totalTokens).toBe(0);
  });

  it("horário nomeado sem barbeiro entra em check_availability determinístico", async () => {
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000112",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã às 15h" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const turn = result.turns[0]!;
    expect(turn.reply).toMatch(/Posso confirmar\?/);
    expect(turn.trace.tools.some((t) => t.name === "check_availability" && t.ok)).toBe(true);
    expect(turn.trace.totalTokens).toBe(0);
  });

  it("horário ocupado oferece 2–3 alternativas, sem loop de LLM", async () => {
    const barbers = await pool.query<{ id: string }>(
      `SELECT id FROM public.barbers WHERE barbershop_id = $1`,
      [extraFx.barbershopId],
    );
    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Ocupado', '5500000000113', true) RETURNING id`,
      [extraFx.barbershopId],
    );
    for (const row of barbers.rows) {
      const appt = await pool.query<{ id: string }>(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, $5::date, '15:00', 30, 40, 16, 'pending') RETURNING id`,
        [extraFx.barbershopId, client.rows[0]!.id, row.id, extraFx.serviceId, "2026-11-17"],
      );
      await pool.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, 40, 30, 'Corte', 0)`,
        [appt.rows[0]!.id, extraFx.serviceId],
      );
    }
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000114",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã às 15h" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const turn = result.turns[0]!;
    expect(turn.trace.totalTokens).toBe(0);
    expect(turn.trace.tools.some((t) => t.name === "check_availability" && t.ok)).toBe(true);
    const clocks = [...turn.reply.matchAll(/às\s+(\d{1,2})h(?:(\d{2}))?/gi)].map((m) => {
      const h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      return h * 60 + min;
    });
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    expect(clocks.every((mins) => mins !== 15 * 60)).toBe(true);
    expect(turn.reply).not.toMatch(/Posso confirmar\?/);
  });

  it("«depois do almoço» oferece horários a partir das 13h", async () => {
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000115",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã depois do almoço" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const turn = result.turns[0]!;
    expect(turn.trace.totalTokens).toBe(0);
    expect(turn.trace.tools.some((t) => t.name === "get_next_slots" && t.ok)).toBe(true);
    const args = turn.trace.tools.find((t) => t.name === "get_next_slots")?.args as { after_time?: string } | undefined;
    expect(args?.after_time).toBe("13:00");
    const clocks = [...turn.reply.matchAll(/às\s+(\d{1,2})h(?:(\d{2}))?/gi)].map((m) => {
      const h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      return h * 60 + min;
    });
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    expect(clocks.every((mins) => mins >= 13 * 60)).toBe(true);
  });

  it("«mais cedo» trava o primeiro horário oferecido", async () => {
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000116",
      now: "2026-11-16T10:00:00-03:00",
      turns: [
        { role: "user", text: "Quero um corte amanhã" },
        { role: "user", text: "mais cedo" },
      ],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Qual prefere\?/);
    expect(result.turns[1]!.reply).toMatch(/Posso confirmar\?/);
    expect(result.turns[1]!.trace.totalTokens).toBe(0);
    expect((result.turns[1]!.trace.draft as { time?: string | null } | null)?.time).toBeTruthy();
  });

  it("«você é robô?» no meio do agendamento desvia e segue com o card", async () => {
    const phone = "5500000000117";
    await pool.query(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true)
       ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = 'Mateus', name_confirmed = true`,
      [extraFx.barbershopId, phone],
    );
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone,
      now: "2026-11-16T10:00:00-03:00",
      turns: [
        { role: "user", text: "Quero um corte amanhã às 16h" },
        { role: "user", text: "você é robô?" },
      ],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Posso confirmar\?/);
    const reply = result.turns[1]!.reply;
    expect(reply).toMatch(/Estou aqui pra te ajudar com o horário\./);
    expect(reply).toMatch(/Posso confirmar\?/);
    expect(reply).not.toMatch(/sou (um )?robô|inteligência artificial|sou (uma )?ia/i);
    expect(result.turns[1]!.trace.totalTokens).toBe(0);
  });

  it("reescrita da fala-modelo, quando ligada, cai no template se inventar horário", async () => {
    const templateRun = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000118",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const template = templateRun.turns[0]!.reply;
    const friendly = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000119",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã" }],
      llm: "none",
      languageRewrite: true,
      languageRewriter: async (src) => `Claro! ${src}`,
      trace: false,
      print: () => {},
    });
    expect(friendly.turns[0]!.reply).toMatch(/^Claro! /);
    expect(friendly.turns[0]!.reply).toContain(template.replace(/^Claro! /, ""));
    const rejected = await runSimulator({
      tenant: extraFx.slug,
      phone: "5500000000120",
      now: "2026-11-16T10:00:00-03:00",
      turns: [{ role: "user", text: "Quero um corte amanhã" }],
      llm: "none",
      languageRewrite: true,
      languageRewriter: async () => "Tenho horário às 11h e também pigmentação, pode ser?",
      trace: false,
      print: () => {},
    });
    expect(rejected.turns[0]!.reply).toBe(template);
    expect(rejected.turns[0]!.reply).not.toMatch(/às 11h/i);
  });
});
