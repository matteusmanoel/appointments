/**
 * Fluxos completos do motor novo no Postgres. O interpretador é roteirizado para o teste não depender da OpenAI.
 */
import type OpenAI from "openai";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db.js";
import { createGoldenFixture, dbAvailable, deleteGoldenFixture, type GoldenClient, type GoldenFixture } from "../../simulator/golden/runner.js";
import type { TurnInterpretation, TurnInterpreter } from "../turn-interpreter.js";
import { resolveAgentEngine } from "../engine-router.js";
import { runAgentV2 } from "./engine.js";

const noOpenAI = {} as OpenAI;
const fixtures: GoldenFixture[] = [];

const understood = (patch: Partial<TurnInterpretation>): TurnInterpretation => ({
  intents: [patch.primary ?? "unknown"],
  primary: "unknown",
  service_id: null,
  service_ambiguous: false,
  barber_id: null,
  barber_any: false,
  unknown_barber_name: null,
  date: null,
  time: null,
  after_time: null,
  wants_next_slot: false,
  offer_response: "none",
  person_name: null,
  social: "none",
  confidence: 0.9,
  ...patch,
});

const scripted = (interpretation: TurnInterpretation): TurnInterpreter => async () => ({ interpretation, latencyMs: 0 });

async function fixture(client: GoldenClient): Promise<GoldenFixture> {
  const fx = await createGoldenFixture(`v2-${Math.random().toString(36).slice(2, 8)}`, client);
  fixtures.push(fx);
  return fx;
}

async function say(fx: GoldenFixture, text: string, interpretation: TurnInterpretation) {
  await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [fx.conversationId, text]);
  return runAgentV2(fx.barbershopId, fx.conversationId, fx.clientPhone, noOpenAI, { interpret: scripted(interpretation), polish: false });
}

async function appointments(fx: GoldenFixture) {
  const rows = await pool.query<{ id: string; status: string; scheduled_time: string; scheduled_date: string }>(
    `SELECT id, status, scheduled_time::text, scheduled_date::text FROM public.appointments WHERE barbershop_id = $1 AND status <> 'completed' ORDER BY created_at`,
    [fx.barbershopId],
  );
  return rows.rows;
}

describe("motor novo do agente", () => {
  beforeAll(async () => {
    expect(await dbAvailable()).toBe(true);
  });

  afterEach(async () => {
    for (const fx of fixtures.splice(0)) await deleteGoldenFixture(fx);
  });

  it("agenda do pedido ao aceite, com a redação livre da oferta", async () => {
    const fx = await fixture({ name: "Mateus" });
    const offer = await say(fx, "Corte amanhã às 15h com o Lucas", understood({
      primary: "schedule", service_id: fx.services.corte, barber_id: fx.barbers.lucas, date: fx.tomorrowIso, time: "15:00",
    }));
    expect(offer.reply).toContain("Corte masculino");
    expect(await appointments(fx)).toEqual([]);
    await pool.query(`UPDATE public.ai_messages SET content = 'Fechamos assim?' WHERE conversation_id = $1 AND role = 'assistant'`, [fx.conversationId]);

    const done = await say(fx, "bora", understood({ offer_response: "accept" }));
    expect(done.state).toBe("appointment_created");
    expect(await appointments(fx)).toMatchObject([{ status: "pending", scheduled_time: "15:00:00", scheduled_date: fx.tomorrowIso }]);
  });

  it("não duplica o agendamento quando o mesmo turno é reprocessado", async () => {
    const fx = await fixture({ name: "Mateus" });
    await say(fx, "Corte amanhã às 15h", understood({ primary: "schedule", service_id: fx.services.corte, barber_id: fx.barbers.lucas, date: fx.tomorrowIso, time: "15:00" }));
    await say(fx, "sim", understood({ offer_response: "accept" }));
    const saved = await pool.query(`SELECT agent_state FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [fx.conversationId]);
    const state = saved.rows[0].agent_state;
    state.value = "slot_offered";
    state.context = { ...state.context, service_ids: [fx.services.corte], service_name: "Corte masculino", barber_id: fx.barbers.lucas, barber_name: "Lucas Lima", date: fx.tomorrowIso, time: "15:00", offer_issued_ms: Date.now() };
    await pool.query(`UPDATE public.ai_conversation_runtime SET agent_state = $2::jsonb WHERE conversation_id = $1`, [fx.conversationId, JSON.stringify(state)]);

    const retry = await runAgentV2(fx.barbershopId, fx.conversationId, fx.clientPhone, noOpenAI, { interpret: scripted(understood({ offer_response: "accept" })), polish: false });
    expect(retry.state).toBe("appointment_created");
    expect(await appointments(fx)).toHaveLength(1);
  });

  it("oferece alternativa quando o horário está ocupado e não grava", async () => {
    const fx = await fixture({ name: "Mateus", upcoming: true });
    const other = await fixture({ name: "Outro" });
    await deleteGoldenFixture(other);
    fixtures.pop();
    const upcoming = (await appointments(fx))[0]!;
    const reply = await say(fx, "Quero barba no mesmo horário com o Eduardo", understood({
      primary: "schedule", service_id: fx.services.barba, barber_id: fx.barbers.eduardo, date: upcoming.scheduled_date, time: "18:00",
    }));
    expect(reply.state).toBeUndefined();
    expect(reply.reply).toContain("não está livre");
    expect(await appointments(fx)).toHaveLength(1);
  });

  it("remarca só depois do sim", async () => {
    const fx = await fixture({ name: "Mateus", upcoming: true });
    const offer = await say(fx, "Quero passar para amanhã às 15h", understood({ primary: "reschedule", date: fx.tomorrowIso, time: "15:00" }));
    expect(offer.reply).toContain("Quer que eu mude");
    expect((await appointments(fx))[0]).toMatchObject({ scheduled_time: "18:00:00" });
    const done = await say(fx, "Isso", understood({ offer_response: "accept" }));
    expect(done.state).toBe("appointment_rescheduled");
    expect((await appointments(fx))[0]).toMatchObject({ scheduled_time: "15:00:00", scheduled_date: fx.tomorrowIso });
  });

  it("cancela só depois da confirmação", async () => {
    const fx = await fixture({ name: "Mateus", upcoming: true });
    const asked = await say(fx, "Não vou poder ir", understood({ primary: "cancel" }));
    expect(asked.reply).toContain("Posso cancelar");
    expect((await appointments(fx))[0]?.status).toBe("pending");
    const done = await say(fx, "Pode", understood({ offer_response: "accept" }));
    expect(done.state).toBe("appointment_cancelled");
    expect((await appointments(fx))[0]?.status).toBe("cancelled");
  });

  it("confirma presença com lembrete em aberto", async () => {
    const fx = await fixture({ name: "Mateus", upcoming: true });
    await pool.query(
      `INSERT INTO public.agenda_activity (barbershop_id, appointment_id, conversation_id, type, actor, client_name, scheduled_date, scheduled_time, summary)
       VALUES ($1, $2, $3, 'reminder_sent', 'system', 'Mateus', $4::date, '18:00', 'reminder 24h')`,
      [fx.barbershopId, fx.upcomingAppointmentId, fx.conversationId, fx.tomorrowIso],
    );
    const done = await say(fx, "Estarei aí", understood({ primary: "presence" }));
    expect(done.state).toBe("appointment_confirmed");
    expect((await appointments(fx))[0]?.status).toBe("confirmed");
  });

  it("responde pergunta lateral sem perder a oferta", async () => {
    const fx = await fixture({ name: "Mateus" });
    await pool.query(`UPDATE public.barbershops SET pix_key = '45999990000' WHERE id = $1`, [fx.barbershopId]);
    await say(fx, "Corte amanhã às 15h", understood({ primary: "schedule", service_id: fx.services.corte, barber_id: fx.barbers.lucas, date: fx.tomorrowIso, time: "15:00" }));
    const pix = await say(fx, "Qual a chave pix?", understood({ primary: "payment" }));
    expect(pix.reply).toContain("45999990000");
    const done = await say(fx, "Sim", understood({ offer_response: "accept" }));
    expect(done.state).toBe("appointment_created");
  });

  it("pausa a conversa no pedido de atendimento humano", async () => {
    const fx = await fixture({ name: "Mateus" });
    const done = await say(fx, "Falar com a equipe", understood({ primary: "handoff" }));
    expect(done.state).toBe("handoff_requested");
    const paused = await pool.query(`SELECT paused_until FROM public.ai_conversation_runtime WHERE conversation_id = $1`, [fx.conversationId]);
    expect(paused.rows[0]?.paused_until).not.toBeNull();
  });

  it("usa as regras se o interpretador falhar", async () => {
    const fx = await fixture({ name: "Mateus", upcoming: true });
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', 'Quero cancelar')`, [fx.conversationId]);
    const result = await runAgentV2(fx.barbershopId, fx.conversationId, fx.clientPhone, noOpenAI, {
      interpret: async () => ({ interpretation: null, latencyMs: 1, error: "timeout" }),
      polish: false,
    });
    expect(result.reply).toContain("Posso cancelar");
  });

  it("mantém cada conversa no motor em que começou", async () => {
    const fx = await fixture({ name: "Mateus" });
    expect(await resolveAgentEngine(fx.barbershopId, fx.conversationId)).toBe("legacy");
    await pool.query(`UPDATE public.barbershop_ai_settings SET agent_engine = 'v2' WHERE barbershop_id = $1`, [fx.barbershopId]);
    expect(await resolveAgentEngine(fx.barbershopId, fx.conversationId)).toBe("legacy");
  });
});
