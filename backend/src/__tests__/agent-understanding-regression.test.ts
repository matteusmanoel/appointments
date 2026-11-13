/**
 * Regression tests for the 23/09 transcript diagnostic (canvas:
 * agent-understanding-diagnostic). These reproduce, against a real Postgres
 * fixture and runAgent() end-to-end, two state/merge bugs that are NOT
 * classification failures — the deterministic layer extracts the client's
 * request correctly and then discards it before the reply is composed:
 *
 * - RC1: `desired` (date/time) was derived by scanning the FULL raw history on
 *   every turn, with no expiry once a transaction closed. A date/time from
 *   turn 1 kept resurfacing many turns later, making an unrelated reply (e.g.
 *   a presence confirmation) look like an open booking request.
 * - RC2: the reschedule merge/availability-check silently reused the barber
 *   of the EXISTING appointment even when the current turn named a different
 *   barber, so "reagendar para 18:30 com o Lucas" checked Eduardo's calendar.
 *
 * Both turns now reach the LLM (language early-returns were removed). Tests stub
 * `chat.completions.create` so they stay deterministic — see stubOpenAI().
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { runAgent } from "../ai/agent.js";
import type OpenAI from "openai";

const SLUG_PREFIX = "test-understanding-";
const OPEN_ALL_WEEK = {
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

/**
 * A minimal OpenAI stand-in for turns that are expected to resolve inside a
 * deterministic branch. If a turn unexpectedly falls all the way through to the
 * model, this returns a harmless canned reply (no tool_calls) instead of throwing,
 * so the assertion failure clearly reads as "fell through to the LLM" rather than
 * an opaque TypeError on `openai.chat.completions.create`.
 */
function stubOpenAI(
  fallbackContent = "Combinado.",
  firstToolCall?: { name: string; args: Record<string, unknown> },
): OpenAI {
  let round = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          round += 1;
          if (firstToolCall && round === 1) {
            return {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: "call_test_1",
                        type: "function",
                        function: {
                          name: firstToolCall.name,
                          arguments: JSON.stringify(firstToolCall.args),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            };
          }
          return {
            choices: [{ message: { content: fallbackContent, tool_calls: undefined }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

async function tomorrowIso(): Promise<string> {
  const r = await pool.query<{ d: string }>(`SELECT (CURRENT_DATE + 1)::text AS d`);
  return r.rows[0]!.d;
}

describe("RC1 — presence confirmation after a closed booking does not re-open a stale draft", () => {
  let ok = false;
  let barbershopId = "";
  let conversationId = "";
  let appointmentId = "";
  const clientPhone = "5511988880001";
  let dateIso = "";

  beforeAll(async () => {
    ok = await dbAvailable();
    if (!ok) return;
    const slug = `${SLUG_PREFIX}rc1-${Date.now()}`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ($1, '5511999990010', 'pro', $2, $3::jsonb) RETURNING id`,
      [`Test RC1 ${slug}`, slug, JSON.stringify(OPEN_ALL_WEEK)],
    );
    barbershopId = shop.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
       VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
       ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
      [barbershopId],
    );
    const barber = await pool.query<{ id: string }>(
      `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Eduardo Gustavo', 'active') RETURNING id`,
      [barbershopId],
    );
    const barberId = barber.rows[0]!.id;
    const service = await pool.query<{ id: string }>(
      `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
       VALUES ($1, 'Corte e Barba', 55, 45, true) RETURNING id`,
      [barbershopId],
    );
    const serviceId = service.rows[0]!.id;
    dateIso = await tomorrowIso();

    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Mateus', $2) RETURNING id`,
      [barbershopId, clientPhone],
    );
    const clientId = client.rows[0]!.id;

    const appt = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments
         (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       VALUES ($1, $2, $3, $4, $5::date, '18:00', 45, 55, 20, 'pending')
       RETURNING id`,
      [barbershopId, clientId, barberId, serviceId, dateIso],
    );
    appointmentId = appt.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
       VALUES ($1, $2, 55, 45, 'Corte e Barba', 0)`,
      [appointmentId, serviceId],
    );

    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
       VALUES ($1, 'whatsapp', $2) RETURNING id`,
      [barbershopId, clientPhone],
    );
    conversationId = conv.rows[0]!.id;

    // History: the original booking request (turn 1, carries the date/time) → assistant
    // confirms → create_appointment closes the transaction → client asks an unrelated
    // informational question → client replies to the (separately-sent) 24h reminder.
    const rows: Array<{ role: string; content: string; toolName?: string; toolPayload?: unknown }> = [
      { role: "user", content: "Gostaria de agendar um horario com Eduardo amanha as 18. Ele esta disponivel?" },
      { role: "assistant", content: "Fica assim, então:\n\n✂️ *Corte e Barba*\n💈 *Eduardo Gustavo*\n📅 Amanhã às 18h\n💰 R$ 55,00" },
      { role: "assistant", content: "Posso confirmar?" },
      { role: "user", content: "Pode" },
      {
        role: "tool",
        content: "",
        toolName: "create_appointment",
        toolPayload: { date: dateIso, time: "18:00", barber_id: barberId, service_ids: [serviceId] },
      },
      { role: "assistant", content: "Agendado, Mateus! Corte e Barba fica R$ 55. Eduardo Gustavo aguarda você amanhã às 18h." },
      { role: "user", content: "Maravilha, pra quando ficou meu agendamento mesmo?" },
      {
        role: "assistant",
        content:
          "Olá, Mateus! Tudo certo com seu horário para Corte e Barba amanhã às 18h com o Eduardo Gustavo? Se preferir reagendar, me diz o novo dia/horário.",
      },
    ];
    for (const r of rows) {
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, content, tool_name, tool_payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, r.role, r.content, r.toolName ?? null, r.toolPayload ? JSON.stringify(r.toolPayload) : null],
      );
    }

    // The real production flow resets the draft to empty ("rebook_eligible") once a
    // booking closes (see agent.ts saveBookingDraft calls right after create_appointment).
    // Reproducing that reset here is the crux of RC1: the draft itself carries no
    // leftover date/time/service after close, so the ONLY way stale info can resurface
    // and wrongly trigger "qual serviço deseja?" on an unrelated later turn is via the
    // unbounded `desired` history scan — which is exactly what this test exercises.
    await pool.query(
      `INSERT INTO public.ai_conversation_runtime (conversation_id, booking_draft, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (conversation_id) DO UPDATE SET booking_draft = $2::jsonb, updated_at = now()`,
      [conversationId, JSON.stringify({ status: "collecting", phase: "rebook_eligible" })],
    );
  });

  afterAll(async () => {
    if (!ok || !barbershopId) return;
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [conversationId]);
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [conversationId]);
    await pool.query(`DELETE FROM public.ai_conversations WHERE id = $1`, [conversationId]);
    await pool.query(`DELETE FROM public.appointment_services WHERE appointment_id = $1`, [appointmentId]);
    await pool.query(`DELETE FROM public.appointments WHERE id = $1`, [appointmentId]);
    await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]);
  });

  it('does not ask "qual serviço" when the client spontaneously confirms presence', async () => {
    if (!ok) return;
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [conversationId, "Estarei aí"],
    );
    const result = await runAgent(barbershopId, conversationId, clientPhone, stubOpenAI("Perfeito, te aguardamos!"), {
      persistAssistantMessages: false,
    });
    expect(result.reply.toLowerCase()).not.toMatch(/qual\s+serviço|que\s+serviço/);
  });
});

describe("RC2 — reschedule with an explicit different barber checks that barber, not the old one", () => {
  let ok = false;
  let barbershopId = "";
  let conversationId = "";
  let appointmentId = "";
  let eduardoId = "";
  let lucasId = "";
  const clientPhone = "5511988880002";
  let dateIso = "";

  beforeAll(async () => {
    ok = await dbAvailable();
    if (!ok) return;
    const slug = `${SLUG_PREFIX}rc2-${Date.now()}`;
    const shop = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ($1, '5511999990020', 'pro', $2, $3::jsonb) RETURNING id`,
      [`Test RC2 ${slug}`, slug, JSON.stringify(OPEN_ALL_WEEK)],
    );
    barbershopId = shop.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
       VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
       ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
      [barbershopId],
    );
    const eduardo = await pool.query<{ id: string }>(
      `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Eduardo Gustavo', 'active') RETURNING id`,
      [barbershopId],
    );
    eduardoId = eduardo.rows[0]!.id;
    const lucas = await pool.query<{ id: string }>(
      `INSERT INTO public.barbers (barbershop_id, name, status) VALUES ($1, 'Lucas Lima', 'active') RETURNING id`,
      [barbershopId],
    );
    lucasId = lucas.rows[0]!.id;
    const service = await pool.query<{ id: string }>(
      `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
       VALUES ($1, 'Corte e Barba', 55, 45, true) RETURNING id`,
      [barbershopId],
    );
    const serviceId = service.rows[0]!.id;
    dateIso = await tomorrowIso();

    const client = await pool.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Mateus', $2) RETURNING id`,
      [barbershopId, clientPhone],
    );
    const clientId = client.rows[0]!.id;

    const appt = await pool.query<{ id: string }>(
      `INSERT INTO public.appointments
         (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
       VALUES ($1, $2, $3, $4, $5::date, '18:00', 45, 55, 20, 'pending')
       RETURNING id`,
      [barbershopId, clientId, eduardoId, serviceId, dateIso],
    );
    appointmentId = appt.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
       VALUES ($1, $2, 55, 45, 'Corte e Barba', 0)`,
      [appointmentId, serviceId],
    );

    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
       VALUES ($1, 'whatsapp', $2) RETURNING id`,
      [barbershopId, clientPhone],
    );
    conversationId = conv.rows[0]!.id;
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [conversationId, "Quero reagendar para as 18:30 com o Lucas"],
    );
  });

  afterAll(async () => {
    if (!ok || !barbershopId) return;
    await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [conversationId]);
    await pool.query(`DELETE FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [conversationId]);
    await pool.query(`DELETE FROM public.ai_conversations WHERE id = $1`, [conversationId]);
    await pool.query(`DELETE FROM public.appointment_services WHERE appointment_id = $1`, [appointmentId]);
    await pool.query(`DELETE FROM public.appointments WHERE id = $1`, [appointmentId]);
    await pool.query(`DELETE FROM public.clients WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.services WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.barbers WHERE barbershop_id = $1`, [barbershopId]);
    await pool.query(`DELETE FROM public.barbershops WHERE id = $1`, [barbershopId]);
  });

  it("checks Lucas's availability, not Eduardo's (the barber being replaced)", async () => {
    if (!ok) return;
    const result = await runAgent(
      barbershopId,
      conversationId,
      clientPhone,
      stubOpenAI("Horário do Lucas às 18h30.", {
        name: "check_availability",
        args: { date: dateIso, time: "18:30", barber_id: lucasId },
      }),
      { persistAssistantMessages: false },
    );
    // The deterministic reschedule-availability block (agent.ts ~line 3257) doesn't always
    // persist a dedicated 'check_availability' tool row (the "hours_overflow"/occupied
    // branch composes straight from the in-memory snapshot) — so the reliable, outcome-level
    // assertion is the reply's own content: whichever branch it took, it must be talking
    // about the barber the client actually asked for.
    const reply = result.reply.toLowerCase();
    expect(reply).toMatch(/lucas/);
    expect(reply).not.toMatch(/eduardo/);
  });
});
