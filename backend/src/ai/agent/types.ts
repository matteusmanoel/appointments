/**
 * Domain types for the Understanding / Orchestrator / Composer pipeline.
 *
 * Architecture decision: docs/adr/0002-understanding-orchestrator-composer-separation.md
 * Domain glossary:       CONTEXT.md ##Agente
 */

// ── Intent ────────────────────────────────────────────────────────────────────

/**
 * Closed set of 12 intent types.
 * See CONTEXT.md > Intenção for resolution rules.
 */
export type IntentType =
  | "schedule"   // novo agendamento (inclui rota de memória)
  | "reschedule" // mudar horário existente (prevalece sobre cancel quando ambos presentes)
  | "cancel"     // cancelar sem pedir novo
  | "presence"   // resposta a lembrete de confirmação
  | "waitlist"   // pedir aviso quando vaga abrir
  | "payment"    // PIX, débito, comprovante
  | "plan"       // plano ou assinatura (não bloqueante)
  | "consult"    // consultar meus agendamentos
  | "location"   // onde fica
  | "hours"      // horário de funcionamento
  | "handoff"    // quer falar com humano
  | "unknown";   // não reconhecido → pergunta objetiva, nunca ação destrutiva

// ── Signals (outputs of Understanding, inputs to Orchestrator) ────────────────

export type BarberSignal =
  | { kind: "named"; name: string; id?: string }       // barbeiro conhecido no catálogo
  | { kind: "unknown_named"; name: string }             // nome mencionado, fora do catálogo
  | { kind: "any" }                                     // cliente aceitou qualquer barbeiro
  | null;                                               // não mencionado

export type ServiceSignal = {
  name: string;
  ids?: string[];
  confidence: number; // 0..1
};

export type DateTimeSignal = {
  date?: string;    // ISO YYYY-MM-DD
  time?: string;    // HH:MM
  relative?: string; // fonte: "amanha", "semana_que_vem", "weekday", etc.
} | null;

/**
 * Structured output of the Understanding phase.
 * Fields may be null / "ambiguous" — Orchestrator resolves.
 */
export type IntentSet = {
  intents: IntentType[];
  primary: IntentType;
  service: ServiceSignal | "ambiguous" | null;
  barber: BarberSignal;
  dateTime: DateTimeSignal;
  /** Client asked for the next free slot without naming a clock ("o próximo", "o mais cedo"). */
  wantsNextSlot?: boolean;
  /** Raw signals collected during extraction — used for debug/trace. */
  rawSignals: string[];
  /**
   * 0..1 confidence in the primary intent.
   * Below HANDOFF_LOW_CONFIDENCE_THRESHOLD triggers handoff after 2 consecutive turns.
   */
  confidence: number;
};

// ── Conversation state ────────────────────────────────────────────────────────

/**
 * Valid persistent conversation states.
 * See CONTEXT.md > Estado de conversa.
 * State only changes at Turno boundaries — never mid-turn.
 */
export type ConversationState =
  | "idle"                   // nenhuma ação pendente
  | "collecting"             // rascunho em construção, campos faltando
  | "awaiting_name"          // rascunho completo, aguardando confirmação de nome
  | "slot_offered"           // slot apresentado, aguardando aceite de slot
  | "plan_offered"           // Plano apresentado — NÃO BLOQUEANTE
  | "reminder_24h_pending"   // lembrete 24h enviado, aguardando confirmação
  | "reminder_2h_pending"    // lembrete 2h enviado, aguardando confirmação
  | "handoff"                // humano ativo, agente silencioso
  | "closed";                // conversa encerrada

// ── Turn outcomes ─────────────────────────────────────────────────────────────

/**
 * What the Orchestrator produced at the end of a Turno.
 * Logged in the trace; NOT persisted as ConversationState.
 * See CONTEXT.md > Resultado de Turno for state transitions.
 */
export type TurnResult =
  | "appointment_created"   // → idle
  | "appointment_updated"   // → idle
  | "appointment_cancelled" // → idle
  | "reminder_sent"         // → reminder_Xh_pending or idle
  | "reminder_confirmed"    // → idle
  | "plan_offered"          // → plan_offered
  | "handoff_triggered"     // → handoff
  | "name_confirmed";       // → next rascunho step

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Two consecutive turns with confidence below this threshold trigger handoff.
 * Named constant — never hardcode inline.
 * See CONTEXT.md > Estado de conversa > Regras determinísticas.
 */
export const HANDOFF_LOW_CONFIDENCE_THRESHOLD = 0.35;

/**
 * unknown intents with text length above this (and not a greeting) are logged
 * to backend/benchmark/suggestions/new-intents.jsonl for future type expansion.
 */
export const UNKNOWN_INTENT_LOG_TOKEN_THRESHOLD = 8;
