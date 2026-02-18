import { describe, it, expect } from "vitest";
import { getTimeSlotsForDay } from "./slots";
import type { BusinessHours } from "./api";

describe("getTimeSlotsForDay", () => {
  it("returns default slots when business_hours is undefined", () => {
    const date = new Date("2025-02-03T12:00:00"); // Monday
    const slots = getTimeSlotsForDay(undefined, date);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toMatch(/^\d{2}:\d{2}$/);
    expect(slots).toContain("09:00");
    expect(slots).toContain("19:30");
  });

  it("returns empty array when day is closed", () => {
    const hours: BusinessHours = {
      monday: null,
      tuesday: { start: "09:00", end: "18:00" },
      wednesday: { start: "09:00", end: "18:00" },
      thursday: { start: "09:00", end: "18:00" },
      friday: { start: "09:00", end: "18:00" },
      saturday: { start: "09:00", end: "18:00" },
      sunday: null,
    };
    const date = new Date("2025-02-03T12:00:00"); // Monday
    const slots = getTimeSlotsForDay(hours, date);
    expect(slots).toEqual([]);
  });

  it("returns 30-min slots for open day", () => {
    const hours: BusinessHours = {
      monday: { start: "09:00", end: "12:00" },
      tuesday: { start: "09:00", end: "18:00" },
      wednesday: { start: "09:00", end: "18:00" },
      thursday: { start: "09:00", end: "18:00" },
      friday: { start: "09:00", end: "18:00" },
      saturday: { start: "09:00", end: "18:00" },
      sunday: null,
    };
    const date = new Date("2025-02-03T12:00:00"); // Monday
    const slots = getTimeSlotsForDay(hours, date);
    expect(slots).toContain("09:00");
    expect(slots).toContain("09:30");
    expect(slots).toContain("11:30");
    expect(slots).not.toContain("12:00");
    expect(slots.length).toBe(6); // 09:00, 09:30, 10:00, 10:30, 11:00, 11:30
  });
});
