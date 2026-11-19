/**
 * Falhas vistas em benchmark/real-conversations.md, rodadas contra o agente completo.
 * `line` aponta a fala do cliente nessa conversa. `knownGap` marca o que o agente ainda erra:
 * o teste fica verde enquanto o erro existe e avisa quando ele for corrigido.
 */
import { pool } from "../../../db.js";
import type { GoldenFixture, GoldenScenario } from "./runner.js";

export type RealConversationCase = GoldenScenario & { line: number; knownGap?: string };

async function reminderSent(fx: GoldenFixture): Promise<void> {
  await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
    fx.conversationId,
    "Fala, Mateus! Seu horário está reservado. *Você confirma sua presença ou prefere reagendar?*",
  ]);
  await pool.query(
    `INSERT INTO public.agenda_activity
       (barbershop_id, appointment_id, conversation_id, type, actor, client_name, scheduled_date, scheduled_time, summary)
     VALUES ($1, $2, $3, 'reminder_sent', 'system', 'Mateus', $4::date, '18:00', 'reminder 24h')`,
    [fx.barbershopId, fx.upcomingAppointmentId, fx.conversationId, fx.tomorrowIso],
  );
}

async function shopHasPix(fx: GoldenFixture): Promise<void> {
  await pool.query(`UPDATE public.barbershops SET pix_key = '45999990000' WHERE id = $1`, [fx.barbershopId]);
}

const presence = (id: string, line: number, user: string): RealConversationCase => ({
  id,
  line,
  client: { name: "Mateus", upcoming: true },
  prepare: reminderSent,
  turns: [
    {
      user,
      llm: () => [],
      contracts: (fx) => [
        { kind: "state", equals: "appointment_confirmed" },
        { kind: "appointment_status", appointmentId: fx.upcomingAppointmentId!, equals: "confirmed" },
        { kind: "reply_excludes", value: "Qual serviço" },
      ],
    },
  ],
});

const cancelOffer = (id: string, line: number, user: string): RealConversationCase => ({
  id,
  line,
  client: { name: "Mateus", upcoming: true },
  turns: [
    {
      user,
      llm: () => [],
      contracts: (fx) => [
        { kind: "routing_primary", equals: "cancel" },
        { kind: "reply_includes", value: "Posso cancelar seu horário" },
        { kind: "appointment_status", appointmentId: fx.upcomingAppointmentId!, equals: "pending" },
      ],
    },
  ],
});

const routed = (
  id: string,
  line: number,
  user: string,
  primary: string,
  client: GoldenScenario["client"] = { name: "Mateus", upcoming: true },
): RealConversationCase => ({
  id,
  line,
  client,
  turns: [{ user, llm: () => [{ content: "Certo." }], contracts: () => [{ kind: "routing_primary", equals: primary }] }],
});

const CASES: RealConversationCase[] = [
  presence("real_presence_estarei_ai", 724, "Estarei aí"),
  presence("real_presence_vou_sim", 768, "Vou sim"),
  presence("real_presence_pode_confirmar", 830, "Pode confirmar minha presença"),
  cancelOffer("real_cancel_imprevisto", 62, "Surgiu um imprevisto, não vou poder ir"),
  cancelOffer("real_cancel_nao_poderei", 666, "Não poderei ir"),
  {
    id: "real_usual_service_yes_does_not_loop",
    line: 781,
    client: { name: "Mateus", pastVisit: true },
    turns: [
      { user: "Quero agendar", llm: () => [], contracts: () => [{ kind: "draft_last_question", equals: "usual_service" }] },
      {
        user: "Isso mesmo",
        llm: () => [{ content: "Qual dia e horário fica bom?" }],
        contracts: (fx) => [
          { kind: "draft_service_ids", equals: [fx.services.corte] },
          { kind: "reply_excludes", value: "Qual serviço" },
        ],
      },
    ],
  },
  {
    id: "real_pix_polite_sends_key",
    line: 623,
    client: { name: "Mateus", upcoming: true },
    prepare: shopHasPix,
    turns: [
      {
        user: "A chave PIX, por gentileza.",
        llm: () => [],
        contracts: () => [
          { kind: "tools_executed_includes", value: { name: "send_shop_pix", ok: true } },
          { kind: "reply_includes", value: "45999990000" },
          { kind: "reply_excludes", value: "Qual serviço" },
        ],
      },
    ],
  },
  {
    id: "real_consult_answers_the_time",
    line: 413,
    client: { name: "Mateus", upcoming: true },
    turns: [
      {
        user: "Gostaria de consultar meu horário, pra quando ficou mesmo?",
        llm: () => [],
        contracts: () => [
          { kind: "routing_primary", equals: "consult" },
          { kind: "reply_includes", value: "18h" },
          { kind: "state", equals: null },
        ],
      },
    ],
  },
  {
    id: "real_reschedule_yes_writes",
    line: 629,
    client: { name: "Mateus", upcoming: true },
    turns: [
      {
        user: "Quero reagendar para amanha as 15h",
        llm: () => [],
        contracts: () => [{ kind: "routing_primary", equals: "reschedule" }, { kind: "draft_status", equals: "offered" }],
      },
      { user: "Sim", llm: () => [], contracts: () => [{ kind: "state", equals: "appointment_rescheduled" }] },
    ],
  },
  {
    id: "real_reschedule_first_slot_moves_the_clock",
    line: 707,
    client: { name: "Mateus", upcoming: true },
    turns: [
      {
        user: "Quero reagendar para amanha no primeiro horário, é possível?",
        llm: () => [],
        contracts: () => [{ kind: "routing_primary", equals: "reschedule" }, { kind: "draft_time_not", value: "18:00" }],
      },
    ],
  },
  routed("real_reschedule_adjust_wording", 399, "Pode só ajustar o servico de corte e barba as 18h para amanhã, terça-feira", "reschedule"),
  routed("real_handoff_team", 609, "Falar com a equipe", "handoff"),
  routed("real_hours_open_tomorrow", 165, "Vocês abrem amanha?", "hours", {}),
  routed("real_schedule_named_barber_question", 347, "O lucas pode me atender hoje as 18?", "schedule", {}),
  routed("real_schedule_haircut_need", 440, "Preciso cortar meu cabelo", "schedule", {}),
  routed("real_waitlist_notify_when_free", 848, "Vou precisar que seja neste horario das 18:30, se o Lucas liberar me avise.", "waitlist"),
];

const KNOWN_GAPS: Record<string, string> = {
  real_presence_pode_confirmar: "ainda não confirma presença pedida com outras palavras",
  real_reschedule_adjust_wording: "ainda lê ajuste de horário como agendamento novo",
  real_handoff_team: "ainda não entende pedido para falar com a equipe",
  real_hours_open_tomorrow: "ainda não entende pergunta sobre abrir amanhã",
  real_schedule_named_barber_question: "ainda não entende pedido feito como pergunta sobre o barbeiro",
  real_schedule_haircut_need: "ainda não entende necessidade de corte sem verbo de agendar",
};

export const REAL_CONVERSATION_CASES: RealConversationCase[] = CASES.map((item) => ({
  ...item,
  ...(KNOWN_GAPS[item.id] ? { knownGap: KNOWN_GAPS[item.id] } : {}),
}));
