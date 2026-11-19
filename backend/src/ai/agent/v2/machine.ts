/**
 * Fonte única do estado da conversa no motor novo. A máquina é pura: recebe fatos e devolve o próximo
 * estado, o comando a executar e o fato a comunicar. Quem chama ferramentas é o motor.
 */
import { assign, initialTransition, setup, transition, type SnapshotFrom } from "xstate";
import { addDaysIso } from "../../date-calendar.js";
import type { TurnInterpretation } from "../turn-interpreter.js";

export const OFFER_TTL_MS = 30 * 60 * 1000;

export type UpcomingFact = {
  id: string;
  date: string;
  time: string;
  service_ids: string[];
  service_names: string;
  barber_id: string | null;
  barber_name: string;
  status: string;
  price: number | null;
};

export type TurnFacts = {
  interpretation: TurnInterpretation;
  upcoming: UpcomingFact[];
  reminderAppointmentId: string | null;
  personName: string | null;
  services: Array<{ id: string; name: string; price: number | null }>;
  barbers: Array<{ id: string; name: string }>;
  usualService: { service_ids: string[]; service_name: string } | null;
  todayIso: string;
  nowHHmm: string;
  nowMs: number;
};

export type V2Command =
  | { type: "check_slot" }
  | { type: "list_slots" }
  | { type: "write_create" }
  | { type: "write_reschedule" }
  | { type: "write_cancel"; appointment_id: string }
  | { type: "write_presence"; appointment_id: string }
  | { type: "add_waitlist" }
  | { type: "open_handoff" };

export type V2Say =
  | { kind: "clarify" }
  | { kind: "ask_service" }
  | { kind: "ask_usual_service"; service_name: string }
  | { kind: "ask_simple_or_combo" }
  | { kind: "ask_datetime" }
  | { kind: "ask_name" }
  | { kind: "offer_slot" }
  | { kind: "offer_move"; appointment_id: string }
  | { kind: "slot_busy"; times: string[] }
  | { kind: "slots_listed"; times: string[]; date: string }
  | { kind: "no_slots" }
  | { kind: "offer_expired" }
  | { kind: "offer_declined" }
  | { kind: "booked" }
  | { kind: "moved" }
  | { kind: "write_failed" }
  | { kind: "cancel_ask"; appointment_id: string }
  | { kind: "cancel_kept" }
  | { kind: "cancelled"; appointment_id: string }
  | { kind: "which_appointment"; verb: "cancelar" | "remarcar" }
  | { kind: "no_appointment"; verb: "cancelar" | "remarcar" }
  | { kind: "presence_confirmed"; appointment_id: string }
  | { kind: "waitlist_added" }
  | { kind: "waitlist_missing"; missing: Array<"date" | "time" | "service"> }
  | { kind: "handoff" }
  | { kind: "side_only" }
  | { kind: "delegate_legacy" };

export type V2Context = {
  service_ids: string[];
  service_name: string | null;
  price: number | null;
  barber_id: string | null;
  barber_name: string | null;
  date: string | null;
  time: string | null;
  after_time: string | null;
  moving_id: string | null;
  cancel_id: string | null;
  offer_issued_ms: number | null;
  proposed_usual: { service_ids: string[]; service_name: string } | null;
  offered_times: string[];
  last_write_key: string | null;
  command: V2Command | null;
  say: V2Say | null;
};

export type V2Event =
  | { type: "TURN"; facts: TurnFacts; state: string }
  | {
      type: "SLOT_FREE";
      slot: { date: string; time: string; barber_id: string; barber_name: string; price: number | null; service_name: string | null };
      nowMs: number;
    }
  | { type: "SLOT_BUSY"; times: string[] }
  | { type: "SLOTS_LISTED"; times: string[]; date: string; barber_id?: string; barber_name?: string }
  | { type: "NO_SLOTS" }
  | { type: "WRITE_OK"; key: string }
  | { type: "WRITE_FAILED" };

export const EMPTY_CONTEXT: V2Context = {
  service_ids: [],
  service_name: null,
  price: null,
  barber_id: null,
  barber_name: null,
  date: null,
  time: null,
  after_time: null,
  moving_id: null,
  cancel_id: null,
  offer_issued_ms: null,
  proposed_usual: null,
  offered_times: [],
  last_write_key: null,
  command: null,
  say: null,
};

const clearedBooking = (context: V2Context): V2Context => ({
  ...EMPTY_CONTEXT,
  last_write_key: context.last_write_key,
});

export type Route =
  | "handoff"
  | "cancel_confirm"
  | "cancel_keep"
  | "offer_close_create"
  | "offer_close_move"
  | "offer_need_name"
  | "offer_reject"
  | "offer_expired"
  | "presence"
  | "cancel_ask"
  | "cancel_which"
  | "cancel_none"
  | "move_which"
  | "move_none"
  | "waitlist_add"
  | "waitlist_missing"
  | "plan"
  | "book_check"
  | "book_list"
  | "book_ask"
  | "side_only"
  | "clarify";

const SIDE_INTENTS = new Set(["payment", "location", "hours", "consult"]);

function hasSlotSignal(i: TurnInterpretation): boolean {
  return Boolean(
    i.service_id || i.service_ambiguous || i.barber_id || i.barber_any || i.date || i.time || i.after_time || i.wants_next_slot,
  );
}

function offerLive(context: V2Context, nowMs: number): boolean {
  return context.offer_issued_ms != null && nowMs - context.offer_issued_ms <= OFFER_TTL_MS;
}

function pickUpcoming(facts: TurnFacts): UpcomingFact | "many" | null {
  if (facts.upcoming.length === 0) return null;
  if (facts.upcoming.length === 1) return facts.upcoming[0]!;
  const { date, time, service_id } = facts.interpretation;
  const matches = facts.upcoming.filter(
    (item) =>
      (date != null && item.date === date) ||
      (time != null && item.time === time) ||
      (service_id != null && item.service_ids.includes(service_id)),
  );
  return matches.length === 1 ? matches[0]! : "many";
}

/** Rascunho deste turno: o que foi dito agora vale sobre o que já estava em aberto. */
export function mergeTurnSlots(context: V2Context, facts: TurnFacts): V2Context {
  const i = facts.interpretation;
  const next: V2Context = { ...context, command: null, say: null, cancel_id: null, offer_issued_ms: null };
  const service = facts.services.find((item) => item.id === i.service_id);
  if (service) {
    next.service_ids = [service.id];
    next.service_name = service.name;
    next.price = service.price;
    next.proposed_usual = null;
  } else if (context.proposed_usual && i.offer_response === "accept") {
    next.service_ids = context.proposed_usual.service_ids;
    next.service_name = context.proposed_usual.service_name;
    next.proposed_usual = null;
  }
  const barber = facts.barbers.find((item) => item.id === i.barber_id);
  if (barber) {
    next.barber_id = barber.id;
    next.barber_name = barber.name;
  } else if (i.barber_any) {
    next.barber_id = null;
    next.barber_name = null;
  }
  if (i.date) next.date = i.date;
  if (i.time) {
    next.time = i.time;
    next.after_time = null;
  } else if (i.after_time) {
    next.after_time = i.after_time;
    next.time = null;
  } else if (i.date || i.wants_next_slot) {
    next.time = null;
  }
  if (next.time && !next.date) {
    next.date = next.time > facts.nowHHmm ? facts.todayIso : addDaysIso(facts.todayIso, 1);
  }
  return next;
}

function withMovingAppointment(context: V2Context, appointment: UpcomingFact): V2Context {
  return {
    ...context,
    moving_id: appointment.id,
    service_ids: context.service_ids.length ? context.service_ids : appointment.service_ids,
    service_name: context.service_name ?? appointment.service_names,
    price: context.price ?? appointment.price,
    barber_id: context.barber_id ?? appointment.barber_id,
    barber_name: context.barber_name ?? appointment.barber_name,
  };
}

type Planned = { route: Route; context: V2Context };

function planBooking(context: V2Context, facts: TurnFacts): Planned {
  const merged = mergeTurnSlots(context, facts);
  if (!merged.service_ids.length) {
    if (facts.interpretation.service_ambiguous) {
      return { route: "book_ask", context: { ...merged, say: { kind: "ask_simple_or_combo" } } };
    }
    if (facts.usualService && !context.proposed_usual) {
      return {
        route: "book_ask",
        context: {
          ...merged,
          proposed_usual: facts.usualService,
          say: { kind: "ask_usual_service", service_name: facts.usualService.service_name },
        },
      };
    }
    return { route: "book_ask", context: { ...merged, proposed_usual: null, say: { kind: "ask_service" } } };
  }
  if (merged.date && merged.time) return { route: "book_check", context: { ...merged, command: { type: "check_slot" } } };
  if (merged.date || merged.after_time || facts.interpretation.wants_next_slot) {
    return {
      route: "book_list",
      context: { ...merged, date: merged.date ?? facts.todayIso, command: { type: "list_slots" } },
    };
  }
  return { route: "book_ask", context: { ...merged, say: { kind: "ask_datetime" } } };
}

/** Decide o turno inteiro. É a única regra de negócio da conversa. */
export function planTurn(state: string, context: V2Context, facts: TurnFacts): Planned {
  const i = facts.interpretation;
  const base: V2Context = { ...context, command: null, say: null };
  const primary = i.primary;

  if (primary === "handoff") {
    return { route: "handoff", context: { ...clearedBooking(context), command: { type: "open_handoff" }, say: { kind: "handoff" } } };
  }

  if (state === "cancel_offered" && context.cancel_id) {
    if (!offerLive(context, facts.nowMs)) {
      if (i.offer_response === "accept") {
        return { route: "offer_expired", context: { ...clearedBooking(context), say: { kind: "offer_expired" } } };
      }
    } else if (i.offer_response === "accept" && (primary === "unknown" || primary === "cancel")) {
      return {
        route: "cancel_confirm",
        context: { ...base, command: { type: "write_cancel", appointment_id: context.cancel_id } },
      };
    }
    if (i.offer_response === "reject" && primary === "unknown") {
      return { route: "cancel_keep", context: { ...clearedBooking(context), say: { kind: "cancel_kept" } } };
    }
  }

  if (state === "slot_offered" || state === "awaiting_name") {
    const name = facts.personName ?? i.person_name;
    const accepted = i.offer_response === "accept" || (state === "awaiting_name" && Boolean(i.person_name));
    const sideOnly = SIDE_INTENTS.has(primary) && i.offer_response !== "accept";
    if (!offerLive(context, facts.nowMs) && accepted) {
      return { route: "offer_expired", context: { ...clearedBooking(context), say: { kind: "offer_expired" } } };
    }
    if (accepted && !sideOnly) {
      if (!name) return { route: "offer_need_name", context: { ...base, say: { kind: "ask_name" } } };
      return context.moving_id
        ? { route: "offer_close_move", context: { ...base, command: { type: "write_reschedule" } } }
        : { route: "offer_close_create", context: { ...base, command: { type: "write_create" } } };
    }
    if (i.offer_response === "reject" && !hasSlotSignal(i) && primary === "unknown") {
      return {
        route: "offer_reject",
        context: { ...base, time: null, offer_issued_ms: null, say: { kind: "offer_declined" } },
      };
    }
  }

  if (primary === "presence" && facts.reminderAppointmentId) {
    return {
      route: "presence",
      context: { ...base, command: { type: "write_presence", appointment_id: facts.reminderAppointmentId } },
    };
  }

  if (primary === "cancel") {
    const target = pickUpcoming(facts);
    if (target === null) return { route: "cancel_none", context: { ...clearedBooking(context), say: { kind: "no_appointment", verb: "cancelar" } } };
    if (target === "many") return { route: "cancel_which", context: { ...base, say: { kind: "which_appointment", verb: "cancelar" } } };
    return {
      route: "cancel_ask",
      context: {
        ...clearedBooking(context),
        cancel_id: target.id,
        offer_issued_ms: facts.nowMs,
        say: { kind: "cancel_ask", appointment_id: target.id },
      },
    };
  }

  if (primary === "reschedule") {
    const target = context.moving_id
      ? (facts.upcoming.find((item) => item.id === context.moving_id) ?? pickUpcoming(facts))
      : pickUpcoming(facts);
    if (target === null) return { route: "move_none", context: { ...clearedBooking(context), say: { kind: "no_appointment", verb: "remarcar" } } };
    if (target === "many") return { route: "move_which", context: { ...base, say: { kind: "which_appointment", verb: "remarcar" } } };
    return planBooking(withMovingAppointment(context.moving_id === target.id ? context : clearedBooking(context), target), facts);
  }

  if (primary === "waitlist") {
    const merged = mergeTurnSlots(context, facts);
    const missing = [
      ...(merged.date ? [] : (["date"] as const)),
      ...(merged.time ? [] : (["time"] as const)),
      ...(merged.service_ids.length ? [] : (["service"] as const)),
    ];
    return missing.length
      ? { route: "waitlist_missing", context: { ...merged, say: { kind: "waitlist_missing", missing: [...missing] } } }
      : { route: "waitlist_add", context: { ...merged, command: { type: "add_waitlist" } } };
  }

  if (primary === "plan") return { route: "plan", context: { ...base, say: { kind: "delegate_legacy" } } };
  if (primary === "schedule") return planBooking(context, facts);
  if (SIDE_INTENTS.has(primary)) return { route: "side_only", context: { ...base, say: { kind: "side_only" } } };

  if (state === "collecting" && (hasSlotSignal(i) || i.offer_response === "accept")) return planBooking(context, facts);
  if (state === "slot_offered" && i.offer_response === "correct") return planBooking(context, facts);
  return { route: "clarify", context: { ...base, say: { kind: "clarify" } } };
}

const ROUTE_TARGET: Record<Route, string> = {
  handoff: "handoff",
  cancel_confirm: "writing",
  cancel_keep: "idle",
  offer_close_create: "writing",
  offer_close_move: "writing",
  offer_need_name: "awaiting_name",
  offer_reject: "collecting",
  offer_expired: "idle",
  presence: "writing",
  cancel_ask: "cancel_offered",
  cancel_which: "idle",
  cancel_none: "idle",
  move_which: "idle",
  move_none: "idle",
  waitlist_add: "writing",
  waitlist_missing: "collecting",
  plan: "idle",
  book_check: "checking",
  book_list: "listing",
  book_ask: "collecting",
  side_only: "stay",
  clarify: "stay",
};

const baseSetup = setup({
  types: { context: {} as V2Context, events: {} as V2Event, input: {} as { context?: V2Context } },
});

const turnTransitions = (Object.keys(ROUTE_TARGET) as Route[])
  .filter((route) => ROUTE_TARGET[route] !== "stay")
  .map((route) => ({
    guard: ({ context, event }: { context: V2Context; event: V2Event }) =>
      event.type === "TURN" && planTurn(event.state, context, event.facts).route === route,
    target: `#agent.${ROUTE_TARGET[route]}`,
    actions: assign(({ context, event }: { context: V2Context; event: V2Event }) =>
      event.type === "TURN" ? planTurn(event.state, context, event.facts).context : context,
    ),
  }));

const stayTransition = {
  actions: assign(({ context, event }: { context: V2Context; event: V2Event }) =>
    event.type === "TURN" ? planTurn(event.state, context, event.facts).context : context,
  ),
};

const resultOfWrite = (context: V2Context, key: string): V2Context => {
  const command = context.command;
  const cleared = { ...clearedBooking(context), last_write_key: key };
  if (command?.type === "write_cancel") return { ...cleared, say: { kind: "cancelled", appointment_id: command.appointment_id } };
  if (command?.type === "write_presence") return { ...cleared, say: { kind: "presence_confirmed", appointment_id: command.appointment_id } };
  if (command?.type === "add_waitlist") return { ...cleared, say: { kind: "waitlist_added" } };
  return { ...context, last_write_key: key, command: null, say: { kind: command?.type === "write_reschedule" ? "moved" : "booked" } };
};

export const conversationMachine = baseSetup.createMachine({
  id: "agent",
  initial: "idle",
  context: ({ input }) => input.context ?? EMPTY_CONTEXT,
  on: { TURN: [...turnTransitions, stayTransition] as never },
  states: {
    idle: {},
    collecting: {},
    checking: {
      on: {
        SLOT_FREE: {
          target: "slot_offered",
          actions: assign(({ context, event }) => ({
            ...context,
            ...event.slot,
            service_name: event.slot.service_name ?? context.service_name,
            price: event.slot.price ?? context.price,
            command: null,
            offered_times: [],
            offer_issued_ms: event.nowMs,
            say: context.moving_id ? { kind: "offer_move" as const, appointment_id: context.moving_id } : { kind: "offer_slot" as const },
          })),
        },
        SLOT_BUSY: {
          target: "collecting",
          actions: assign(({ context, event }) => ({
            ...context,
            time: null,
            command: null,
            offered_times: event.times,
            say: event.times.length ? { kind: "slot_busy" as const, times: event.times } : { kind: "no_slots" as const },
          })),
        },
      },
    },
    listing: {
      on: {
        SLOTS_LISTED: {
          target: "collecting",
          actions: assign(({ context, event }) => ({
            ...context,
            date: event.date,
            barber_id: context.barber_id ?? event.barber_id ?? null,
            barber_name: context.barber_name ?? event.barber_name ?? null,
            command: null,
            offered_times: event.times,
            say: { kind: "slots_listed" as const, times: event.times, date: event.date },
          })),
        },
        NO_SLOTS: {
          target: "collecting",
          actions: assign(({ context }) => ({ ...context, command: null, offered_times: [], say: { kind: "no_slots" as const } })),
        },
      },
    },
    slot_offered: {},
    awaiting_name: {},
    cancel_offered: {},
    writing: {
      on: {
        WRITE_OK: { target: "idle", actions: assign(({ context, event }) => resultOfWrite(context, event.key)) },
        WRITE_FAILED: {
          target: "collecting",
          actions: assign(({ context }) => ({ ...context, time: null, command: null, offer_issued_ms: null, say: { kind: "write_failed" as const } })),
        },
      },
    },
    handoff: {},
  },
});

export type ConversationSnapshot = SnapshotFrom<typeof conversationMachine>;
export type PersistedAgentState = { version: 1; value: string; context: V2Context };

export function restoreSnapshot(saved: PersistedAgentState | null): ConversationSnapshot {
  if (!saved || saved.version !== 1) return initialTransition(conversationMachine, { context: EMPTY_CONTEXT })[0];
  return conversationMachine.resolveState({ value: saved.value, context: { ...EMPTY_CONTEXT, ...saved.context } } as never);
}

export function stepTurn(snapshot: ConversationSnapshot, facts: TurnFacts): ConversationSnapshot {
  return transition(conversationMachine, snapshot, { type: "TURN", facts, state: String(snapshot.value) })[0];
}

export function stepResult(snapshot: ConversationSnapshot, event: Exclude<V2Event, { type: "TURN" }>): ConversationSnapshot {
  return transition(conversationMachine, snapshot, event)[0];
}

export function persistSnapshot(snapshot: ConversationSnapshot): PersistedAgentState {
  return { version: 1, value: String(snapshot.value), context: { ...snapshot.context, command: null, say: null } };
}

