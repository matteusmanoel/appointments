import { describe, it, expect } from "vitest";
import {
  addDaysIso,
  formatWeekCalendarForTools,
  nextDateForWeekday,
  nextOpenIso,
  shopOpenStatusNow,
  dateToolMeta,
  weekdayPtFromIso,
  weekdayShortPtFromIso,
  resolveClientDateFromText,
  pickExecutedToolDate,
  alignSpokenHour,
  parseClientTime,
  pickExecutedToolTime,
  formatTimePt,
  formatResumoWhen,
  stripTrailingBubblePeriod,
  splitOutgoingBubbles,
} from "../ai/date-calendar.js";

const HOURS = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

describe("date calendar", () => {
  it("maps Saturday 19/09/2026 próxima segunda to 21/09/2026, not Sunday", () => {
    expect(nextDateForWeekday("2026-09-19", 1)).toBe("2026-09-21");
    expect(weekdayPtFromIso("2026-09-20")).toBe("domingo");
    expect(weekdayPtFromIso("2026-09-21")).toBe("segunda-feira");
    expect(weekdayShortPtFromIso("2026-09-21")).toBe("segunda");
    expect(weekdayShortPtFromIso("2026-09-22")).toBe("terça");
  });

  it("next open after a closed Sunday is Monday", () => {
    expect(nextOpenIso("2026-09-20", HOURS)).toBe("2026-09-21");
    const meta = dateToolMeta("2026-09-20", HOURS);
    expect(meta.weekday_pt).toBe("domingo");
    expect(meta.next_open_date).toBe("2026-09-21");
    expect(meta.next_open_weekday_pt).toBe("segunda-feira");
  });

  it("calendar lists coming Monday as 2026-09-21 from Saturday", () => {
    const cal = formatWeekCalendarForTools("2026-09-19");
    expect(cal).toContain("hoje: sábado 19/09/2026 → 2026-09-19");
    expect(cal).toContain("amanhã: domingo 20/09/2026 → 2026-09-20");
    expect(cal).toContain("segunda-feira 21/09/2026 → 2026-09-21");
    expect(addDaysIso("2026-09-19", 2)).toBe("2026-09-21");
  });
});

describe("shopOpenStatusNow", () => {
  it("is open mid-afternoon and names the closing time", () => {
    const status = shopOpenStatusNow({ todayIso: "2026-09-21", nowHHmm: "15:30", businessHours: HOURS });
    expect(status.open).toBe(true);
    if (status.open) expect(status.closesAt).toBe("19:00");
  });

  it("is closed after hours and points at the next opening", () => {
    const status = shopOpenStatusNow({ todayIso: "2026-09-21", nowHHmm: "22:00", businessHours: HOURS });
    expect(status.open).toBe(false);
    if (!status.open) {
      expect(status.closedAt).toBe("19:00");
      expect(status.nextOpenDate).toBe("2026-09-22");
      expect(status.nextOpensAt).toBe("09:00");
    }
  });

  it("is closed all day on a day with no hours", () => {
    const status = shopOpenStatusNow({ todayIso: "2026-09-20", nowHHmm: "12:00", businessHours: HOURS });
    expect(status.open).toBe(false);
    if (!status.open) expect(status.nextOpenDate).toBe("2026-09-21");
  });
});

describe("resolveClientDateFromText", () => {
  it("resolves próxima segunda as 10h on Saturday night to Monday, not Sunday", () => {
    const r = resolveClientDateFromText(
      "Quero agendar um corte e barba com o Lucas na próxima segunda as 10h",
      "2026-09-19",
    );
    expect(r).toEqual({ date: "2026-09-21", source: "weekday" });
  });

  it("resolves weekday without 'próxima' and a semantically similar request", () => {
    expect(resolveClientDateFromText("quero corte na segunda 14h", "2026-09-19")?.date).toBe("2026-09-21");
    expect(resolveClientDateFromText("tem horário terça-feira?", "2026-09-19")?.date).toBe("2026-09-22");
    expect(resolveClientDateFromText("amanhã às 10h", "2026-09-19")?.date).toBe("2026-09-20");
  });

  it("does not infer a date from time-only phrasing", () => {
    expect(resolveClientDateFromText("as 10h", "2026-09-19")).toBeNull();
    expect(resolveClientDateFromText("quero agendar um corte", "2026-09-19")).toBeNull();
  });

  it("'depois de amanhã' adds 2 days, not 1 (must not be swallowed by the 'amanhã' check)", () => {
    const r = resolveClientDateFromText("pode ser depois de amanhã às 14h", "2026-09-19");
    expect(r).toEqual({ date: "2026-09-21", source: "depois_de_amanha" });
  });

  it("plain 'amanhã' still resolves to +1 day", () => {
    expect(resolveClientDateFromText("amanhã às 14h", "2026-09-19")?.date).toBe("2026-09-20");
  });
});

describe("pickExecutedToolDate", () => {
  it("does not let time-only fallback override the model's Monday", () => {
    expect(
      pickExecutedToolDate({
        desiredDate: "2026-09-20",
        desiredSource: "time_fallback",
        toolDate: "2026-09-21",
      }),
    ).toBe("2026-09-21");
  });

  it("keeps weekday from the user when the model drifts", () => {
    expect(
      pickExecutedToolDate({
        desiredDate: "2026-09-21",
        desiredSource: "weekday",
        toolDate: "2026-09-20",
      }),
    ).toBe("2026-09-21");
  });
});

describe("parseClientTime", () => {
  it("keeps minutes in as 18:30h instead of collapsing to 18:00", () => {
    expect(parseClientTime("as 18:30h")).toBe("18:30");
    expect(parseClientTime("às 18:30")).toBe("18:30");
    expect(parseClientTime("18h30")).toBe("18:30");
  });

  it("reads às 6 as 18h when the shop is already open at 9h", () => {
    expect(alignSpokenHour("amanha as 6", "06:00", "09:00", "19:00")).toBe("18:00");
    expect(alignSpokenHour("as 6 da manha", "06:00", "09:00", "19:00")).toBe("06:00");
    expect(alignSpokenHour("as 18h", "18:00", "09:00", "19:00")).toBe("18:00");
    expect(alignSpokenHour("as 10", "10:00", "09:00", "19:00")).toBe("10:00");
  });

  it("parses an equivalent half-hour on another weekday", () => {
    expect(parseClientTime("terça 14h30")).toBe("14:30");
    expect(parseClientTime("Pode ser as 17")).toBe("17:00");
    expect(formatTimePt("18:30")).toBe("18h30");
  });
});

describe("formatResumoWhen and bubbles", () => {
  it("prefixes Hoje and Amanhã with weekday + dd/MM", () => {
    expect(formatResumoWhen("2026-09-20", "17:00", "2026-09-20")).toBe("Hoje, domingo 20/09 às 17h");
    expect(formatResumoWhen("2026-09-21", "17:00", "2026-09-20")).toBe("Amanhã, segunda 21/09 às 17h");
    expect(formatResumoWhen("2026-09-22", "13:00", "2026-09-20")).toBe("Terça, 22/09 às 13h");
  });

  it("strips a trailing period and caps [[MSG]] at 3 bubbles", () => {
    expect(stripTrailingBubblePeriod("Posso te encaixar hoje às 18h.")).toBe("Posso te encaixar hoje às 18h");
    expect(stripTrailingBubblePeriod("Fica bom pra você?")).toBe("Fica bom pra você?");
    expect(splitOutgoingBubbles("A.[[MSG]]B.[[MSG]]C.[[MSG]]D.")).toEqual(["A", "B", "C"]);
  });
});

describe("pickExecutedToolTime", () => {
  it("does not let an hour-only parse overwrite a more specific tool time", () => {
    expect(pickExecutedToolTime({ desiredTime: "18:00", toolTime: "18:30" })).toBe("18:30");
    expect(pickExecutedToolTime({ desiredTime: "18:30", toolTime: "18:00" })).toBe("18:30");
  });
});
