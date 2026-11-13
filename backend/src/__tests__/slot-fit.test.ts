import { describe, it, expect } from "vitest";
import { classifyRequestedSlot, firstFitStartMins, lastFitStartMins, minutesToHHmm } from "../ai/slot-fit.js";

describe("classifyRequestedSlot / lastFitStartMins", () => {
  const windowStart = 9 * 60;
  const windowEnd = 19 * 60;

  it("combo 50 min at 18:30 vs close 19:00 is hours_overflow with last_fit 18:00", () => {
    const reason = classifyRequestedSlot({
      requestedStart: 18 * 60 + 30,
      durationMins: 50,
      windowStart,
      windowEnd,
      minStart: null,
    });
    expect(reason).toBe("hours_overflow");
    const last = lastFitStartMins({
      durationMins: 50,
      windowStart,
      windowEnd,
      minStart: null,
    });
    expect(last).toBe(18 * 60);
    expect(minutesToHHmm(last!)).toBe("18:00");
  });

  it("same overflow later in the day has no last_fit once the window has passed", () => {
    const reason = classifyRequestedSlot({
      requestedStart: 18 * 60 + 40,
      durationMins: 50,
      windowStart,
      windowEnd,
      minStart: 18 * 60 + 40,
    });
    expect(reason).toBe("hours_overflow");
    expect(
      lastFitStartMins({
        durationMins: 50,
        windowStart,
        windowEnd,
        minStart: 18 * 60 + 40,
      }),
    ).toBeNull();
  });

  it("a request before opening fits at the first slot of the day, not the last", () => {
    const reason = classifyRequestedSlot({
      requestedStart: 8 * 60,
      durationMins: 30,
      windowStart,
      windowEnd,
      minStart: null,
    });
    expect(reason).toBe("hours_overflow");
    const first = firstFitStartMins({ durationMins: 30, windowStart, windowEnd, minStart: null });
    expect(minutesToHHmm(first!)).toBe("09:00");
  });

  it("occupied lunch is not hours_overflow", () => {
    expect(
      classifyRequestedSlot({
        requestedStart: 12 * 60,
        durationMins: 50,
        windowStart,
        windowEnd,
        minStart: null,
        inUnavailability: true,
      }),
    ).toBe("occupied");
  });
});
