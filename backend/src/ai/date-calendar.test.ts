import { describe, expect, it } from "vitest";
import { alignSpokenHour, describeShopOpenStatus, shopOpenStatusNow } from "./date-calendar.js";

const hours = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "19:00" },
  sunday: null,
};

describe("shop hours and spoken clock", () => {
  it("before opening the day still opens today", () => {
    const status = shopOpenStatusNow({
      todayIso: "2026-09-30",
      nowHHmm: "08:10",
      businessHours: hours,
    });
    expect(status.open).toBe(false);
    if (!status.open && status.notYetOpen) {
      expect(status.opensAt).toBe("09:00");
    } else {
      throw new Error("expected not-yet-open");
    }
  });

  it("after close the day has ended", () => {
    const status = shopOpenStatusNow({
      todayIso: "2026-09-30",
      nowHHmm: "19:10",
      businessHours: hours,
    });
    expect(status.open).toBe(false);
    expect(status.notYetOpen).toBeFalsy();
    if (!status.open && !status.notYetOpen) expect(status.closedAt).toBe("19:00");
  });

  it("às 6 before opening is 18h when the afternoon still fits", () => {
    expect(alignSpokenHour("amanhã às 6", "06:00", "09:00", "19:00")).toBe("18:00");
    expect(alignSpokenHour("quero agendar com o Lucas amanhã às 6", "06:00", "09:00", "19:00")).toBe("18:00");
  });

  it("da manhã stays in the morning", () => {
    expect(alignSpokenHour("amanhã às 6 da manhã", "06:00", "09:00", "19:00")).toBe("06:00");
  });

  it("asks when the afternoon hour also falls outside", () => {
    expect(alignSpokenHour("às 6", "06:00", "09:00", "17:00")).toBe("06:00");
  });

  it("says the shop fact without an internal status label", () => {
    const open = shopOpenStatusNow({
      todayIso: "2026-09-30",
      nowHHmm: "10:00",
      businessHours: hours,
    });
    const before = shopOpenStatusNow({
      todayIso: "2026-09-30",
      nowHHmm: "08:10",
      businessHours: hours,
    });
    expect(describeShopOpenStatus(open)).toBe("A loja está aberta agora e fecha às 19:00.");
    expect(describeShopOpenStatus(before)).toBe("A loja ainda não abriu hoje. Começa às 09:00.");
    expect(describeShopOpenStatus(open).toLowerCase()).not.toContain("status agora");
  });
});
