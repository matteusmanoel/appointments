import { describe, expect, it } from "vitest";
import {
  BASIC_FLOW_SAFE_FALLBACK,
  extractSlotsFromIntent,
  isBasicBookingFlow,
  shouldConfirmReminderPresence,
} from "../ai/agent/slot-filling.js";

describe("slot-filling determinístico", () => {
  it("reconhece os 4 fluxos básicos e deixa consult/pix/plano de fora", () => {
    expect(isBasicBookingFlow({ primaryIntent: "schedule" })).toBe(true);
    expect(isBasicBookingFlow({ primaryIntent: "reschedule" })).toBe(true);
    expect(isBasicBookingFlow({ primaryIntent: "cancel" })).toBe(true);
    expect(isBasicBookingFlow({ primaryIntent: "presence" })).toBe(true);
    expect(isBasicBookingFlow({ primaryIntent: "unknown", conversationState: "reminder_rsvp_pending" })).toBe(true);
    expect(isBasicBookingFlow({ primaryIntent: "schedule", looksLikePix: true })).toBe(false);
    expect(isBasicBookingFlow({ primaryIntent: "consult" })).toBe(false);
    expect(BASIC_FLOW_SAFE_FALLBACK.length).toBeGreaterThan(0);
  });

  it("só confirma presença no RSVP do lembrete, não em cancelar/reagendar", () => {
    expect(
      shouldConfirmReminderPresence({
        conversationState: "reminder_rsvp_pending",
        isAffirmative: true,
        looksLikeCancel: false,
        looksLikeReschedule: false,
        looksLikeNewBooking: false,
      }),
    ).toBe(true);
    expect(
      shouldConfirmReminderPresence({
        conversationState: "reminder_rsvp_pending",
        isAffirmative: true,
        looksLikeCancel: true,
        looksLikeReschedule: false,
        looksLikeNewBooking: false,
      }),
    ).toBe(false);
    expect(
      shouldConfirmReminderPresence({
        conversationState: "has_upcoming",
        isAffirmative: true,
        looksLikeCancel: false,
        looksLikeReschedule: false,
        looksLikeNewBooking: false,
      }),
    ).toBe(false);
  });

  it("repassa slots já entendidos pelas regras", () => {
    expect(extractSlotsFromIntent({ service: "Corte", date: "2026-11-15", time: null })).toEqual({
      serviceText: "Corte",
      barberText: null,
      date: "2026-11-15",
      time: null,
      afterTime: null,
    });
  });
});
