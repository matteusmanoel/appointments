/**
 * Orchestrator phase — deterministic routing rules, no LLM.
 *
 * Receives IntentSet from Understanding + current ConversationState.
 * Returns OrchestratorRouting — decisions the agent loop and composer consume.
 *
 * Responsibilities (Orchestrator only):
 *   - Apply domain rules: cancel→reschedule, plan_offered non-blocking, handoff trigger
 *   - Require barber substitution disclosure when unknown barber was named
 *   - Guard cancel when no upcoming appointment exists
 *   - Detect low-confidence handoff (needs previous turn confidence from DB in V2)
 *
 * NOT responsible for:
 *   - Language understanding (Understanding phase)
 *   - Composing replies (Composer phase)
 *   - Tool execution (agent loop)
 *
 * See docs/adr/0002-understanding-orchestrator-composer-separation.md
 * See CONTEXT.md > Estado de conversa
 */

import type { ConversationState, IntentSet, IntentType } from "./types.js";
import type { PendingIntents } from "./pending-intents.js";
import { shouldHandoffByConfidence } from "./understanding.js";

export type OrchestratorInput = {
  intentSet: IntentSet;
  conversationState: ConversationState;
  /** Confidence of the immediately preceding turn. V2: read from DB. */
  previousTurnConfidence?: number;
  /** True if client has at least one upcoming appointment. */
  hasUpcomingAppointment: boolean;
  /** True if there is an active booking draft with at least service or barber set. */
  hasActiveBookingDraft: boolean;
  /** Intents postponed on earlier turns (persisted per conversation). */
  pendingIntents?: PendingIntents;
  /** Current turn is a bare affirmation ("sim", "pode", "quero"). */
  isAffirmative?: boolean;
  /** Previous turn offered the waitlist for a complete clock. */
  waitlistOfferOpen?: boolean;
  /** Person stated their name (not the WhatsApp contact label). */
  hasPersonName?: boolean;
  /** The name was said in this message, not only stored from before. */
  nameStatedThisTurn?: boolean;
  /** Client already has an active plan subscription. */
  hasActiveSubscription?: boolean;
  /** Aligned clock already on the draft, or spoken this turn. */
  carriedClock?: string | null;
  /** Service ids of the appointment being moved, or already on the draft. */
  carriedServiceIds?: string[];
  /** The last outbound bubble was a plan charge. */
  replyingToPlanCharge?: boolean;
  /** Spoken hour is before opening and the afternoon hour does not fit. */
  spokenHourOutside?: boolean;
  /** This message names a catalog barber and does not name a new hour. */
  namedBarberThisTurn?: boolean;
  /** Returning client's usual service (from visit history/memory). Suggested, never filled in silently. */
  usualService?: { service_ids: string[]; service_name: string } | null;
  /** The client just refused the usual service the agent suggested: ask which one, do not suggest again. */
  usualServiceRefused?: boolean;
  /** The client said yes to the suggested usual service this turn: it is now on the draft, the booking goes on. */
  usualServiceAccepted?: boolean;
};

export const ASK_BOOKING_NAME = "Para confirmar, qual seu nome?";
export const ASK_SERVICE = "Qual serviço deseja?";
export const ASK_HOUR = "Qual hora você prefere?";
export const ASK_CORTE_OR_COMBO = "Seria o corte simples ou o combo?";
export const CLOCK_OUTSIDE_HOURS = "Esse horário fica fora do expediente. Qual hora você prefere?";
export const PLAN_CHARGE_ACK = "Pode deixar, o acerto do plano fica combinado.";

export type OrchestratorRouting = {
  /**
   * Effective primary intent after all domain rules are applied.
   * This is what the rest of the agent loop should act on.
   */
  primaryIntent: IntentType;

  /** Barber was named by client but is NOT in the catalog. */
  requiresBarberDisclosure: boolean;
  /** The name the client used — shown in disclosure: "Não temos o X, mas Y tem horário." */
  unknownBarberName: string | null;

  /** Deterministic handoff trigger. Agent must stay silent after this. */
  triggerHandoff: boolean;
  handoffReason: "explicit_request" | "low_confidence_consecutive" | null;

  /**
   * When true, the plan_offered state must be cleared before the agent acts.
   * Rule: plan_offered + new non-plan intent → proceed normally, clear state.
   */
  clearPlanOffered: boolean;

  /** Intents to act on in this turn, primary first (primary + independent companions). */
  handleNow: IntentType[];
  /** Intents acknowledged but postponed until the transactional intent closes. */
  deferred: IntentType[];
  /** Pending intents resumed this turn because the client accepted the offer. */
  resumedPending: IntentType[];
  /** Pending intents to persist at the end of this turn. */
  nextPending: PendingIntents;

  /**
   * Recording (write tools) is only authorized when the orchestrator confirms it.
   * False when primaryIntent === "unknown" — the agent must not call any recording tool.
   */
  recordingAuthorized: boolean;

  /**
   * Clock fields missing for a waitlist intent.
   * When non-null, the agent should ask what's missing instead of calling add_to_waitlist.
   * null = clock is complete (or intent is not waitlist).
   */
  waitlistMissingClock: ("date" | "time" | "service")[] | null;

  /**
   * Closed list of tools this turn may execute.
   * Anything else is refused and does not become handoff.
   */
  allowedTools: string[];

  /**
   * Fact or question this turn may say when the model's sentence is discarded.
   * Empty means silence.
   */
  turnDirective: string;

  /**
   * Set when the turn asks for the service (turnDirective === ASK_SERVICE) and the client has a usual one:
   * the agent suggests it ("Vai ser o de sempre, X?") and books only after a yes. Null otherwise.
   */
  usualServiceSuggestion: { service_ids: string[]; service_name: string } | null;
};

/** Changes the agenda; one per turn, always handled first. */
const TRANSACTIONAL_INTENTS = new Set<IntentType>(["reschedule", "cancel", "schedule", "presence"]);
/** Independent, read-only or single-send actions that can run alongside a transactional intent. */
const COMPANION_INTENTS = new Set<IntentType>(["payment", "location", "hours", "consult"]);
/** Non-blocking intents postponed while a transactional intent is open. */
const DEFERRABLE_INTENTS = new Set<IntentType>(["plan", "waitlist"]);
const SCHEDULE_READS = [
  "list_services",
  "list_barbers",
  "list_appointments",
  "list_client_upcoming_appointments",
  "check_availability",
  "get_next_slots",
];

const AGENDA_TOOLS = [
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "check_availability",
  "get_next_slots",
  "confirm_appointment",
  "add_to_waitlist",
];

function planWrites(allowedTools: string[]): boolean {
  return allowedTools.some((tool) => tool === "create_appointment" || tool === "reschedule_appointment");
}

/**
 * Applies deterministic domain rules to produce routing decisions.
 *
 * Rules (in priority order):
 *  1. Explicit handoff request → triggerHandoff immediately
 *  2. Two consecutive low-confidence turns → triggerHandoff (V2: needs previous confidence)
 *  3. plan_offered + non-plan intent → clearPlanOffered, proceed normally
 *  4. cancel without upcoming appointment → treat as unknown (nothing to cancel)
 *  5. unknown_named barber → requiresBarberDisclosure
 *  6. Multiple intents → transactional first, companions in the same turn,
 *     plan/waitlist deferred and offered once the transaction closes
 */
export function orchestrate(input: OrchestratorInput): OrchestratorRouting {
  const {
    intentSet,
    conversationState,
    previousTurnConfidence,
    hasUpcomingAppointment,
  } = input;
  const { primary, barber } = intentSet;
  const pending = input.pendingIntents ?? { intents: [], offered: false };

  // ── Rule 1: Explicit handoff ───────────────────────────────────────────────
  if (primary === "handoff") {
    return routing(input, {
      primaryIntent: "handoff",
      triggerHandoff: true,
      handoffReason: "explicit_request",
      handleNow: ["handoff"],
      nextPending: { intents: [], offered: false },
    });
  }

  // ── Rule 2: Handoff by two consecutive low-confidence turns ───────────────
  // V1: previousTurnConfidence not yet persisted — rule activates in V2.
  if (shouldHandoffByConfidence(intentSet.confidence, previousTurnConfidence)) {
    return routing(input, {
      primaryIntent: primary,
      triggerHandoff: true,
      handoffReason: "low_confidence_consecutive",
      handleNow: [primary],
      nextPending: { intents: [], offered: false },
      ...barberDisclosure(barber),
    });
  }

  // ── Rule 3: plan_offered is non-blocking ──────────────────────────────────
  // Client mentioned plan just to inquire — new unrelated intent clears plan state.
  const clearPlanOffered =
    conversationState === "plan_offered" &&
    primary !== "plan" &&
    !intentSet.intents.includes("plan");

  // ── Rule 4: cancel without an upcoming appointment ────────────────────────
  // Nothing to cancel → treat as unknown, let the agent explain
  let effectivePrimary: IntentType =
    primary === "cancel" && !hasUpcomingAppointment ? "unknown" : primary;
  let intents = intentSet.intents.map((i) => (i === "cancel" && effectivePrimary !== "cancel" ? "unknown" : i));

  // ── Rule 6a: resume offered pending intents on a bare "sim" ───────────────
  let resumedPending: IntentType[] = [];
  let carried: IntentType[] = pending.intents;
  const slotOwnsAffirmation =
    conversationState === "slot_offered" || conversationState === "awaiting_name";
  const reminderOwnsAffirmation =
    conversationState === "reminder_24h_pending" || conversationState === "reminder_2h_pending";
  if (
    pending.offered &&
    pending.intents.includes("plan") &&
    Boolean(input.hasPersonName) &&
    !input.hasActiveSubscription &&
    effectivePrimary === "unknown"
  ) {
    resumedPending = ["plan"];
    effectivePrimary = "plan";
    intents = ["plan"];
    carried = [];
  } else if (pending.offered && pending.intents.length) {
    const acceptsOffer =
      Boolean(input.isAffirmative) &&
      effectivePrimary === "unknown" &&
      !input.hasActiveBookingDraft &&
      !slotOwnsAffirmation &&
      !reminderOwnsAffirmation &&
      conversationState !== "plan_offered";
    if (acceptsOffer) {
      resumedPending = pending.intents.includes("plan")
        ? ["plan"]
        : pending.intents.includes("waitlist")
          ? ["waitlist"]
          : [pending.intents[0]!];
      effectivePrimary = resumedPending[0]!;
      intents = [...resumedPending];
    }
    // Offered once: accepted now, or the client moved on.
    carried = [];
  }

  // A catalog service plus a clock is a booking, even without a booking verb.
  // The clock may already sit on the draft, but this turn has to add a service or a clock.
  // An open draft alone must not turn "não vou conseguir ir" into a new booking.
  const hasClock = Boolean(intentSet.dateTime?.time || intentSet.dateTime?.date || input.carriedClock);
  const hasServiceSignal = intentSet.service != null || Boolean(input.carriedServiceIds?.length);
  const turnAddsSlot =
    intentSet.service != null ||
    Boolean(intentSet.dateTime?.time || intentSet.dateTime?.date) ||
    Boolean(input.usualServiceAccepted);
  if (effectivePrimary === "unknown" && turnAddsSlot && hasServiceSignal && hasClock) {
    effectivePrimary = "schedule";
    intents = ["schedule"];
  }

  // ── Rule 6b: priority between intents of the same turn ────────────────────
  const unique = [...new Set(intents.filter((i) => i !== "unknown"))];
  const transactional = TRANSACTIONAL_INTENTS.has(effectivePrimary);
  const handleNow: IntentType[] = transactional
    ? [effectivePrimary, ...unique.filter((i) => i !== effectivePrimary && COMPANION_INTENTS.has(i))]
    : unique.length
      ? [effectivePrimary, ...unique.filter((i) => i !== effectivePrimary)]
      : [effectivePrimary];
  const deferred = transactional
    ? unique.filter((i) => i !== effectivePrimary && DEFERRABLE_INTENTS.has(i))
    : [];
  const nextIntents = [...new Set([...carried, ...deferred])].filter((i) => !handleNow.includes(i));

  // ── Rule 5: Barber substitution disclosure required ───────────────────────

  // ── Rule 7: Waitlist clock completeness ───────────────────────────────────
  // When the effective action is waitlist, check whether the full clock is present
  // (date + time + service). If not, the agent must ask for the missing fields
  // instead of calling add_to_waitlist with incomplete data.
  const waitlistActive = handleNow.includes("waitlist");
  const waitlistMissingClock = waitlistActive ? waitlistMissingClockFields(intentSet) : null;

  const askPlanName =
    effectivePrimary === "plan" && !input.hasActiveSubscription && !input.hasPersonName;
  return routing(input, {
    primaryIntent: effectivePrimary,
    clearPlanOffered,
    handleNow,
    deferred,
    resumedPending,
    nextPending: askPlanName ? { intents: ["plan"], offered: true } : { intents: nextIntents, offered: false },
    waitlistMissingClock,
    ...barberDisclosure(barber),
  });
}

// ── Catalog validation of tool arguments ─────────────────────────────────────

export type CatalogArgField = "service_id" | "service_ids" | "barber_id";

export type ToolCatalogValidation = {
  /** Arguments with every id outside the catalog removed. */
  args: Record<string, unknown>;
  /** Fields that referenced an id the shop does not have. */
  rejected: CatalogArgField[];
};

const TOOL_CATALOG_FIELDS: Record<string, CatalogArgField[]> = {
  check_availability: ["service_id", "service_ids", "barber_id"],
  get_next_slots: ["service_id", "service_ids", "barber_id"],
  create_appointment: ["service_id", "service_ids", "barber_id"],
  reschedule_appointment: ["barber_id"],
  add_to_waitlist: ["service_id", "barber_id"],
  list_appointments: ["barber_id"],
};

/**
 * The LLM never chooses a service or barber the shop does not have. Ids outside the
 * catalog are dropped before the tool runs, so the tool falls back to the draft
 * (already catalog-bound) or asks, instead of booking an invented offer.
 */
export function validateToolCatalogArgs(
  toolName: string,
  args: Record<string, unknown>,
  catalog: { serviceIds: string[]; barberIds: string[] },
): ToolCatalogValidation {
  const fields = TOOL_CATALOG_FIELDS[toolName];
  if (!fields) return { args, rejected: [] };
  const services = new Set(catalog.serviceIds);
  const barbers = new Set(catalog.barberIds);
  const out: Record<string, unknown> = { ...args };
  const rejected: CatalogArgField[] = [];
  const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

  if (fields.includes("service_id") && !isBlank(out.service_id)) {
    if (!services.has(String(out.service_id).trim())) {
      delete out.service_id;
      rejected.push("service_id");
    }
  }
  if (fields.includes("service_ids") && Array.isArray(out.service_ids) && out.service_ids.length) {
    const kept = out.service_ids.map((id) => String(id).trim()).filter((id) => services.has(id));
    if (kept.length !== out.service_ids.length) rejected.push("service_ids");
    if (kept.length) out.service_ids = kept;
    else delete out.service_ids;
  }
  if (fields.includes("barber_id") && !isBlank(out.barber_id)) {
    if (!barbers.has(String(out.barber_id).trim())) {
      delete out.barber_id;
      rejected.push("barber_id");
    }
  }
  return { args: out, rejected };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function barberDisclosure(barber: IntentSet["barber"]): Pick<OrchestratorRouting, "requiresBarberDisclosure" | "unknownBarberName"> {
  if (barber?.kind === "unknown_named") {
    return { requiresBarberDisclosure: true, unknownBarberName: barber.name };
  }
  return { requiresBarberDisclosure: false, unknownBarberName: null };
}

function routing(
  input: OrchestratorInput,
  partial: Partial<OrchestratorRouting> & { primaryIntent: IntentType; nextPending: PendingIntents },
): OrchestratorRouting {
  const primaryIntent = partial.primaryIntent;
  const base: OrchestratorRouting = {
    requiresBarberDisclosure: false,
    unknownBarberName: null,
    triggerHandoff: false,
    handoffReason: null,
    clearPlanOffered: false,
    handleNow: [primaryIntent],
    deferred: [],
    resumedPending: [],
    recordingAuthorized: primaryIntent !== "unknown",
    waitlistMissingClock: null,
    allowedTools: [],
    turnDirective: "",
    usualServiceSuggestion: null,
    ...partial,
  };
  const plan = buildTurnPlan(input, base);
  const allowedTools = base.triggerHandoff ? [] : plan.allowedTools;
  return {
    ...base,
    allowedTools,
    turnDirective: plan.turnDirective,
    usualServiceSuggestion: plan.usualServiceSuggestion,
    recordingAuthorized: base.recordingAuthorized || planWrites(allowedTools),
  };
}

/**
 * Closed tool list and the sentence the turn may say.
 * Short "sim" records only the open agreement, in order:
 * slot, presence, plan, waitlist.
 */
export function buildTurnPlan(
  input: OrchestratorInput,
  routing: OrchestratorRouting,
): {
  allowedTools: string[];
  turnDirective: string;
  usualServiceSuggestion: OrchestratorRouting["usualServiceSuggestion"];
} {
  if (routing.triggerHandoff) {
    return { allowedTools: [], turnDirective: "", usualServiceSuggestion: null };
  }
  const state = input.conversationState;
  const affirmative = Boolean(input.isAffirmative);
  const slotOpen = state === "slot_offered" || state === "awaiting_name";
  const reminderOpen = state === "reminder_24h_pending" || state === "reminder_2h_pending";
  const presence = reminderOpen && routing.primaryIntent === "presence";
  const planAccept = affirmative && state === "plan_offered" && !slotOpen && !presence;
  const waitlistAccept =
    affirmative &&
    Boolean(input.waitlistOfferOpen) &&
    !slotOpen &&
    !presence &&
    !planAccept &&
    state !== "plan_offered";

  const tools = new Set<string>();
  const allow = (names: string[]) => {
    for (const name of names) tools.add(name);
  };

  for (const intent of routing.handleNow) {
    if (intent === "schedule" || intent === "reschedule") allow(SCHEDULE_READS);
    if (intent === "cancel") allow(["list_client_upcoming_appointments", "cancel_appointment"]);
    if (intent === "consult") allow(["list_client_upcoming_appointments"]);
    if (intent === "payment") allow(["send_shop_pix", "list_client_upcoming_appointments"]);
    if (intent === "location") allow(["send_barbershop_location"]);
    if (intent === "waitlist") {
      allow(["list_services", "list_barbers", "check_availability"]);
      if (!routing.waitlistMissingClock) allow(["add_to_waitlist"]);
    }
    if (intent === "plan") {
      allow(["list_plans", "list_client_plan"]);
      if (input.hasActiveSubscription) allow(["send_pix_plan_charge"]);
      else if (input.hasPersonName) allow(["subscribe_client_to_plan", "send_pix_plan_charge", "upsert_client"]);
    }
    if (intent === "presence" && presence) {
      allow(["list_client_upcoming_appointments", "confirm_appointment"]);
    }
  }

  const nameMissingOnOpenSlot =
    slotOpen && !input.hasPersonName && (affirmative || state === "awaiting_name");
  const nameArrived =
    Boolean(input.hasPersonName) &&
    (routing.primaryIntent === "unknown" || affirmative || Boolean(input.nameStatedThisTurn)) &&
    (state === "awaiting_name" || (state === "slot_offered" && Boolean(input.nameStatedThisTurn)));
  const namedSlotAccept = state === "slot_offered" && affirmative && Boolean(input.hasPersonName);
  if (nameArrived || namedSlotAccept) {
    allow(["create_appointment", "reschedule_appointment", "upsert_client", ...SCHEDULE_READS]);
  }
  if (waitlistAccept) allow(["add_to_waitlist"]);
  if (planAccept) allow(["list_plans", "list_client_plan"]);

  let turnDirective = "";
  if (routing.waitlistMissingClock?.length) {
    const labels: Record<string, string> = { date: "o dia", time: "o horário", service: "o serviço" };
    const missing = routing.waitlistMissingClock.map((field) => labels[field] ?? field).join(" e ");
    turnDirective = `Para a fila, falta ${missing}.`;
  } else if (routing.primaryIntent === "plan" && !input.hasActiveSubscription && !input.hasPersonName) {
    turnDirective = "Para assinar, qual seu nome?";
  } else if (nameMissingOnOpenSlot) {
    turnDirective = ASK_BOOKING_NAME;
  } else if (input.spokenHourOutside && routing.primaryIntent === "unknown") {
    turnDirective = CLOCK_OUTSIDE_HOURS;
  } else if (
    routing.primaryIntent === "unknown" &&
    !slotOpen &&
    !presence &&
    !input.intentSet.service &&
    !(input.carriedServiceIds?.length) &&
    (input.intentSet.dateTime?.time || input.carriedClock)
  ) {
    turnDirective = ASK_SERVICE;
  } else if (routing.primaryIntent === "unknown" && !slotOpen && !presence && !waitlistAccept) {
    turnDirective = "";
  }

  const movingAgenda = ["schedule", "reschedule", "cancel", "presence"].includes(routing.primaryIntent);
  if (
    (routing.primaryIntent === "schedule" || routing.primaryIntent === "reschedule") &&
    input.intentSet.service === "ambiguous" &&
    !(input.carriedServiceIds?.length)
  ) {
    tools.delete("check_availability");
    tools.delete("get_next_slots");
    turnDirective = ASK_CORTE_OR_COMBO;
  }
  if (
    (routing.primaryIntent === "schedule" || routing.primaryIntent === "reschedule") &&
    !input.intentSet.service &&
    !(input.carriedServiceIds?.length) &&
    Boolean(input.intentSet.dateTime?.time || input.carriedClock)
  ) {
    tools.delete("check_availability");
    tools.delete("get_next_slots");
    tools.delete("create_appointment");
    tools.delete("reschedule_appointment");
    turnDirective = ASK_SERVICE;
  }
  if (
    input.namedBarberThisTurn &&
    (input.carriedServiceIds?.length ?? 0) > 0 &&
    Boolean(input.carriedClock)
  ) {
    tools.add("check_availability");
  }
  const asideFromAgenda = routing.handleNow.some(
    (intent) => intent === "payment" || intent === "location" || intent === "plan",
  );
  if (
    (routing.primaryIntent === "schedule" || routing.primaryIntent === "reschedule") &&
    !input.intentSet.dateTime?.time &&
    !input.carriedClock &&
    !asideFromAgenda &&
    turnDirective !== ASK_CORTE_OR_COMBO &&
    turnDirective !== ASK_SERVICE
  ) {
    tools.delete("check_availability");
    tools.delete("get_next_slots");
    tools.delete("create_appointment");
    tools.delete("reschedule_appointment");
    turnDirective = ASK_HOUR;
  }
  if (input.replyingToPlanCharge && !movingAgenda) {
    for (const tool of AGENDA_TOOLS) tools.delete(tool);
    if (routing.primaryIntent === "unknown") turnDirective = PLAN_CHARGE_ACK;
  }

  if (routing.handleNow.includes("waitlist") && routing.waitlistMissingClock) {
    tools.delete("add_to_waitlist");
  }

  // Cliente que volta: pedir o serviço vira "Vai ser o de sempre, X?". A sugestão só vale na pergunta de serviço,
  // e só uma vez: depois da recusa a pessoa escolhe sozinha.
  const usualServiceSuggestion =
    turnDirective === ASK_SERVICE && input.usualService?.service_ids.length && !input.usualServiceRefused
      ? input.usualService
      : null;
  return { allowedTools: [...tools], turnDirective, usualServiceSuggestion };
}

/**
 * Checks whether the clock fields required for add_to_waitlist are present
 * in the intent set. Returns the list of missing field names, or null when complete.
 */
export function waitlistMissingClockFields(intentSet: IntentSet): ("date" | "time" | "service")[] | null {
  const missing: ("date" | "time" | "service")[] = [];
  if (!intentSet.dateTime?.date) missing.push("date");
  if (!intentSet.dateTime?.time) missing.push("time");
  if (!intentSet.service || intentSet.service === "ambiguous") missing.push("service");
  return missing.length > 0 ? missing : null;
}
