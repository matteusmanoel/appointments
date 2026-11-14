/**
 * Preenchimento determinístico dos fluxos básicos.
 * O código decide serviço, barbeiro, data, horário, tools e quando confirmar.
 * O LLM, neste corte, não escolhe tool: só entra se o fluxo não for básico
 * (ou, no futuro, para interpretar fala em slots quando as regras não bastarem
 * e para escrever a linguagem a partir de uma fala-modelo).
 */
import type { IntentType } from "./types.js";

export const BASIC_FLOW_INTENTS: ReadonlySet<IntentType> = new Set([
  "schedule",
  "reschedule",
  "cancel",
  "presence",
]);

/** Fala segura quando o fluxo básico não fecha o turno — nunca silêncio (exceto no teto de IA). */
export const BASIC_FLOW_SAFE_FALLBACK =
  "Me diz um horário que te atenda, ou a gente vê as próximas vagas.";

export type RuleSlots = {
  serviceText: string | null;
  barberText: string | null;
  date: string | null;
  time: string | null;
  afterTime: string | null;
};

export type SlotFillInput = {
  primaryIntent: IntentType | string;
  conversationState?: string;
  looksLikeConsult?: boolean;
  looksLikePix?: boolean;
  looksLikeLocation?: boolean;
  looksLikePlan?: boolean;
  looksLikeHumanHandoff?: boolean;
};

/**
 * Extrai slots só com regras (regex/catalogo ficam no understandTurn / draftPatchFromTurn).
 * Quando as regras não bastarem, o próximo corte pode pedir um parse ao LLM — não neste arquivo.
 */
export function extractSlotsFromIntent(input: {
  service?: string | null;
  barber?: string | null;
  date?: string | null;
  time?: string | null;
  afterTime?: string | null;
}): RuleSlots {
  return {
    serviceText: input.service ?? null,
    barberText: input.barber ?? null,
    date: input.date ?? null,
    time: input.time ?? null,
    afterTime: input.afterTime ?? null,
  };
}

export function isBasicBookingFlow(input: SlotFillInput): boolean {
  if (
    input.looksLikeConsult ||
    input.looksLikePix ||
    input.looksLikeLocation ||
    input.looksLikePlan ||
    input.looksLikeHumanHandoff
  ) {
    return false;
  }
  if (input.conversationState === "reminder_rsvp_pending") return true;
  return BASIC_FLOW_INTENTS.has(input.primaryIntent as IntentType);
}

export function shouldConfirmReminderPresence(input: {
  conversationState: string;
  isAffirmative: boolean;
  looksLikeCancel: boolean;
  looksLikeReschedule: boolean;
  looksLikeNewBooking: boolean;
}): boolean {
  return (
    input.conversationState === "reminder_rsvp_pending" &&
    input.isAffirmative &&
    !input.looksLikeCancel &&
    !input.looksLikeReschedule &&
    !input.looksLikeNewBooking
  );
}
