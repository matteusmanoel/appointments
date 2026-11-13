import { describe, expect, it } from "vitest";
import { orchestrate } from "./orchestrator.js";
import type { IntentSet, IntentType } from "./types.js";

function intent(primary: IntentType, extra: Partial<IntentSet> = {}): IntentSet {
  return {
    intents: [primary],
    primary,
    service: null,
    barber: null,
    dateTime: null,
    rawSignals: [],
    confidence: 0.9,
    ...extra,
  };
}

const base = {
  previousTurnConfidence: undefined,
  hasUpcomingAppointment: false,
  hasActiveBookingDraft: false,
  pendingIntents: { intents: [] as IntentType[], offered: false },
};

describe("orchestrate allowed tools", () => {
  it("unknown turn has no write tool", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "idle",
    });
    expect(routing.allowedTools).not.toContain("create_appointment");
    expect(routing.allowedTools).not.toContain("confirm_appointment");
    expect(routing.allowedTools).not.toContain("add_to_waitlist");
    expect(routing.triggerHandoff).toBe(false);
  });

  it("short sim on an offered slot without a name asks the name and does not record", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "slot_offered",
      isAffirmative: true,
      hasPersonName: false,
    });
    expect(routing.allowedTools).not.toContain("create_appointment");
    expect(routing.allowedTools).not.toContain("reschedule_appointment");
    expect(routing.turnDirective).toMatch(/nome/);
  });

  it("short sim on an offered slot with a name may create", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "slot_offered",
      isAffirmative: true,
      hasPersonName: true,
    });
    expect(routing.allowedTools).toContain("create_appointment");
    expect(routing.allowedTools).not.toContain("confirm_appointment");
  });

  it("a name said after the card already reads as offered still records", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "slot_offered",
      hasPersonName: true,
      nameStatedThisTurn: true,
    });
    expect(routing.allowedTools).toContain("create_appointment");
    expect(routing.turnDirective).not.toMatch(/nome/);
  });

  it("a later clock keeps the service already on the draft", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1, dateTime: { time: "18:00" } }),
      conversationState: "collecting",
      carriedClock: "18:00",
      carriedServiceIds: ["svc-1"],
    });
    expect(routing.primaryIntent).toBe("schedule");
    expect(routing.turnDirective).not.toMatch(/serviço/);
    expect(routing.allowedTools).toContain("check_availability");
    expect(routing.allowedTools).not.toContain("create_appointment");
  });

  it("cancel stays on the tool list without asking for another confirmation", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("cancel"),
      conversationState: "idle",
      hasUpcomingAppointment: true,
    });
    expect(routing.allowedTools).toContain("cancel_appointment");
    expect(routing.turnDirective).not.toMatch(/confirmar/);
  });

  it("the name turn records the offered slot", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "awaiting_name",
      hasPersonName: true,
    });
    expect(routing.allowedTools).toContain("create_appointment");
    expect(routing.allowedTools).toContain("reschedule_appointment");
  });

  it("still waiting for the name does not record", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "awaiting_name",
      hasPersonName: false,
      isAffirmative: true,
    });
    expect(routing.allowedTools).not.toContain("create_appointment");
    expect(routing.turnDirective).toMatch(/nome/);
  });

  it("a charge reply that does not move the appointment has no agenda tool", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "idle",
      hasUpcomingAppointment: true,
      replyingToPlanCharge: true,
    });
    expect(routing.allowedTools).not.toContain("reschedule_appointment");
    expect(routing.allowedTools).not.toContain("create_appointment");
    expect(routing.allowedTools).not.toContain("check_availability");
    expect(routing.turnDirective).toMatch(/plano/);
  });

  it("a reschedule asked after a charge may still check", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("reschedule"),
      conversationState: "idle",
      hasUpcomingAppointment: true,
      replyingToPlanCharge: true,
    });
    expect(routing.primaryIntent).toBe("reschedule");
    expect(routing.turnDirective).toMatch(/Qual hora/);
    expect(routing.turnDirective).not.toMatch(/plano/);
  });

  it("a clock without a service asks only for the service", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1, dateTime: { time: "06:00" } }),
      conversationState: "idle",
      carriedClock: "18:00",
    });
    expect(routing.primaryIntent).toBe("unknown");
    expect(routing.turnDirective).toMatch(/serviço/);
    expect(routing.allowedTools).not.toContain("create_appointment");
  });

  it("a service named after a carried clock may check", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", {
        confidence: 0.1,
        service: { name: "Sobrancelha", ids: ["svc-sobrancelha"], confidence: 0.85 },
      }),
      conversationState: "collecting",
      carriedClock: "18:00",
    });
    expect(routing.primaryIntent).toBe("schedule");
    expect(routing.allowedTools).toContain("check_availability");
  });

  it("an ambiguous corte on a new booking asks which service and does not check", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("schedule", { service: "ambiguous", dateTime: { date: "2026-10-02", time: "17:00" } }),
      conversationState: "collecting",
    });
    expect(routing.allowedTools).not.toContain("check_availability");
    expect(routing.turnDirective).toMatch(/combo/);
  });

  it("an ambiguous corte on an existing appointment may check", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("reschedule", { service: "ambiguous" }),
      conversationState: "idle",
      hasUpcomingAppointment: true,
      carriedServiceIds: ["svc-combo"],
    });
    expect(routing.turnDirective).toMatch(/Qual hora/);
    expect(routing.turnDirective).not.toMatch(/combo/);
    expect(routing.allowedTools).not.toContain("check_availability");
  });

  it("presence with a pending reminder may confirm", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("presence"),
      conversationState: "reminder_24h_pending",
      hasUpcomingAppointment: true,
      isAffirmative: true,
    });
    expect(routing.allowedTools).toContain("confirm_appointment");
  });

  it("unknown on a pending reminder does not confirm", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "reminder_24h_pending",
      hasUpcomingAppointment: true,
    });
    expect(routing.allowedTools).not.toContain("confirm_appointment");
  });

  it("waitlist without the clock cannot record", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("waitlist", { dateTime: { date: "2026-10-01", time: "14:00" } }),
      conversationState: "idle",
    });
    expect(routing.allowedTools).not.toContain("add_to_waitlist");
    expect(routing.turnDirective).toMatch(/serviço/);
  });

  it("sim records the waitlist only when that offer is open", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "idle",
      isAffirmative: true,
      waitlistOfferOpen: true,
    });
    expect(routing.allowedTools).toContain("add_to_waitlist");
  });

  it("plan without a stated name only asks the name", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("plan"),
      conversationState: "idle",
      hasPersonName: false,
      hasActiveSubscription: false,
    });
    expect(routing.allowedTools).not.toContain("subscribe_client_to_plan");
    expect(routing.turnDirective).toMatch(/nome/);
    expect(routing.nextPending).toEqual({ intents: ["plan"], offered: true });
  });

  it("the name turn resumes the plan and may subscribe", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.1 }),
      conversationState: "idle",
      hasPersonName: true,
      pendingIntents: { intents: ["plan"], offered: true },
    });
    expect(routing.primaryIntent).toBe("plan");
    expect(routing.allowedTools).toContain("subscribe_client_to_plan");
    expect(routing.allowedTools).toContain("send_pix_plan_charge");
  });

  it("someone who already has a plan is charged, not subscribed again", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("plan"),
      conversationState: "idle",
      hasPersonName: true,
      hasActiveSubscription: true,
    });
    expect(routing.allowedTools).toContain("send_pix_plan_charge");
    expect(routing.allowedTools).not.toContain("subscribe_client_to_plan");
  });

  it("schedule without a clock asks the hour and does not invent one", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("schedule"),
      conversationState: "collecting",
    });
    expect(routing.turnDirective).toMatch(/Qual hora/);
    expect(routing.allowedTools).not.toContain("check_availability");
    expect(routing.allowedTools).not.toContain("create_appointment");
  });

  it("a clock without a service asks the service and does not check", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("schedule", { dateTime: { date: "2026-10-03", time: "18:00" } }),
      conversationState: "idle",
      carriedClock: "18:00",
    });
    expect(routing.turnDirective).toMatch(/Qual serviço/);
    expect(routing.allowedTools).not.toContain("check_availability");
    expect(routing.allowedTools).not.toContain("create_appointment");
  });

  it("a named barber on an open draft includes that barber's check", () => {
    const routing = orchestrate({
      ...base,
      intentSet: intent("unknown", { confidence: 0.4 }),
      conversationState: "slot_offered",
      hasActiveBookingDraft: true,
      carriedClock: "17:00",
      carriedServiceIds: ["svc-combo"],
      namedBarberThisTurn: true,
    });
    expect(routing.allowedTools).toContain("check_availability");
  });
});
