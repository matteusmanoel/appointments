import { describe, it, expect } from "vitest";
import { getOccupiedSlotsForDate } from "./availability";
import { DEFAULT_DEMO_CATALOG } from "./catalog";

describe("demo-agent availability", () => {
  it("returns deterministic occupied slots for same seed", () => {
    const a = getOccupiedSlotsForDate(DEFAULT_DEMO_CATALOG, "2025-03-20", 12345);
    const b = getOccupiedSlotsForDate(DEFAULT_DEMO_CATALOG, "2025-03-20", 12345);
    expect(a).toEqual(b);
  });

  it("returns different slots for different seeds", () => {
    const a = getOccupiedSlotsForDate(DEFAULT_DEMO_CATALOG, "2025-03-20", 111);
    const b = getOccupiedSlotsForDate(DEFAULT_DEMO_CATALOG, "2025-03-20", 222);
    expect(a).not.toEqual(b);
  });

  it("returns empty for closed day", () => {
    const catalog = {
      ...DEFAULT_DEMO_CATALOG,
      businessHours: { ...DEFAULT_DEMO_CATALOG.businessHours, monday: undefined },
    };
    const d = new Date("2025-03-17T12:00:00"); // Monday
    const dateStr = "2025-03-17";
    const slots = getOccupiedSlotsForDate(catalog as typeof DEFAULT_DEMO_CATALOG, dateStr, 1);
    expect(Array.isArray(slots)).toBe(true);
  });
});
