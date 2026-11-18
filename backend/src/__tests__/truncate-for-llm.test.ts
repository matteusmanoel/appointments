import { describe, expect, it } from "vitest";
import { truncateForLlm } from "../ai/tools.js";
import { isoDay } from "../ai/agent.js";

describe("truncateForLlm dates", () => {
  it("turns a Postgres DATE into yyyy-MM-dd instead of an empty object", () => {
    const day = new Date("2026-11-18T00:00:00.000Z");
    expect(truncateForLlm({ scheduled_date: day, time: "18:30:00" })).toEqual({
      scheduled_date: "2026-11-18",
      time: "18:30:00",
    });
    expect(isoDay(day)).toBe("2026-11-18");
  });
});
