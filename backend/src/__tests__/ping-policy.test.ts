import { describe, it, expect } from "vitest";
import { shouldPingOwner, occupancyOpened, formatOwnerPing } from "../agenda/ping-policy.js";

describe("shouldPingOwner", () => {
  it("pings AI create and AI/client_link cancel/reschedule", () => {
    expect(shouldPingOwner({ type: "appointment_created", actor: "ai" })).toBe(true);
    expect(shouldPingOwner({ type: "cancelled", actor: "ai" })).toBe(true);
    expect(shouldPingOwner({ type: "rescheduled", actor: "client_link" })).toBe(true);
  });

  it("does not ping owner panel edits", () => {
    expect(shouldPingOwner({ type: "appointment_created", actor: "owner" })).toBe(false);
    expect(shouldPingOwner({ type: "cancelled", actor: "owner" })).toBe(false);
    expect(shouldPingOwner({ type: "rescheduled", actor: "owner" })).toBe(false);
  });

  it("does not ping RSVP, reminder or PIX", () => {
    expect(shouldPingOwner({ type: "confirmed", actor: "ai" })).toBe(false);
    expect(shouldPingOwner({ type: "reminder_sent", actor: "system" })).toBe(false);
    expect(shouldPingOwner({ type: "payment_recognized", actor: "ai" })).toBe(false);
  });
});

describe("occupancyOpened", () => {
  it("is true for cancel/reschedule/no_show", () => {
    expect(occupancyOpened("cancelled")).toBe(true);
    expect(occupancyOpened("rescheduled")).toBe(true);
    expect(occupancyOpened("no_show")).toBe(true);
    expect(occupancyOpened("appointment_created")).toBe(false);
    expect(occupancyOpened("confirmed")).toBe(false);
    expect(occupancyOpened("payment_recognized")).toBe(false);
  });
});

describe("formatOwnerPing", () => {
  it("keeps a short occupancy message", () => {
    expect(
      formatOwnerPing({
        barbershopId: "x",
        appointmentId: "y",
        type: "cancelled",
        actor: "ai",
        clientName: "João",
        scheduledTime: "14:00:00",
      }),
    ).toBe("Agenda: João cancelou 14:00 — slot livre.");
  });
});
