/**
 * Understanding phase — V1: deterministic extraction, zero extra latency.
 *
 * Extracts IntentSet from the current Turno using catalog-aware functions.
 * Does NOT consult DB, does NOT call LLM, does NOT apply business rules.
 *
 * V2 will replace the core with a structured LLM call for semantic generalization
 * (e.g., "Gostaria de reagendar com Lucas" without keyword triggers).
 *
 * See docs/adr/0002-understanding-orchestrator-composer-separation.md
 * See CONTEXT.md > Intenção for the closed type set and resolution rules.
 */

import type { CatalogBarber, CatalogService } from "../booking-draft.js";
import {
  resolveServiceFromText,
  resolveBarberFromText,
  unknownNamedBarberFromText,
} from "../booking-draft.js";
import {
  acceptsAnyBarber,
  isClientConfirmation,
  isShopHoursQuestion,
  looksLikeCancelIntent,
  looksLikeConsultIntent,
  looksLikeFormalMessage,
  looksLikeHumanHandoff,
  looksLikeLocationIntent,
  looksLikeNewBookingIntent,
  looksLikePixIntent,
  looksLikePlanIntent,
  looksLikeRescheduleIntent,
  looksLikeSocialGreeting,
  looksLikeWaitlistIntent,
} from "../conversation-intents.js";
import { parseClientTime, resolveClientDateFromText } from "../date-calendar.js";
import type {
  BarberSignal,
  ConversationState,
  IntentSet,
  IntentType,
  ServiceSignal,
} from "./types.js";
import { HANDOFF_LOW_CONFIDENCE_THRESHOLD, UNKNOWN_INTENT_LOG_TOKEN_THRESHOLD } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type UnderstandTurnParams = {
  text: string;
  todayIso: string;
  services: CatalogService[];
  barbers: CatalogBarber[];
  /** Current persistent conversation state — used to resolve ambiguous confirmations. */
  previousState: ConversationState;
  /** Conversation ID — used for logging unknown intents. */
  conversationId?: string;
};

/**
 * Deterministic intent extraction from a single client turn.
 *
 * Responsibilities (Understanding only):
 *   - Extract linguistic signals: service name, barber name, date/time, intent keywords
 *   - Classify intent type from the closed set
 *   - Apply intent resolution rules (reschedule beats cancel)
 *   - Flag unknown intents for logging
 *
 * NOT responsible for (Orchestrator handles):
 *   - Deciding what to do when data is missing
 *   - Applying business rules (e.g., check catalog for combos)
 *   - State transitions
 *   - Handoff decisions
 */
export function understandTurn(params: UnderstandTurnParams): IntentSet {
  const { text, todayIso, services, barbers, previousState, conversationId } = params;
  const rawSignals: string[] = [];

  // ── 1. Intent detection (boolean signals) ─────────────────────────────────
  const detected: IntentType[] = [];

  if (looksLikeCancelIntent(text)) { detected.push("cancel"); rawSignals.push("cancel"); }
  if (looksLikeRescheduleIntent(text)) { detected.push("reschedule"); rawSignals.push("reschedule"); }
  if (looksLikeNewBookingIntent(text)) { detected.push("schedule"); rawSignals.push("schedule"); }
  if (looksLikePixIntent(text)) { detected.push("payment"); rawSignals.push("payment"); }
  if (looksLikePlanIntent(text)) { detected.push("plan"); rawSignals.push("plan"); }
  if (looksLikeLocationIntent(text)) { detected.push("location"); rawSignals.push("location"); }
  if (looksLikeWaitlistIntent(text)) { detected.push("waitlist"); rawSignals.push("waitlist"); }
  if (looksLikeConsultIntent(text)) { detected.push("consult"); rawSignals.push("consult"); }
  if (looksLikeHumanHandoff(text)) { detected.push("handoff"); rawSignals.push("handoff"); }
  if (isShopHoursQuestion(text)) { detected.push("hours"); rawSignals.push("hours"); }

  // Presence is only a reminder RSVP. Affirmation on an offered slot accepts that offer.
  const isConfirmationTurn =
    isClientConfirmation(text) &&
    (previousState === "reminder_24h_pending" || previousState === "reminder_2h_pending");
  if (isConfirmationTurn) { detected.push("presence"); rawSignals.push("presence"); }

  // ── 2. Resolution rules ───────────────────────────────────────────────────
  const intents = applyIntentResolutionRules(detected);
  let primary: IntentType = intents[0] ?? "unknown";

  // ── 3. Service extraction ─────────────────────────────────────────────────
  let service: ServiceSignal | "ambiguous" | null = null;
  if (services.length > 0) {
    const resolved = resolveServiceFromText(text, services);
    if (resolved.ambiguous) {
      service = "ambiguous";
      rawSignals.push("service:ambiguous");
    } else if (resolved.match) {
      service = {
        name: resolved.match.name,
        ids: [resolved.match.id],
        confidence: 0.85,
      };
      rawSignals.push(`service:${resolved.match.name}`);
    }
  }

  // ── 4. Barber extraction ──────────────────────────────────────────────────
  const unknownBarber = unknownNamedBarberFromText(text, barbers);
  const knownBarber = !unknownBarber ? resolveBarberFromText(text, barbers) : undefined;
  let barber: BarberSignal = null;
  if (unknownBarber) {
    barber = { kind: "unknown_named", name: unknownBarber };
    rawSignals.push(`barber:unknown:${unknownBarber}`);
  } else if (knownBarber) {
    barber = { kind: "named", name: knownBarber.name, id: knownBarber.id };
    rawSignals.push(`barber:${knownBarber.name}`);
  } else if (acceptsAnyBarber(text)) {
    barber = { kind: "any" };
    rawSignals.push("barber:any");
  }

  // ── 5. DateTime extraction ────────────────────────────────────────────────
  const timeStr = parseClientTime(text);
  const dateResolved = resolveClientDateFromText(text, todayIso);
  const dateTime =
    timeStr || dateResolved
      ? {
          time: timeStr ?? undefined,
          date: dateResolved?.date ?? undefined,
          relative: dateResolved ? String(dateResolved.source) : undefined,
        }
      : null;
  if (timeStr) rawSignals.push(`time:${timeStr}`);
  if (dateResolved) rawSignals.push(`date:${dateResolved.date}`);

  // A named catalog service plus a clock is a booking. No booking verb required.
  if (primary === "unknown" && service != null && (dateTime?.time || dateTime?.date)) {
    intents.splice(0, intents.length, "schedule");
    primary = "schedule";
    rawSignals.push("schedule:clock");
  }

  // "Gostaria de" is a booking only when this turn names a slot.
  // A PIX, address, or plan request with no slot is that request, not a new hour.
  const namedSlot = Boolean((service && service !== "ambiguous") || dateTime?.time || dateTime?.date);
  const side = (["payment", "location", "plan"] as const).find((kind) => intents.includes(kind));
  if (!namedSlot && side && intents.includes("schedule")) {
    const rest = intents.filter((kind) => kind !== "schedule" && kind !== side);
    intents.splice(0, intents.length, side, ...rest);
    primary = side;
    rawSignals.push(`${side}:not_a_booking`);
  }

  // ── 6. Confidence ─────────────────────────────────────────────────────────
  const isNonAction = looksLikeSocialGreeting(text) || looksLikeFormalMessage(text);
  const confidence =
    primary === "unknown" && !isNonAction
      ? 0.1  // non-greeting unknown → potential new intent type
      : primary === "unknown" && isNonAction
        ? 0.65 // greeting-like → probably just social, not low-confidence
        : 0.8;

  // ── 7. Log unknown non-greeting intents for future type expansion ─────────
  if (
    primary === "unknown" &&
    !isNonAction &&
    text.trim().split(/\s+/).length > UNKNOWN_INTENT_LOG_TOKEN_THRESHOLD
  ) {
    logUnknownIntent({ text, conversationId }).catch(() => {});
  }

  return {
    intents,
    primary,
    service,
    barber,
    dateTime,
    rawSignals,
    confidence,
  };
}

/**
 * Applies deterministic resolution rules to a raw list of detected intents.
 *
 * Rules (see CONTEXT.md > Intenção):
 *   - reschedule + cancel → reschedule wins (cancel is implicit in reschedule)
 *   - Empty → ["unknown"]
 */
export function applyIntentResolutionRules(intents: IntentType[]): IntentType[] {
  if (!intents.length) return ["unknown"];

  // reschedule beats cancel: client says "não posso ir, pode mudar?" → reschedule, not cancel
  if (intents.includes("reschedule") && intents.includes("cancel")) {
    return intents.filter((i) => i !== "cancel");
  }

  return intents;
}

/**
 * Returns true when two consecutive turns had confidence below the handoff threshold.
 * Caller must supply previousTurnConfidence from persistent storage (V2: from DB).
 */
export function shouldHandoffByConfidence(
  currentConfidence: number,
  previousTurnConfidence: number | undefined,
): boolean {
  return (
    currentConfidence < HANDOFF_LOW_CONFIDENCE_THRESHOLD &&
    previousTurnConfidence !== undefined &&
    previousTurnConfidence < HANDOFF_LOW_CONFIDENCE_THRESHOLD
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function logUnknownIntent(params: {
  text: string;
  conversationId?: string;
}): Promise<void> {
  try {
    const suggestionsDir = path.resolve(
      fileURLToPath(new URL("../../../../..", import.meta.url)),
      "benchmark/suggestions",
    );
    fs.mkdirSync(suggestionsDir, { recursive: true });
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      conversation_id: params.conversationId ?? null,
      turn_text: params.text.slice(0, 512),
      suggested_intent: null,
      confidence_floor: 0.0,
    });
    fs.appendFileSync(path.join(suggestionsDir, "new-intents.jsonl"), entry + "\n", "utf8");
  } catch {
    // Non-fatal — logging failure must not affect agent response
  }
}
