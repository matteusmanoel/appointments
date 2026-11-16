/**
 * Garantias da revisão do #41: card de cancelar, TTL do «sim»,
 * alvo do lembrete, horário nomeado com agendamento existente,
 * movingId válido e reschedule recusa cancelled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db.js";
import { runAgent } from "../ai/agent.js";
import { CANCEL_FAILED_SAFE, CANCEL_NONE_SAFE } from "../ai/agent/confirmation-card.js";
import { loadBookingDraft, saveBookingDraft } from "../ai/booking-draft.js";
import * as aiTools from "../ai/tools.js";
import type OpenAI from "openai";

function stubOpenAI(): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error("fell through to the LLM — expected a deterministic path");
        },
      },
    },
  } as unknown as OpenAI;
}

type ShopFx = {
  barbershopId: string;
  conversationId: string;
  clientPhone: string;
  clientId: string;
  serviceId: string;
  barberId: string;
  tomorrowIso: string;
};

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function seedShop(suffix: string, phone: string): Promise<ShopFx> {
  const slug = `test-confirm-guard-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dates = await pool.query<{ d: string; t: string }>(
    `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
  );
  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, '5511999990090', 'pro', $2, $3::jsonb) RETURNING id`,
    [
      `Guard ${slug}`,
      slug,
      JSON.stringify({
        monday: { start: "09:00", end: "20:00" },
        tuesday: { start: "09:00", end: "20:00" },
        wednesday: { start: "09:00", end: "20:00" },
        thursday: { start: "09:00", end: "20:00" },
        friday: { start: "09:00", end: "20:00" },
        saturday: { start: "09:00", end: "20:00" },
        sunday: { start: "09:00", end: "20:00" },
      }),
    ],
  );
  const barbershopId = shop.rows[0]!.id;
  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
     VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
     ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
    [barbershopId],
  );
  const barber = await pool.query<{ id: string }>(
    `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Lucas Lima', 'active') RETURNING id`,
    [barbershopId],
  );
  const service = await pool.query<{ id: string }>(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
     VALUES ($1, 'Corte masculino', 35, 30, true) RETURNING id`,
    [barbershopId],
  );
  const client = await pool.query<{ id: string }>(
    `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, 'Mateus', $2, true) RETURNING id`,
    [barbershopId, phone],
  );
  const conv = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
     VALUES ($1, 'whatsapp', $2, true) RETURNING id`,
    [barbershopId, phone],
  );
  return {
    barbershopId,
    conversationId: conv.rows[0]!.id,
    clientPhone: phone,
    clientId: client.rows[0]!.id,
    serviceId: service.rows[0]!.id,
    barberId: barber.rows[0]!.id,
    tomorrowIso: dates.rows[0]!.t,
  };
}

async function insertUpcoming(fx: ShopFx, time = "18:00", status = "pending"): Promise<string> {
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 35, 14, $7) RETURNING id`,
    [fx.barbershopId, fx.clientId, fx.barberId, fx.serviceId, fx.tomorrowIso, time, status],
  );
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 35, 30, 'Corte masculino', 0)`,
    [appt.rows[0]!.id, fx.serviceId],
  );
  return appt.rows[0]!.id;
}

async function runTurn(fx: ShopFx, text: string) {
  await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [
    fx.conversationId,
    text,
  ]);
  return runAgent(fx.barbershopId, fx.conversationId, fx.clientPhone, stubOpenAI(), {
    persistAssistantMessages: true,
  });
}

async function apptStatus(id: string): Promise<string> {
  const r = await pool.query<{ status: string }>(`SELECT status FROM public.appointments WHERE id = $1`, [id]);
  return r.rows[0]?.status ?? "";
}

async function wipe(fx: ShopFx | null) {
  if (!fx?.barbershopId) return;
  await pool.query(`DELETE FROM public.agenda_activity WHERE barbershop_id = $1`, [fx.barbershopId]).catch(() => undefined);
  await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [fx.conversationId]);
  await pool.query(`DELETE FROM public.ai_conversations WHERE id = $1`, [fx.conversationId]);
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

describe("garantias de confirmação e cancelamento", () => {
  const shops: ShopFx[] = [];

  beforeAll(async () => {
    if (!(await dbAvailable())) {
      throw new Error("Postgres 127.0.0.1:55432 indisponível — estes testes não podem passar sem o banco");
    }
  });

  afterAll(async () => {
    for (const fx of shops) await wipe(fx);
  });

  it("com mais de um horário futuro, pergunta qual cancelar e não cancela na hora", async () => {
    const fx = await seedShop("which", "5511988800801");
    shops.push(fx);
    const first = await insertUpcoming(fx, "10:00");
    const second = await insertUpcoming(fx, "18:00");
    const result = await runTurn(fx, "quero cancelar meu horário");
    expect(result.reply).toMatch(/mais de um horário/i);
    expect(result.reply).toMatch(/Qual você quer cancelar/i);
    expect(result.reply).not.toMatch(/cancelado/i);
    expect(await apptStatus(first)).toBe("pending");
    expect(await apptStatus(second)).toBe("pending");
  });

  it("falha no cancelamento responde com fala segura, nunca vazio", async () => {
    const fx = await seedShop("fail", "5511988800802");
    shops.push(fx);
    const id = await insertUpcoming(fx, "18:00");
    const ask = await runTurn(fx, "quero cancelar meu horário");
    expect(ask.reply).toMatch(/Posso cancelar seu horário/i);
    await pool.query(
      `DELETE FROM public.appointment_services WHERE appointment_id = $1`,
      [id],
    );
    await pool.query(`DELETE FROM public.appointments WHERE id = $1`, [id]);
    const result = await runTurn(fx, "sim");
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect([CANCEL_NONE_SAFE, CANCEL_FAILED_SAFE]).toContain(result.reply);
    expect(result.state).not.toBe("appointment_cancelled");
  });

  it("um «sim» atrasado (TTL) não cria o agendamento", async () => {
    const fx = await seedShop("ttl", "5511988800803");
    shops.push(fx);
    const ask = await runTurn(fx, "Quero um corte masculino amanhã às 15h");
    expect(ask.reply).toMatch(/Posso confirmar\?/i);
    const draft = await loadBookingDraft(fx.conversationId);
    expect(draft.confirmCard?.kind).toBe("create");
    await saveBookingDraft(fx.conversationId, {
      ...draft,
      confirmCard: {
        ...draft.confirmCard!,
        issuedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    });
    const result = await runTurn(fx, "sim");
    expect(result.state).not.toBe("appointment_created");
    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.appointments WHERE barbershop_id = $1 AND status <> 'cancelled'`,
      [fx.barbershopId],
    );
    expect(Number(count.rows[0]!.n)).toBe(0);
  });

  it("um «sim» quando o card não é a última fala do agente não confirma nem cria", async () => {
    const fx = await seedShop("stale", "5511988800804");
    shops.push(fx);
    const ask = await runTurn(fx, "Quero um corte masculino amanhã às 15h");
    expect(ask.reply).toMatch(/Posso confirmar\?/i);
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      fx.conversationId,
      "Qual serviço você prefere, corte ou combo?",
    ]);
    const result = await runTurn(fx, "sim");
    expect(result.state).not.toBe("appointment_created");
    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.appointments WHERE barbershop_id = $1`,
      [fx.barbershopId],
    );
    expect(Number(count.rows[0]!.n)).toBe(0);
  });

  it("o «sim» do lembrete confirma o horário do card, não o primeiro pending", async () => {
    const fx = await seedShop("rsvp", "5511988800805");
    shops.push(fx);
    const first = await insertUpcoming(fx, "10:00");
    const second = await insertUpcoming(fx, "18:00");
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      fx.conversationId,
      "Fala, Mateus! Seu horário está reservado. *Você confirma sua presença ou prefere reagendar?*",
    ]);
    await pool.query(
      `INSERT INTO public.agenda_activity
         (barbershop_id, appointment_id, conversation_id, type, actor, client_name, scheduled_date, scheduled_time, summary)
       VALUES ($1, $2, $3, 'reminder_sent', 'system', 'Mateus', $4::date, '18:00', 'reminder 24h')`,
      [fx.barbershopId, second, fx.conversationId, fx.tomorrowIso],
    );
    const result = await runTurn(fx, "confirmo");
    expect(result.state).toBe("appointment_confirmed");
    expect(await apptStatus(first)).toBe("pending");
    expect(await apptStatus(second)).toBe("confirmed");
  });

  it("horário nomeado com agendamento existente pergunta se é para remarcar e não abre card de agendamento novo", async () => {
    const fx = await seedShop("named", "5511988800806");
    shops.push(fx);
    const id = await insertUpcoming(fx, "18:00");
    const result = await runTurn(fx, "Quero um corte masculino amanhã às 15h");
    expect(result.reply).toMatch(/Quer que eu mude para/i);
    expect(result.reply).not.toMatch(/Posso confirmar\?/i);
    expect(result.state).not.toBe("appointment_created");
    expect(await apptStatus(id)).toBe("pending");
    const draft = await loadBookingDraft(fx.conversationId);
    expect(draft.appointment_id).toBe(id);
    expect(draft.confirmCard?.kind).toBe("reschedule");
  });

  it("reschedule recusa agendamento cancelled e movingId inválido não é usado", async () => {
    const fx = await seedShop("moved", "5511988800807");
    shops.push(fx);
    const cancelled = await insertUpcoming(fx, "10:00", "cancelled");
    const active = await insertUpcoming(fx, "18:00");
    const refused = await aiTools.rescheduleAppointmentByAgent(fx.barbershopId, cancelled, fx.clientPhone, {
      date: fx.tomorrowIso,
      time: "15:00",
      barber_id: fx.barberId,
    });
    expect(refused && typeof refused === "object" && (refused as { code?: string }).code).toBe("CANCELLED");
    const still = await pool.query<{ scheduled_time: string; status: string }>(
      `SELECT scheduled_time::text, status FROM public.appointments WHERE id = $1`,
      [cancelled],
    );
    expect(still.rows[0]?.status).toBe("cancelled");
    expect(String(still.rows[0]?.scheduled_time).slice(0, 5)).toBe("10:00");

    await saveBookingDraft(fx.conversationId, {
      status: "collecting",
      appointment_id: cancelled,
      service_ids: [fx.serviceId],
      service_name: "Corte masculino",
      barber_id: fx.barberId,
      barber_name: "Lucas Lima",
      date: fx.tomorrowIso,
      time: "15:00",
    });
    const result = await runTurn(fx, "Quero um corte masculino amanhã às 16h");
    expect(result.reply).toMatch(/Quer que eu mude para/i);
    expect(result.reply).not.toMatch(/Posso confirmar\?/i);
    expect(result.state).not.toBe("appointment_rescheduled");
    const draft = await loadBookingDraft(fx.conversationId);
    expect(draft.appointment_id).toBe(active);
    expect(await apptStatus(active)).toBe("pending");
  });
});
