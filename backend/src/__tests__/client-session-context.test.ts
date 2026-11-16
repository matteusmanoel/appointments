import { describe, expect, it } from "vitest";
import { emptyBookingDraft, type BookingDraft } from "../ai/booking-draft.js";
import { emptyPendingIntents } from "../ai/agent/pending-intents.js";
import {
  SESSION_CONTEXT_FRESH_MS,
  narrowSessionForHydration,
  sessionPhoneKeys,
  type ClientSessionContext,
} from "../ai/agent/client-session-context.js";
import { orchestrate } from "../ai/agent/orchestrator.js";
import type { IntentSet, IntentType } from "../ai/agent/types.js";

function session(partial: Partial<BookingDraft>, updatedAt: string, lastIntent = "schedule"): ClientSessionContext {
  return {
    bookingDraft: { ...emptyBookingDraft(), ...partial },
    pendingIntents: { intents: ["cancel"], offered: false },
    lastIntent,
    updatedAt,
  };
}

function intent(primary: IntentType): IntentSet {
  return {
    intents: [primary],
    primary,
    service: null,
    barber: null,
    dateTime: null,
    rawSignals: [],
    confidence: 0.2,
  };
}

describe("contexto de sessão", () => {
  it("casa o telefone do painel (sem 55) com o do WhatsApp e não usa os últimos 10 dígitos", () => {
    const keys = sessionPhoneKeys("5511987654321");
    expect(keys).toContain("11987654321");
    expect(keys).toContain("5511987654321");
    expect(keys).not.toContain("1987654321");
    expect(sessionPhoneKeys("11987654321")).toEqual(expect.arrayContaining(["5511987654321"]));
  });

  it("contexto de 10 minutos carrega data, hora, card e intenções", () => {
    const now = Date.parse("2026-11-16T10:10:00-03:00");
    const card = { kind: "create" as const, issuedAt: "2026-11-16T10:00:00-03:00" };
    const narrowed = narrowSessionForHydration(
      session(
        {
          status: "offered",
          date: "2026-11-17",
          time: "15:00",
          service_name: "Corte",
          confirmCard: card,
        },
        "2026-11-16T10:00:00-03:00",
      ),
      now,
    );
    expect(narrowed.fresh).toBe(true);
    expect(narrowed.bookingDraft.date).toBe("2026-11-17");
    expect(narrowed.bookingDraft.time).toBe("15:00");
    expect(narrowed.bookingDraft.confirmCard?.kind).toBe("create");
    expect(narrowed.pendingIntents.intents).toEqual(["cancel"]);
  });

  it("contexto de 2 dias e rascunho fechado ficam só com serviço e barbeiro", () => {
    const now = Date.parse("2026-11-18T10:00:00-03:00");
    const old = narrowSessionForHydration(
      session(
        {
          status: "offered",
          date: "2026-11-17",
          time: "15:00",
          service_name: "Corte",
          barber_name: "Lucas",
          appointment_id: "11111111-1111-4111-8111-111111111111",
          confirmCard: { kind: "reschedule", issuedAt: "2026-11-16T10:00:00-03:00" },
        },
        new Date(now - SESSION_CONTEXT_FRESH_MS - 60_000).toISOString(),
      ),
      now,
    );
    expect(old.fresh).toBe(false);
    expect(old.bookingDraft).toEqual(emptyBookingDraft());
    expect(old.pendingIntents).toEqual(emptyPendingIntents());

    const closed = narrowSessionForHydration(
      session({ status: "closed", date: "2026-11-17", time: "15:00", service_name: "Barba" }, new Date(now).toISOString()),
      now,
    );
    expect(closed.fresh).toBe(false);
    expect(closed.bookingDraft).toEqual(emptyBookingDraft());
  });

  it("intenção desconhecida numa conversa nova recente continua a última intenção; «sim» não", () => {
    const base = {
      previousTurnConfidence: undefined,
      hasUpcomingAppointment: false,
      hasActiveBookingDraft: true,
      pendingIntents: { intents: [] as IntentType[], offered: false },
      conversationState: "collecting" as const,
    };
    const continued = orchestrate({
      ...base,
      intentSet: intent("unknown"),
      sessionLastIntent: "reschedule",
      sessionContextFresh: true,
    });
    expect(continued.primaryIntent).toBe("reschedule");

    const affirmed = orchestrate({
      ...base,
      intentSet: intent("unknown"),
      isAffirmative: true,
      sessionLastIntent: "schedule",
      sessionContextFresh: true,
    });
    expect(affirmed.primaryIntent).not.toBe("schedule");

    const stale = orchestrate({
      ...base,
      intentSet: intent("unknown"),
      sessionLastIntent: "cancel",
      sessionContextFresh: false,
    });
    expect(stale.primaryIntent).toBe("unknown");
  });
});
