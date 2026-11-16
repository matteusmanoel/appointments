/**
 * Job de lembrete 24h dentro do simulador (--run-reminders / event reminders).
 * Requer Postgres 127.0.0.1:55432. Não chama LLM real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { assertLocalDatabaseUrl } from "../db/local-database-url.js";
import { ensureSimulatorConversation, runSimulator } from "../ai/simulator/session.js";
import { simulatorClientPhone } from "../ai/simulator/namespace.js";
import { resetWhatsAppOutbound, listWhatsAppOutboundAttempts } from "../integrations/whatsapp/noop-outbound.js";
import { setSimulatorTraceEnabled } from "../ai/simulator/trace.js";
import { runSimulatorReminders } from "../ai/simulator/reminders.js";

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
  const slug = `sim-remind-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dates = await pool.query<{ today: string; t: string }>(
    `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
  );
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, $2, 'pro', $3, $4::jsonb) RETURNING id`,
    [`Remind sim ${slug}`, "5500000000088", slug, JSON.stringify(OPEN_WEEK)],
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

async function prepare(fx: ShopFx, displayPhone: string) {
  const sandboxPhone = simulatorClientPhone(fx.barbershopId, displayPhone);
  const conversationId = await ensureSimulatorConversation(fx.barbershopId, displayPhone);
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients WHERE barbershop_id = $1 AND phone = $2 LIMIT 1`,
    [fx.barbershopId, sandboxPhone],
  );
  const clientId =
    existing.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true) RETURNING id`,
        [fx.barbershopId, sandboxPhone],
      )
    ).rows[0]!.id;
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, '18:00', 30, 40, 10, 'pending') RETURNING id`,
    [fx.barbershopId, clientId, fx.barberId, fx.serviceId, fx.tomorrowIso],
  );
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 40, 30, 'Corte', 0)`,
    [appt.rows[0]!.id, fx.serviceId],
  );
  return { sandboxPhone, conversationId, appointmentId: appt.rows[0]!.id };
}

async function scheduledCount(barbershopId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.scheduled_messages WHERE barbershop_id = $1`,
    [barbershopId],
  );
  return Number(r.rows[0]?.n ?? "0");
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

describe("lembrete no simulador", () => {
  const shops: ShopFx[] = [];
  let confirmFx: ShopFx;
  let reschedFx: ShopFx;
  let cancelFx: ShopFx;

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
    assertLocalDatabaseUrl();
    confirmFx = await seedShop("confirm");
    reschedFx = await seedShop("resched");
    cancelFx = await seedShop("cancel");
    shops.push(confirmFx, reschedFx, cancelFx);
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

  it("recusa DATABASE_URL remoto antes de conectar", () => {
    const prev = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgres://u:p@db.neon.tech:5432/app";
      expect(() => assertLocalDatabaseUrl()).toThrow(/local/i);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it("lembrete→confirmo: gera o texto do job, não enfileira, confirma presença", async () => {
    const phone = "5500000000301";
    const { appointmentId } = await prepare(confirmFx, phone);
    const queuedBefore = await scheduledCount(confirmFx.barbershopId);
    const result = await runSimulator({
      tenant: confirmFx.slug,
      phone,
      now: `${confirmFx.todayIso}T18:00:00-03:00`,
      runReminders: true,
      turns: [{ role: "user", text: "Confirmo" }],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.trace.userMessage).toBe("[event:reminders]");
    expect(result.turns[0]!.reply).toMatch(/Passando para confirmar seu agendamento/i);
    expect(result.turns[0]!.reply).toMatch(/Você confirma sua presença ou prefere reagendar/i);
    expect(result.turns[1]!.reply).toMatch(/Presença confirmada/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("confirmed");
    expect(await scheduledCount(confirmFx.barbershopId)).toBe(queuedBefore);
    const outbound = listWhatsAppOutboundAttempts();
    expect(outbound.some((a) => a.method === "sendText" && (a.text ?? "").includes("Passando para confirmar"))).toBe(
      true,
    );
    const activity = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.agenda_activity WHERE appointment_id = $1 AND type = 'reminder_sent'`,
      [appointmentId],
    );
    expect(Number(activity.rows[0]?.n ?? "0")).toBe(1);
  });

  it("lembrete→remarcar: o evento no replay oferece horários e mantém o agendamento", async () => {
    const phone = "5500000000302";
    const { appointmentId } = await prepare(reschedFx, phone);
    const queuedBefore = await scheduledCount(reschedFx.barbershopId);
    const result = await runSimulator({
      tenant: reschedFx.slug,
      phone,
      now: `${reschedFx.todayIso}T18:00:00-03:00`,
      turns: [
        { role: "system", event: "reminders" },
        { role: "user", text: "Preciso remarcar, pode ser o próximo" },
      ],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/confirma sua presença ou prefere reagendar/i);
    expect(result.turns[1]!.reply).toMatch(/às\s+\d{1,2}h/);
    expect(result.turns[1]!.reply).not.toMatch(/cancelado/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("pending");
    expect(await scheduledCount(reschedFx.barbershopId)).toBe(queuedBefore);
  });

  it("lembrete→cancelar: pede o card e só cancela no sim", async () => {
    const phone = "5500000000303";
    const { appointmentId } = await prepare(cancelFx, phone);
    const queuedBefore = await scheduledCount(cancelFx.barbershopId);
    const result = await runSimulator({
      tenant: cancelFx.slug,
      phone,
      now: `${cancelFx.todayIso}T18:00:00-03:00`,
      runReminders: true,
      turns: [
        { role: "user", text: "Quero cancelar, não vou conseguir ir" },
        { role: "user", text: "Sim" },
      ],
      llm: "none",
      trace: false,
      print: () => {},
    });
    expect(result.turns[0]!.reply).toMatch(/Passando para confirmar seu agendamento/i);
    expect(result.turns[1]!.reply).toMatch(/Posso cancelar seu horário/i);
    expect(result.turns[1]!.reply).toMatch(/remarcar/i);
    expect(result.turns[1]!.reply).not.toMatch(/cancelado/i);
    expect(result.turns[2]!.reply).toMatch(/cancelado/i);
    const status = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [
      appointmentId,
    ]);
    expect(status.rows[0]?.status).toBe("cancelled");
    expect(await scheduledCount(cancelFx.barbershopId)).toBe(queuedBefore);
  });

  it("runSimulatorReminders sozinho também grava na conversa sim: e não na fila", async () => {
    const phone = "5500000000304";
    const fx = confirmFx;
    const { sandboxPhone, conversationId, appointmentId } = await prepare(fx, phone);
    const queuedBefore = await scheduledCount(fx.barbershopId);
    const sent = await runSimulatorReminders({
      barbershopId: fx.barbershopId,
      conversationId,
      phone: sandboxPhone,
      now: `${fx.todayIso}T18:00:00-03:00`,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.appointmentId).toBe(appointmentId);
    expect(sent[0]!.body).toMatch(/Passando para confirmar seu agendamento/i);
    const msgs = await pool.query<{ content: string; channel: string }>(
      `SELECT m.content, c.channel
         FROM public.ai_messages m
         JOIN public.ai_conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = $1 AND m.role = 'assistant'
        ORDER BY m.created_at DESC`,
      [conversationId],
    );
    expect(msgs.rows[0]?.channel).toBe("simulator");
    expect(msgs.rows[0]?.content).toBe(sent[0]!.body);
    expect(await scheduledCount(fx.barbershopId)).toBe(queuedBefore);
  });
});
