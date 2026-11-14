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
    // Contrato (CONTEXT.md, "Serviço" e "Rascunho"): cliente que volta recebe "Vai ser o de sempre, X?" e o serviço
    // só entra no rascunho no "sim". A memória NÃO preenche o serviço sozinha e a pergunta não fica aberta.
    id: "recurring_client_suggests_usual_service_then_yes",
    client: { name: "Mateus", pastVisit: true },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: () => [],
        contracts: (fx) => [
          { kind: "intent_primary", equals: "schedule" },
          { kind: "intent_field", field: "service", equals: null },
          { kind: "name_known", equals: true },
          { kind: "name_source", equals: null },
          { kind: "tools_executed", equals: [] },
          // sugere, não preenche
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_proposal_service_ids", equals: [fx.services.corte] },
          { kind: "draft_last_question", equals: "usual_service" },
          { kind: "reply_includes", value: "Vai ser o de sempre, *Corte masculino*?" },
          { kind: "draft_status", equals: "collecting" },
          { kind: "openai_rounds", equals: 0 },
          { kind: "state", equals: null },
          { kind: "not_silenced" },
        ],
      },
      {
        // O "sim" aceita a sugestão: o serviço entra no rascunho e a agenda é conferida; nada é gravado sem o aceite do horário.
        user: "Sim",
        llm: (fx) => [
          {
            tool: "check_availability",
            args: { date: fx.tomorrowIso, time: "10:00", barber_id: fx.barbers.eduardo, service_ids: [fx.services.corte] },
          },
        ],
        contracts: (fx) => [
          { kind: "draft_service_ids", equals: [fx.services.corte] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "draft_last_question", equals: null },
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "draft_status", equals: "offered" },
          { kind: "state", equals: null },
        ],
      },
    ],
  },
  {
    // "Não" ao de sempre: pergunta qual serviço (sem sugerir de novo, sem preencher nada); o serviço dito depois segue o fluxo.
    id: "recurring_client_refuses_usual_service_picks_another",
    client: { name: "Mateus", pastVisit: true },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_last_question", equals: "usual_service" },
          { kind: "openai_rounds", equals: 0 },
        ],
      },
      {
        user: "Não",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "draft_last_question", equals: "service" },
          { kind: "reply_includes", value: "Qual serviço deseja?" },
          { kind: "reply_excludes", value: "de sempre" },
          { kind: "tools_executed", equals: [] },
          { kind: "openai_rounds", equals: 0 },
          { kind: "state", equals: null },
        ],
      },
      {
        user: "Quero corte e barba",
        llm: (fx) => [
          {
            tool: "check_availability",
            args: { date: fx.tomorrowIso, time: "10:00", service_ids: [fx.services.corteBarba] },
          },
        ],
        contracts: (fx) => [
          { kind: "draft_service_ids", equals: [fx.services.corteBarba] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "state", equals: null },
        ],
      },
    ],
  },
  {
    // O "sim" é da sugestão, só do turno imediatamente seguinte: sugestão -> outra pergunta -> "sim" não aplica o de sempre.
    id: "usual_service_yes_after_other_question_does_not_apply",
    client: { name: "Mateus", pastVisit: true },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: () => [],
        contracts: () => [
          { kind: "draft_last_question", equals: "usual_service" },
          { kind: "draft_usual_suggested", equals: true },
        ],
      },
      {
        user: "Vocês abrem no sábado?",
        llm: () => [{ content: "Abrimos sim, das 9h às 20h." }],
        contracts: () => [
          // a proposta não sobrevive a um turno que não respondeu a ela
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "draft_last_question", equals: null },
          { kind: "draft_service_ids", equals: [] },
        ],
      },
      {
        user: "Pode contar comigo",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "tools_executed", equals: [] },
          { kind: "reply_excludes", value: "Posso confirmar" },
        ],
      },
    ],
  },
  {
    // Rascunho velho com a proposta, mas a última fala do agente não foi a sugestão: o "sim" não a aceita.
    id: "usual_service_stale_proposal_is_not_accepted",
    client: { name: "Mateus", pastVisit: true },
    prepare: async (fx) => {
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
        [fx.conversationId, "Qual hora você prefere?"],
      );
      await pool.query(
        `INSERT INTO public.ai_conversation_runtime (conversation_id, booking_draft, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (conversation_id) DO UPDATE SET booking_draft = $2::jsonb, updated_at = now()`,
        [
          fx.conversationId,
          JSON.stringify({
            status: "collecting",
            date: fx.tomorrowIso,
            time: "10:00",
            lastAgentQuestion: "usual_service",
            usualSuggested: true,
            pendingProposal: { service_ids: [fx.services.corte], service_name: "Corte masculino" },
          }),
        ],
      );
    },
    turns: [
      {
        user: "Sim",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "tools_executed", equals: [] },
        ],
      },
    ],
  },
  {
    // "Não sugerir de novo" dura o agendamento todo: depois da recusa, dizer só dia/hora outra vez não repete a sugestão.
    id: "usual_service_refusal_persists_for_the_booking",
    client: { name: "Mateus", pastVisit: true },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: () => [],
        contracts: () => [{ kind: "draft_last_question", equals: "usual_service" }],
      },
      {
        user: "Não",
        llm: () => [],
        contracts: () => [
          { kind: "draft_usual_suggested", equals: true },
          { kind: "reply_excludes", value: "de sempre" },
        ],
      },
      {
        user: "então amanhã às 15h",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "reply_includes", value: "Qual serviço deseja?" },
          { kind: "reply_excludes", value: "de sempre" },
          { kind: "openai_rounds", equals: 0 },
        ],
      },
    ],
  },
  {
    // Resposta que não é sim nem recusa da lista ("não sei"): também não aceita e não repete a sugestão.
    id: "usual_service_vague_answer_does_not_repeat_suggestion",
    client: { name: "Mateus", pastVisit: true },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: () => [],
        contracts: () => [{ kind: "draft_last_question", equals: "usual_service" }],
      },
      {
        user: "não sei ainda",
        llm: () => [{ content: "Sem pressa." }],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "draft_usual_suggested", equals: true },
        ],
      },
      {
        user: "pode ser amanhã às 15h",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "reply_excludes", value: "de sempre" },
        ],
      },
    ],
  },
  {
    // Cliente sem histórico: continua a pergunta simples, sem "o de sempre".
    id: "first_contact_asks_service_without_usual",
    client: { name: "Mateus" },
    turns: [
      {
        user: "Quero marcar amanhã às 10h",
        llm: () => [],
        contracts: () => [
          { kind: "draft_service_ids", equals: [] },
          { kind: "draft_proposal_service_ids", equals: [] },
          { kind: "draft_last_question", equals: "service" },
          { kind: "reply_includes", value: "Qual serviço deseja?" },
          { kind: "reply_excludes", value: "de sempre" },
          { kind: "openai_rounds", equals: 0 },
        ],
      },
    ],
  },
  {
    id: "unknown_barber_disclosure",
    client: { name: "Mateus" },
    turns: [
      {
        // "Corte masculino" explícito: "cortar" sozinho é ambíguo (corte simples x combo) e o turno só pergunta isso,
        // sem liberar check_availability. Aqui o contrato é o barbeiro fora do catálogo.
        user: "Quero um corte masculino amanhã às 15h com o Gabriel",
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
          // O barbeiro inventado é descartado e o turno só confere a agenda; o substituto (outro barbeiro do
          // catálogo) é apenas OFERECIDO ("Posso confirmar?"), nada é gravado sem o aceite.
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "draft_status", equals: "offered" },
          { kind: "state", equals: null },
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
          // Sem hora nova o turno só pergunta a hora: cancel_appointment nem entra na lista de tools do turno.
          { kind: "tools_executed", equals: [] },
          { kind: "openai_rounds", equals: 0 },
          { kind: "appointment_status", appointmentId: fx.upcomingAppointmentId!, equals: "pending" },
          { kind: "state", equals: null },
        ],
      },
    ],
  },
  {
    // Com hora nova o turno chega a conferir a agenda; se o modelo ainda pedir cancel_appointment,
    // a tool está fora da lista do turno e o horário atual continua intacto.
    id: "reschedule_with_clock_refuses_cancel",
    client: { name: "Mateus", upcoming: true },
    turns: [
      {
        user: "Preciso remarcar, pode ser amanhã às 10h?",
        llm: (fx) => [
          { tool: "cancel_appointment", args: { appointment_id: fx.upcomingAppointmentId } },
          { content: "Vou ver esse horário pra você." },
        ],
        contracts: (fx) => [
          { kind: "intent_primary", equals: "reschedule" },
          { kind: "intents_exclude", value: "cancel" },
          { kind: "routing_primary", equals: "reschedule" },
          { kind: "routing_applied_includes", value: "tool_not_in_plan" },
          { kind: "routing_applied_includes", value: "check_before_draft" },
          {
            kind: "tools_executed",
            equals: [
              { name: "cancel_appointment", ok: false },
              { name: "check_availability", ok: true },
            ],
          },
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
    // Horário ocupado ao gravar não é falha técnica: o turno confere a agenda e oferece uma hora livre do mesmo
    // barbeiro, sem handoff (CONTEXT.md "Fato do turno"; golden g05 forbid "Encaminhar para atendente").
    id: "booking_failure_offers_free_hour",
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
          { kind: "state", equals: null },
          {
            kind: "tools_executed",
            equals: [
              { name: "create_appointment", ok: false },
              { name: "check_availability", ok: true },
            ],
          },
          { kind: "openai_rounds", equals: 0 },
          { kind: "draft_status", equals: "offered" },
          { kind: "draft_time_not", value: "15:00" },
        ],
      },
      {
        // O "sim" aceita a hora oferecida: grava a hora livre, não repete a ocupada.
        user: "Sim",
        llm: () => [],
        contracts: () => [
          { kind: "state", equals: "appointment_created" },
          { kind: "tools_executed", equals: [{ name: "create_appointment", ok: true }] },
          { kind: "openai_rounds", equals: 0 },
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
          // O check roda no próprio turno, antes de qualquer rascunho/fala (sem chamar o modelo).
          { kind: "tools_executed", equals: [{ name: "check_availability", ok: true }] },
          { kind: "openai_rounds", equals: 0 },
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
          // Ação decidida: texto fixo, sem chamada ao modelo (agente-contrato-nao-roteiro.mdc).
          { kind: "openai_rounds", equals: 0 },
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
