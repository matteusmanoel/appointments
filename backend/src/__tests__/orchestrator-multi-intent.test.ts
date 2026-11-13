import { describe, expect, it } from "vitest";
import { orchestrate } from "../ai/agent/orchestrator.js";
import { understandTurn } from "../ai/agent/understanding.js";
import { composePendingIntentOffer, parsePendingIntents } from "../ai/agent/pending-intents.js";
import type { ConversationState } from "../ai/agent/types.js";

const services = [
  { id: "s-corte", name: "Corte masculino" },
  { id: "s-barba", name: "Barba" },
];
const barbers = [{ id: "b-lucas", name: "Lucas" }];

function route(
  text: string,
  opts: {
    state?: ConversationState;
    upcoming?: boolean;
    draft?: boolean;
    pending?: { intents: string[]; offered: boolean };
    affirmative?: boolean;
  } = {},
) {
  const intentSet = understandTurn({
    text,
    todayIso: "2026-09-26",
    services,
    barbers,
    previousState: opts.state ?? "idle",
  });
  return orchestrate({
    intentSet,
    conversationState: opts.state ?? "idle",
    hasUpcomingAppointment: opts.upcoming ?? true,
    hasActiveBookingDraft: opts.draft ?? false,
    pendingIntents: parsePendingIntents(opts.pending ?? null),
    isAffirmative: opts.affirmative ?? false,
  });
}

describe("orchestrate — multiple intents in one turn", () => {
  it("handles the reschedule first and defers the plan question (real case)", () => {
    const r = route("quero remarcar pra sexta às 14h e também queria saber dos planos");
    expect(r.primaryIntent).toBe("reschedule");
    expect(r.handleNow).toEqual(["reschedule"]);
    expect(r.deferred).toEqual(["plan"]);
    expect(r.nextPending).toEqual({ intents: ["plan"], offered: false });
  });

  it("runs payment alongside a new booking in the same turn (different wording)", () => {
    const r = route("quero agendar um corte amanhã às 10h e me manda o pix");
    expect(r.primaryIntent).toBe("schedule");
    expect(r.handleNow).toEqual(["schedule", "payment"]);
    expect(r.deferred).toEqual([]);
  });

  it("keeps pending intents while the transaction is still open", () => {
    const r = route("pode ser às 15h então", {
      state: "slot_offered",
      draft: true,
      pending: { intents: ["plan"], offered: false },
    });
    expect(r.nextPending).toEqual({ intents: ["plan"], offered: false });
    expect(r.resumedPending).toEqual([]);
  });

  it("resumes the offered pending intent on a bare yes after the transaction closed", () => {
    const r = route("sim", { pending: { intents: ["plan"], offered: true }, affirmative: true });
    expect(r.primaryIntent).toBe("plan");
    expect(r.resumedPending).toEqual(["plan"]);
    expect(r.nextPending).toEqual({ intents: [], offered: false });
  });

  it("never lets a pending offer steal a yes that answers the open slot", () => {
    const r = route("sim", {
      state: "slot_offered",
      draft: true,
      pending: { intents: ["plan"], offered: true },
      affirmative: true,
    });
    expect(r.resumedPending).toEqual([]);
  });

  it("drops an offered pending intent once the client moves on", () => {
    const r = route("onde fica a barbearia?", { pending: { intents: ["plan"], offered: true } });
    expect(r.primaryIntent).toBe("location");
    expect(r.nextPending).toEqual({ intents: [], offered: false });
  });

  it("clears a pending intent the client asks for directly", () => {
    const r = route("me fala dos planos", { pending: { intents: ["plan"], offered: false } });
    expect(r.primaryIntent).toBe("plan");
    expect(r.nextPending.intents).toEqual([]);
  });

  it("does not authorize recording when the turn has no recognized intent", () => {
    const r = route("queria saber de uma coisa");
    expect(r.primaryIntent).toBe("unknown");
    expect(r.recordingAuthorized).toBe(false);
    expect(r.waitlistMissingClock).toBeNull();
  });

  it("authorizes recording for a recognized transactional intent", () => {
    const r = route("quero remarcar pra sexta às 14h");
    expect(r.primaryIntent).toBe("reschedule");
    expect(r.recordingAuthorized).toBe(true);
  });

  it("keeps waitlist pending while another transaction is open", () => {
    const r = route("quero agendar um corte amanhã às 10h e me avisa se liberar um horário");
    expect(r.primaryIntent).toBe("schedule");
    expect(r.deferred).toContain("waitlist");
    expect(r.handleNow).not.toContain("waitlist");
    expect(r.waitlistMissingClock).toBeNull();
  });

  it("asks only for the missing waitlist clock and does not treat the turn as ready to record", () => {
    const r = route("me coloca na lista de espera amanhã às 14:00");
    expect(r.primaryIntent).toBe("waitlist");
    expect(r.handleNow).toContain("waitlist");
    expect(r.waitlistMissingClock).toEqual(["service"]);
    expect(r.recordingAuthorized).toBe(true);
  });

  it("finds a complete waitlist clock when day, hour and service are already in the turn", () => {
    const r = route("me coloca na lista de espera para corte masculino amanhã às 14:00");
    expect(r.primaryIntent).toBe("waitlist");
    expect(r.waitlistMissingClock).toBeNull();
    expect(r.recordingAuthorized).toBe(true);
  });
});

describe("pending intents", () => {
  it("parses only known pendable intents", () => {
    expect(parsePendingIntents({ intents: ["plan", "schedule", "bogus"], offered: true })).toEqual({
      intents: ["plan"],
      offered: true,
    });
    expect(parsePendingIntents(null)).toEqual({ intents: [], offered: false });
  });

  it("composes one offer for all pending intents", () => {
    expect(composePendingIntentOffer(["plan"])).toBe("Você também comentou sobre os planos — quer que eu te passe agora?");
    expect(composePendingIntentOffer(["plan", "waitlist"])).toContain("os planos e a lista de espera");
  });
});
