/**
 * Golden scenarios (Layer 2). Each Turn runs runAgent() against a real Postgres
 * fixture with a scripted OpenAI; contracts assert on turnTrace/state only.
 * Runner: ./golden/runner.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import {
  checkContracts,
  createGoldenFixture,
  dbAvailable,
  deleteGoldenFixture,
  runGoldenTurn,
  type GoldenFixture,
  type GoldenScenario,
} from "./golden/runner.js";

const SCENARIOS: GoldenScenario[] = [
  {
    id: "all_fields_one_turn",
    client: {},
    turns: [
      {
        user: "Mateus, quero corte e barba com o Lucas amanhã às 15h",
        llm: (fx) => [
          {
            tool: "check_availability",
            args: {
              date: fx.tomorrowIso,
              time: "15:00",
              barber_id: fx.barbers.lucas,
              service_ids: [fx.services.corteBarba],
            },
          },
        ],
        contracts: (fx) => [
          { kind: "intent_primary", equals: "schedule" },
          { kind: "intent_field", field: "time", equals: "15:00" },
          { kind: "name_source", equals: "leading_address" },
          { kind: "name_known", equals: true },
          { kind: "client_name", equals: "Mateus" },
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "catalog_rejections", equals: [] },
          { kind: "draft_status", equals: "offered" },
          { kind: "draft_service_ids", equals: [fx.services.corteBarba] },
          { kind: "draft_barber_id", equals: fx.barbers.lucas },
          { kind: "not_silenced" },
        ],
      },
    ],
  },
  {
    id: "partial_fields_memory_fills",
    client: { name: "Mateus", pastVisit: true },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: (fx) => [{ tool: "check_availability", args: { date: fx.tomorrowIso, time: "10:00" } }],
        contracts: (fx) => [
          { kind: "intent_primary", equals: "schedule" },
          { kind: "intent_field", field: "service", equals: null },
          { kind: "name_known", equals: true },
          { kind: "name_source", equals: null },
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "draft_service_ids", equals: [fx.services.corte] },
          { kind: "draft_status", equals: "offered" },
          { kind: "not_silenced" },
        ],
      },
    ],
  },
  {
    id: "unknown_barber_disclosure",
    client: { name: "Mateus" },
    turns: [
      {
        user: "Quero cortar amanhã às 15h com o Gabriel",
        llm: (fx) => [
          {
            tool: "check_availability",
            args: {
              date: fx.tomorrowIso,
              time: "15:00",
              barber_id: "00000000-0000-4000-8000-00000000abcd",
              service_ids: [fx.services.corte],
            },
          },
          { content: "Não temos o Gabriel por aqui. Posso ver com o Lucas ou o Eduardo?" },
        ],
        contracts: () => [
          { kind: "intent_primary", equals: "schedule" },
          { kind: "barber_disclosure", name: "Gabriel" },
          { kind: "routing_applied_includes", value: "barber_disclosure" },
          { kind: "catalog_rejections", equals: [{ tool: "check_availability", field: "barber_id" }] },
          { kind: "draft_barber_id", equals: null },
        ],
      },
    ],
  },
  {
    id: "reschedule_beats_cancel",
    client: { name: "Mateus", upcoming: true },
    turns: [
      {
        user: "Não vou conseguir ir no meu horário, preciso remarcar",
        llm: (fx) => [
          { tool: "cancel_appointment", args: { appointment_id: fx.upcomingAppointmentId } },
          { content: "Sem problema! Pra qual dia e horário você quer remarcar?" },
        ],
        contracts: (fx) => [
          { kind: "intent_primary", equals: "reschedule" },
          { kind: "intents_exclude", value: "cancel" },
          { kind: "routing_primary", equals: "reschedule" },
          { kind: "routing_applied_includes", value: "block_cancel_on_reschedule" },
          { kind: "tools_executed", equals: [{ name: "cancel_appointment", ok: false }] },
          { kind: "appointment_status", appointmentId: fx.upcomingAppointmentId!, equals: "pending" },
          { kind: "state", equals: null },
        ],
      },
    ],
  },
  {
    id: "multi_intent_sequence",
    client: { name: "Mateus" },
    turns: [
      {
        user: "Quero agendar um corte masculino amanhã às 15h com o Lucas e também queria saber dos planos",
        llm: (fx) => [
          {
            tool: "check_availability",
            args: {
              date: fx.tomorrowIso,
              time: "15:00",
              barber_id: fx.barbers.lucas,
              service_ids: [fx.services.corte],
            },
          },
        ],
        contracts: () => [
          { kind: "intent_primary", equals: "schedule" },
          { kind: "intents_include", value: "plan" },
          { kind: "routing_handle_now", equals: ["schedule"] },
          { kind: "routing_deferred", equals: ["plan"] },
          { kind: "routing_applied_includes", value: "defer_secondary" },
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "draft_status", equals: "offered" },
          { kind: "pending_intents", equals: { intents: ["plan"], offered: false } },
        ],
      },
      {
        user: "Sim",
        llm: (fx) => [
          {
            tool: "create_appointment",
            args: {
              date: fx.tomorrowIso,
              time: "15:00",
              barber_id: fx.barbers.lucas,
              service_ids: [fx.services.corte],
              client_name: "Mateus",
            },
          },
        ],
        contracts: () => [
          { kind: "state", equals: "appointment_created" },
          { kind: "routing_applied_excludes", value: "resume_pending" },
          { kind: "tools_executed", equals: [{ name: "create_appointment", ok: true }] },
          { kind: "pending_intents", equals: { intents: ["plan"], offered: true } },
        ],
      },
      {
        user: "Sim",
        llm: () => [{ tool: "list_plans", args: {} }, { content: "Temos estes planos." }],
        contracts: () => [
          { kind: "routing_primary", equals: "plan" },
          { kind: "routing_applied_includes", value: "resume_pending" },
          { kind: "tools_executed", equals: [{ name: "list_plans", ok: true }] },
          { kind: "state", equals: null },
          { kind: "pending_intents", equals: { intents: [], offered: false } },
        ],
      },
    ],
  },
  {
    id: "booking_failure_hands_off",
    client: { name: "Mateus" },
    prepare: async (fx) => {
      const other = await pool.query<{ id: string }>(
        `INSERT INTO public.clients (barbershop_id, name, phone) VALUES ($1, 'Outro', $2) RETURNING id`,
        [fx.barbershopId, `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`],
      );
      await pool.query(
        `INSERT INTO public.appointments
           (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
         VALUES ($1, $2, $3, $4, $5::date, '15:00', 60, 55, 20, 'pending')`,
        [fx.barbershopId, other.rows[0]!.id, fx.barbers.lucas, fx.services.corteBarba, fx.tomorrowIso],
      );
      await pool.query(
        `INSERT INTO public.ai_conversation_runtime (conversation_id, booking_draft, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (conversation_id) DO UPDATE SET booking_draft = $2::jsonb, updated_at = now()`,
        [
          fx.conversationId,
          JSON.stringify({
            status: "offered",
            service_ids: [fx.services.corteBarba],
            service_name: "Corte e Barba",
            barber_id: fx.barbers.lucas,
            barber_name: "Lucas Lima",
            date: fx.tomorrowIso,
            time: "15:00",
            total_price: 55,
          }),
        ],
      );
    },
    turns: [
      {
        user: "Sim",
        llm: () => [
          { tool: "create_appointment", args: { client_name: "Mateus" } },
          { content: "Esse horário não está disponível. Tenho às 14h30 ou às 15h30." },
        ],
        contracts: () => [
          { kind: "state", equals: "handoff_requested" },
          { kind: "tools_executed", equals: [{ name: "create_appointment", ok: false }] },
          { kind: "openai_rounds", equals: 1 },
          { kind: "routing_applied_includes", value: "action_failed_handoff" },
          { kind: "activity_includes", value: "tool_error_escalated" },
        ],
      },
    ],
  },
  {
    id: "schedule_checks_before_draft",
    client: {},
    turns: [
      {
        user: "Gostaria de agendar um horário para Corte e Barba com Lucas amanhã às 15",
        llm: () => [{ content: "O horário das 15h não está disponível. Tenho às 14h30 ou às 15h30." }],
        contracts: (fx) => [
          { kind: "state", equals: null },
          { kind: "routing_applied_includes", value: "check_before_draft" },
          { kind: "routing_applied_excludes", value: "action_failed_handoff" },
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "openai_rounds", equals: 1 },
          { kind: "draft_status", equals: "awaiting_name" },
          { kind: "draft_service_ids", equals: [fx.services.corteBarba] },
          { kind: "draft_barber_id", equals: fx.barbers.lucas },
        ],
      },
    ],
  },
  {
    id: "name_closes_with_conversation_phone",
    client: {},
    prepare: async (fx) => {
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
        [fx.conversationId, "Para confirmar, qual seu nome?"],
      );
      await pool.query(
        `INSERT INTO public.ai_conversation_runtime (conversation_id, booking_draft, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (conversation_id) DO UPDATE SET booking_draft = $2::jsonb, updated_at = now()`,
        [
          fx.conversationId,
          JSON.stringify({
            status: "awaiting_name",
            service_ids: [fx.services.corteBarba],
            service_name: "Corte e Barba",
            barber_id: fx.barbers.lucas,
            barber_name: "Lucas Lima",
            date: fx.tomorrowIso,
            time: "15:00",
            total_price: 55,
          }),
        ],
      );
    },
    turns: [
      {
        user: "Mateus",
        llm: () => [{ tool: "create_appointment", args: { client_phone: "", client_name: "Mateus" } }],
        contracts: () => [
          { kind: "state", equals: "appointment_created" },
          { kind: "tools_executed", equals: [{ name: "create_appointment", ok: true }] },
          { kind: "openai_rounds", equals: 1 },
          { kind: "routing_applied_excludes", value: "action_failed_handoff" },
          { kind: "client_name", equals: "Mateus" },
        ],
      },
    ],
  },
];

for (const scenario of SCENARIOS) {
  describe(`golden: ${scenario.id}`, () => {
    let ok = false;
    let fx: GoldenFixture | null = null;

    beforeAll(async () => {
      ok = await dbAvailable();
      if (!ok) return;
      fx = await createGoldenFixture(scenario.id, scenario.client);
      if (scenario.prepare) await scenario.prepare(fx);
    });

    afterAll(async () => {
      if (fx) await deleteGoldenFixture(fx);
    });

    it("honors every turn contract", async () => {
      if (!ok || !fx) return;
      for (const [index, turn] of scenario.turns.entries()) {
        const outcome = await runGoldenTurn(fx, turn);
        const failures = checkContracts(outcome, turn.contracts(fx));
        expect({ turn: index + 1, user: turn.user, failures }).toEqual({
          turn: index + 1,
          user: turn.user,
          failures: [],
        });
      }
    }, 60_000);
  });
}
