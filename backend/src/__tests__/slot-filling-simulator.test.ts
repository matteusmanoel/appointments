/**
 * Os 4 fluxos básicos (agendar, reagendar, cancelar, lembrar) pelo simulador CLI.
 * Requer Postgres 127.0.0.1:55432.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { ensureSimulatorConversation, runSimulator } from "../ai/simulator/session.js";
import { simulatorClientPhone } from "../ai/simulator/namespace.js";
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
  todayIso: string;
  tomorrowIso: string;
};

async function seedShop(suffix: string): Promise<ShopFx> {
  const slug = `slot-sim-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dates = await pool.query<{ today: string; t: string }>(
    `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
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
    todayIso: dates.rows[0]!.today,
    tomorrowIso: dates.rows[0]!.t,
  };
}


async function prepareSimulatorIdentity(fx: ShopFx, displayPhone: string) {
  const sandboxPhone = simulatorClientPhone(fx.barbershopId, displayPhone);
  const conversationId = await ensureSimulatorConversation(fx.barbershopId, displayPhone);
  return { sandboxPhone, conversationId };
}

async function insertUpcoming(
  fx: ShopFx,
  phone: string,
  opts?: { time?: string; date?: string; status?: string },
): Promise<string> {
  const time = opts?.time ?? "18:00";
  const date = opts?.date ?? fx.tomorrowIso;
  const status = opts?.status ?? "pending";
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients WHERE barbershop_id = $1 AND phone = $2 LIMIT 1`,
    [fx.barbershopId, phone],
  );
  const clientId =
    existing.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true) RETURNING id`,
        [fx.barbershopId, phone],
      )
    ).rows[0]!.id;
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 40, 10, $7) RETURNING id`,
    [fx.barbershopId, clientId, fx.barberId, fx.serviceId, date, time, status],
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

  it("cancelar: pede confirmação, oferece remarcar e só cancela no sim", async () => {
    const phone = "5500000000102";
    const { sandboxPhone } = await prepareSimulatorIdentity(cancelFx, phone);
    const appointmentId = await insertUpcoming(cancelFx, sandboxPhone);
    const result = await runSimulator({
      tenant: cancelFx.slug,
      phone,
      turns: [
        { role: "user", text: "Quero cancelar meu horário" },
        { role: "user", text: "Sim" },
      ],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Posso cancelar seu horário/i);
    expect(result.turns[0]!.reply).toMatch(/remarcar/i);
    expect(result.turns[0]!.reply).not.toMatch(/cancelado/i);
    expect(result.turns[1]!.reply).toMatch(/cancelado/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("cancelled");
  });

  it("lembrar: «confirmo» confirma presença sem chamar o LLM", async () => {
    const phone = "5500000000103";
    const { sandboxPhone, conversationId } = await prepareSimulatorIdentity(remindFx, phone);
    const appointmentId = await insertUpcoming(remindFx, sandboxPhone);
    await seedReminder(remindFx, conversationId, appointmentId, sandboxPhone);
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
    const { sandboxPhone, conversationId } = await prepareSimulatorIdentity(reschedFx, phone);
    const appointmentId = await insertUpcoming(reschedFx, sandboxPhone);
    await seedReminder(reschedFx, conversationId, appointmentId, sandboxPhone);
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
    expect(turn.reply).toMatch(/Com quem você prefere\?/);
    expect(turn.reply).not.toMatch(/Posso confirmar\?/);
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
    expect(result.turns[1]!.reply).toMatch(/qual seu nome/i);
    expect(result.turns[1]!.reply).not.toMatch(/Posso confirmar\?/);
    expect(result.turns[1]!.trace.totalTokens).toBe(0);
    expect((result.turns[1]!.trace.draft as { time?: string | null } | null)?.time).toBeTruthy();
  });

  it("«você é robô?» no meio do agendamento desvia e segue com o card", async () => {
    const phone = "5500000000117";
    const { sandboxPhone } = await prepareSimulatorIdentity(extraFx, phone);
    await pool.query(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true)
       ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = 'Mateus', name_confirmed = true`,
      [extraFx.barbershopId, sandboxPhone],
    );
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone,
      now: "2026-11-16T10:00:00-03:00",
      turns: [
        { role: "user", text: "Quero um corte amanhã às 16h com o Lucas" },
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


  it("reagendar: «quero remarcar» sem horário oferece 2–3 opções", async () => {
    const phone = "5500000000201";
    const { sandboxPhone } = await prepareSimulatorIdentity(reschedFx, phone);
    const appointmentId = await insertUpcoming(reschedFx, sandboxPhone);
    const result = await runSimulator({
      tenant: reschedFx.slug,
      phone,
      now: `${reschedFx.todayIso}T10:00:00-03:00`,
      turns: [{ role: "user", text: "Quero remarcar meu horário" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const reply = result.turns[0]!.reply;
    const clocks = [...reply.matchAll(/às\s+\d{1,2}h/gi)];
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    expect(clocks.length).toBeLessThanOrEqual(3);
    expect(result.turns[0]!.trace.tools.some((t) => t.name === "get_next_slots" && t.ok)).toBe(true);
    expect(result.turns[0]!.trace.tools.every((t) => t.name !== "reschedule_appointment")).toBe(true);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("pending");
  });

  it("reagendar: horário nomeado livre pede confirmação e não remarca ainda", async () => {
    const phone = "5500000000202";
    const { sandboxPhone } = await prepareSimulatorIdentity(reschedFx, phone);
    const appointmentId = await insertUpcoming(reschedFx, sandboxPhone);
    const result = await runSimulator({
      tenant: reschedFx.slug,
      phone,
      now: `${reschedFx.todayIso}T10:00:00-03:00`,
      turns: [{ role: "user", text: "Preciso remarcar, pode ser amanhã às 10h?" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Quer que eu mude|Posso confirmar/i);
    expect(result.turns[0]!.trace.tools.some((t) => t.name === "check_availability" && t.ok)).toBe(true);
    expect(result.turns[0]!.trace.tools.every((t) => t.name !== "reschedule_appointment")).toBe(true);
    const row = await pool.query<{ status: string; scheduled_time: string }>(
      `SELECT status, scheduled_time::text FROM public.appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(row.rows[0]?.status).toBe("pending");
    expect(String(row.rows[0]?.scheduled_time).slice(0, 5)).toBe("18:00");
  });

  it("reagendar: horário nomeado ocupado oferece alternativas", async () => {
    const phone = "5500000000203";
    const { sandboxPhone } = await prepareSimulatorIdentity(reschedFx, phone);
    const appointmentId = await insertUpcoming(reschedFx, sandboxPhone);
    const other = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Outro', $2, true) RETURNING id`,
      [reschedFx.barbershopId, "5500000000299"],
    );
    const barbers = await pool.query<{ id: string }>(
      `SELECT id FROM public.barbers WHERE barbershop_id = $1`,
      [reschedFx.barbershopId],
    );
    for (const row of barbers.rows) {
      const appt = await pool.query<{ id: string }>(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, $5::date, '15:00', 30, 40, 10, 'pending') RETURNING id`,
        [reschedFx.barbershopId, other.rows[0]!.id, row.id, reschedFx.serviceId, reschedFx.tomorrowIso],
      );
      await pool.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, 40, 30, 'Corte', 0)`,
        [appt.rows[0]!.id, reschedFx.serviceId],
      );
    }
    const result = await runSimulator({
      tenant: reschedFx.slug,
      phone,
      now: `${reschedFx.todayIso}T10:00:00-03:00`,
      turns: [{ role: "user", text: "Preciso remarcar, pode ser amanhã às 15h?" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    const reply = result.turns[0]!.reply;
    const clocks = [...reply.matchAll(/às\s+(\d{1,2})h(?:(\d{2}))?/gi)].map((m) => {
      const h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      return h * 60 + min;
    });
    expect(clocks.length).toBeGreaterThanOrEqual(2);
    expect(clocks.every((mins) => mins !== 15 * 60)).toBe(true);
    expect(reply).not.toMatch(/Posso confirmar\?/);
    const status = await pool.query<{ status: string; scheduled_time: string }>(
      `SELECT status, scheduled_time::text FROM public.appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(status.rows[0]?.status).toBe("pending");
    expect(String(status.rows[0]?.scheduled_time).slice(0, 5)).toBe("18:00");
  });

  it("reagendar: mais de um horário futuro pergunta qual", async () => {
    const phone = "5500000000204";
    const { sandboxPhone } = await prepareSimulatorIdentity(extraFx, phone);
    await insertUpcoming(extraFx, sandboxPhone, { time: "10:00" });
    await insertUpcoming(extraFx, sandboxPhone, { time: "18:00" });
    const result = await runSimulator({
      tenant: extraFx.slug,
      phone,
      now: `${extraFx.todayIso}T09:00:00-03:00`,
      turns: [{ role: "user", text: "Quero remarcar" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/mais de um horário/i);
    expect(result.turns[0]!.reply).toMatch(/Qual você quer remarcar/i);
    expect(result.turns[0]!.trace.tools.every((t) => t.name !== "reschedule_appointment")).toBe(true);
  });

  it("reagendar: «sim» com card expirado não remarca", async () => {
    const phone = "5500000000205";
    const { sandboxPhone, conversationId } = await prepareSimulatorIdentity(cancelFx, phone);
    const appointmentId = await insertUpcoming(cancelFx, sandboxPhone);
    const first = await runSimulator({
      tenant: cancelFx.slug,
      phone,
      now: `${cancelFx.todayIso}T10:00:00-03:00`,
      turns: [{ role: "user", text: "Preciso remarcar, pode ser amanhã às 10h?" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(first.turns[0]!.reply).toMatch(/Quer que eu mude|Posso confirmar/i);
    await pool.query(
      `UPDATE public.ai_conversation_runtime
          SET booking_draft = jsonb_set(
            COALESCE(booking_draft, '{}'::jsonb),
            '{confirmCard,issuedAt}',
            to_jsonb(('2026-01-01T00:00:00.000-03:00')::text)
          )
        WHERE conversation_id = $1`,
      [conversationId],
    );
    const second = await runSimulator({
      tenant: cancelFx.slug,
      phone,
      now: `${cancelFx.todayIso}T10:40:00-03:00`,
      turns: [{ role: "user", text: "Sim" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(second.turns[0]!.reply).toMatch(/expirou/i);
    expect(second.turns[0]!.trace.tools.every((t) => t.name !== "reschedule_appointment")).toBe(true);
    const row = await pool.query<{ status: string; scheduled_time: string }>(
      `SELECT status, scheduled_time::text FROM public.appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(row.rows[0]?.status).toBe("pending");
    expect(String(row.rows[0]?.scheduled_time).slice(0, 5)).toBe("18:00");
  });

  it("reagendar: agendamento cancelled é recusado", async () => {
    const phone = "5500000000206";
    const { sandboxPhone } = await prepareSimulatorIdentity(scheduleFx, phone);
    const appointmentId = await insertUpcoming(scheduleFx, sandboxPhone, { status: "cancelled" });
    const result = await runSimulator({
      tenant: scheduleFx.slug,
      phone,
      now: `${scheduleFx.todayIso}T10:00:00-03:00`,
      turns: [{ role: "user", text: "Quero remarcar meu horário" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Não encontrei um horário ativo pra remarcar/i);
    expect(result.turns[0]!.trace.tools.every((t) => t.name !== "reschedule_appointment")).toBe(true);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("cancelled");
  });
});

