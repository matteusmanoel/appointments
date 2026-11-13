import { describe, expect, it } from "vitest";
import {
  closingMinutesForDay,
  composeManualWaitlistMessage,
  computeDispatchDeadline,
} from "../agenda/waitlist-dispatch.js";

describe("computeDispatchDeadline", () => {
  it("subtracts the service from the next appointment", () => {
    expect(
      computeDispatchDeadline({
        nowMins: 10 * 60,
        durationMinutes: 45,
        nextAppointmentMins: 16 * 60,
        nextAppointmentIsWaitlistedClient: false,
        closingMins: 19 * 60,
      }),
    ).toBe("15:15");
  });

  it("omits the deadline when the next appointment is the waitlisted client", () => {
    expect(
      computeDispatchDeadline({
        nowMins: 10 * 60,
        durationMinutes: 45,
        nextAppointmentMins: 16 * 60,
        nextAppointmentIsWaitlistedClient: true,
        closingMins: 19 * 60,
      }),
    ).toBeNull();
  });

  it("uses closing time when the barber has no later appointment", () => {
    expect(
      computeDispatchDeadline({
        nowMins: 10 * 60,
        durationMinutes: 45,
        nextAppointmentMins: null,
        nextAppointmentIsWaitlistedClient: false,
        closingMins: 19 * 60,
      }),
    ).toBe("19:00");
  });

  it("omits a deadline that would already have passed", () => {
    expect(
      computeDispatchDeadline({
        nowMins: 15 * 60 + 30,
        durationMinutes: 45,
        nextAppointmentMins: 16 * 60,
        nextAppointmentIsWaitlistedClient: false,
        closingMins: 19 * 60,
      }),
    ).toBeNull();
  });
});

describe("closingMinutesForDay", () => {
  it("prefers the barber schedule end, then the shop hours", () => {
    const wednesday = "2026-09-23";
    expect(
      closingMinutesForDay({
        dateIso: wednesday,
        businessHours: { wednesday: { start: "09:00", end: "19:00" } },
        barberSchedule: { wednesday: { start: "10:00", end: "18:00" } },
      }),
    ).toBe(18 * 60);
    expect(
      closingMinutesForDay({
        dateIso: wednesday,
        businessHours: { wednesday: { start: "09:00", end: "19:00" } },
        barberSchedule: {},
      }),
    ).toBe(19 * 60);
  });
});

describe("composeManualWaitlistMessage", () => {
  it("includes the deadline when there is one", () => {
    expect(
      composeManualWaitlistMessage({
        clientName: "Mateus Manoel",
        barberName: "Lucas Lima",
        deadlineHm: "15:00",
      }),
    ).toBe(
      "Mateus, o barbeiro Lucas Lima está disponível para te atender agora, consegue vir até as 15h?",
    );
  });

  it("drops the deadline when the next slot is the client being moved up", () => {
    expect(
      composeManualWaitlistMessage({
        clientName: "Mateus",
        barberName: "Lucas Lima",
        deadlineHm: null,
      }),
    ).toBe("Mateus, o barbeiro Lucas Lima está disponível para te atender agora, consegue vir?");
  });
});
