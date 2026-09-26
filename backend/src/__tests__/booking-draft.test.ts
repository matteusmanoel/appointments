import { describe, it, expect } from "vitest";
import {
  composeOccupiedSlot,
  composeHoursOverflow,
  composeClosedDay,
  composeUnavailableReply,
  applyTurnToDraft,
  draftIsCloseable,
  emptyBookingDraft,
  lockOfferedSlot,
  mergeBookingDraft,
  parseBookingDraft,
  offeredClockFromUnavailable,
  pickRequestedBarber,
  resolveBarberFromText,
  resolveMultipleServicesFromText,
  resolveServiceFromText,
} from "../ai/booking-draft.js";

const CORTE = { id: "d4ad6587-1437-4853-b6f0-8d059485b99d", name: "Corte masculino", price: 35 };
const COMBO = { id: "522142c0-7621-4f88-825b-ad5f0c82c6a5", name: "Corte e Barba", category: "combo", price: 55 };
const LUCAS = "a9354524-6859-40fb-9b52-f3b2ef322b35";
const EDUARDO = "df811fd9-91e3-4060-8cf0-ad3cd4dfff5c";
const BARBERS = [
  { id: EDUARDO, name: "Eduardo Gustavo" },
  { id: LUCAS, name: "Lucas Lima" },
];

describe("mergeBookingDraft", () => {
  it("does not clear fields when the patch omits them", () => {
    const prev = mergeBookingDraft(emptyBookingDraft(), {
      service_ids: [CORTE.id],
      service_name: CORTE.name,
      barber_id: LUCAS,
      date: "2026-09-22",
      time: "18:00",
      status: "offered",
    });
    const next = mergeBookingDraft(prev, { status: "offered" });
    expect(next.time).toBe("18:00");
    expect(next.service_ids).toEqual([CORTE.id]);
    expect(next.status).toBe("offered");
  });

  it("resets offered → collecting when the client corrects time or service", () => {
    const offered = mergeBookingDraft(emptyBookingDraft(), {
      service_ids: [CORTE.id],
      barber_id: LUCAS,
      date: "2026-09-22",
      time: "18:00",
      status: "offered",
    });
    const combo = mergeBookingDraft(offered, { service_ids: [COMBO.id], service_name: COMBO.name });
    expect(combo.status).toBe("collecting");
    expect(combo.service_ids).toEqual([COMBO.id]);
    const at17 = mergeBookingDraft(combo, { time: "17:00" });
    expect(at17.time).toBe("17:00");
    expect(at17.status).toBe("collecting");
  });

  it("resets a closed Eduardo draft when the turn names Lucas", () => {
    const closed = mergeBookingDraft(emptyBookingDraft(), {
      service_ids: [COMBO.id],
      barber_id: EDUARDO,
      barber_name: "Eduardo Gustavo",
      date: "2026-09-21",
      time: "18:30",
      status: "closed",
    });
    const named = mergeBookingDraft(closed, { barber_id: LUCAS, barber_name: "Lucas Lima" });
    expect(named.barber_id).toBe(LUCAS);
    expect(named.status).toBe("collecting");
  });

  it("close uses the offered combo 17h snapshot, not a stale 18h corte", () => {
    const stale = mergeBookingDraft(emptyBookingDraft(), {
      service_ids: [CORTE.id],
      service_name: CORTE.name,
      barber_id: LUCAS,
      date: "2026-09-22",
      time: "18:00",
      status: "offered",
    });
    const current = mergeBookingDraft(stale, {
      service_ids: [COMBO.id],
      service_name: COMBO.name,
      time: "17:00",
      status: "offered",
    });
    expect(draftIsCloseable(current)).toBe(true);
    expect(current.time).toBe("17:00");
    expect(current.service_ids).toEqual([COMBO.id]);
    expect(current.time).not.toBe("18:00");
  });
});

describe("resolveServiceFromText", () => {
  const catalog = [CORTE, COMBO];

  it("asks to disambiguate when the text only says corte and both simple and combo exist", () => {
    const r = resolveServiceFromText("quero agendar meu corte na segunda", catalog);
    expect(r.ambiguous?.simple.id).toBe(CORTE.id);
    expect(r.ambiguous?.combo.id).toBe(COMBO.id);
    expect(r.match).toBeUndefined();
  });

  it("corte e barba in the current turn wins over a simple-corte draft", () => {
    const r = resolveServiceFromText("seria corte e barba", catalog);
    expect(r.match?.id).toBe(COMBO.id);
  });

  it("equivalent phrasing also maps to the combo", () => {
    expect(resolveServiceFromText("quero o combo", catalog).match?.id).toBe(COMBO.id);
    expect(resolveServiceFromText("corte + barba com o Lucas", catalog).match?.id).toBe(COMBO.id);
  });
});

describe("composeOccupiedSlot", () => {
  it("omits the barber name when both alternatives are the same person", () => {
    const out = composeOccupiedSlot({
      barberName: "Lucas Lima",
      timeHHmm: "18:30",
      alternatives: [
        { time: "17:00", barber_name: "Lucas Lima" },
        { time: "19:00", barber_name: "Lucas Lima" },
      ],
    });
    expect(out).toMatch(/18h30/);
    expect(out).toMatch(/Lucas/);
    expect(out).toMatch(/preenchido/);
    expect(out).toMatch(/17h/);
    expect(out.split("com o Lucas").length).toBeLessThanOrEqual(2);
    expect(out).not.toMatch(/2026-09/);
  });

  it("names the other barber at the same clock and asks preference", () => {
    const out = composeOccupiedSlot({
      barberName: "Lucas Lima",
      timeHHmm: "18:30",
      alternatives: [],
      sameTimeOthers: [{ barber_name: "Eduardo Gustavo" }],
    });
    expect(out).toMatch(/Eduardo/);
    expect(out).toMatch(/só com o Lucas/i);
    expect(out).not.toMatch(/preenchido/);
  });

  it("holds the requested barber when day, clock and barber are pinned", () => {
    const out = composeOccupiedSlot({
      barberName: "Lucas Lima",
      timeHHmm: "10:00",
      alternatives: [],
      sameTimeOthers: [{ barber_name: "Eduardo Gustavo" }],
      holdRequestedBarber: true,
    });
    expect(out).toMatch(/Lucas/);
    expect(out).toMatch(/te aviso/i);
    expect(out).not.toMatch(/Eduardo/);
  });
});

describe("composeHoursOverflow / closed", () => {
  it("invites the last-fit window instead of saying the slot is filled", () => {
    const out = composeHoursOverflow({
      lastFitTime: "18:00",
      lastFitBarberName: "Eduardo Gustavo",
      isToday: false,
    });
    expect(out).toMatch(/18h/);
    expect(out).toMatch(/Eduardo/);
    expect(out).not.toMatch(/preenchido/);
    expect(out).not.toMatch(/19h/);
    expect(composeUnavailableReply({
      reason: "hours_overflow",
      barberName: "Eduardo Gustavo",
      timeHHmm: "18:30",
      alternatives: [],
      lastFitTime: "18:00",
      lastFitBarberName: "Eduardo Gustavo",
      isToday: false,
    })).toBe(out);
  });

  it("names the opening time when the request was before the shop opens", () => {
    const out = composeHoursOverflow({
      lastFitTime: "09:00",
      lastFitBarberName: "Eduardo Gustavo",
      isToday: false,
      requestedTime: "08:00",
      opensAt: "09:00",
    });
    expect(out).toMatch(/Abrimos às 9h/);
    expect(out).toMatch(/primeiro horário/);
    expect(out).not.toMatch(/preenchido/);
  });

  it("draft clock becomes last_fit, not the refused request", () => {
    expect(
      offeredClockFromUnavailable({
        requestedTime: "18:30",
        reason: "hours_overflow",
        lastFitTime: "18:00",
      }),
    ).toBe("18:00");
    expect(
      offeredClockFromUnavailable({
        requestedTime: "18:30",
        reason: "occupied",
        lastFitTime: "18:00",
      }),
    ).toBe("18:30");
    const prev = mergeBookingDraft(emptyBookingDraft(), {
      service_ids: [COMBO.id],
      service_name: COMBO.name,
      barber_id: LUCAS,
      barber_name: "Lucas Lima",
      date: "2026-09-21",
      time: "18:30",
      status: "collecting",
    });
    const next = mergeBookingDraft(prev, {
      time: offeredClockFromUnavailable({
        requestedTime: "18:30",
        reason: "hours_overflow",
        lastFitTime: "18:00",
      }),
      status: "collecting",
    });
    expect(next.time).toBe("18:00");
    expect(draftIsCloseable(next)).toBe(false);
  });

  it("says the shop is closed and offers the next open day", () => {
    const out = composeClosedDay({ weekdayPt: "domingo", nextOpenWeekdayPt: "segunda-feira" });
    expect(out).toMatch(/não abre/i);
    expect(out).toMatch(/segunda/);
  });
});

describe("parseBookingDraft", () => {
  it("ignores junk and keeps valid snapshot fields", () => {
    const d = parseBookingDraft({
      status: "offered",
      service_ids: [COMBO.id, "not-a-uuid"],
      time: "17:00:00",
      date: "2026-09-22",
      barber_id: LUCAS,
    });
    expect(d.service_ids).toEqual([COMBO.id]);
    expect(d.time).toBe("17:00");
    expect(draftIsCloseable(d)).toBe(true);
  });
});

describe("resolveBarberFromText", () => {
  it("maps o Lucas to Lucas Lima and com o Eduardo to Eduardo Gustavo", () => {
    expect(resolveBarberFromText("o Lucas teria disponibilidade?", BARBERS)?.id).toBe(LUCAS);
    expect(resolveBarberFromText("Pode ser as 17h com o Lucas então", BARBERS)?.id).toBe(LUCAS);
    expect(resolveBarberFromText("com o Eduardo amanhã", BARBERS)?.id).toBe(EDUARDO);
  });
});

describe("pickRequestedBarber", () => {
  it("does not pick Eduardo just because the name sorts first", () => {
    const pool = [
      { barber_id: EDUARDO, barber_name: "Eduardo Gustavo" },
      { barber_id: LUCAS, barber_name: "Lucas Lima" },
    ];
    const picked = pickRequestedBarber(pool, LUCAS);
    expect(picked?.barber_id).toBe(LUCAS);
    expect(picked?.barber_name).toMatch(/Lucas/);
    expect(pickRequestedBarber(pool)?.barber_id).toBe(EDUARDO);
  });

  it("keeps the requested barber when occupancy list is empty and alts name him", () => {
    const named = pickRequestedBarber(
      [{ barber_id: LUCAS, barber_name: "Lucas Lima" }],
      LUCAS,
    );
    expect(named?.barber_id).toBe(LUCAS);
    expect(named?.barber_name).toMatch(/Lucas/);
  });
});

// ─── Round 2 regression: date priority hoje → amanhã ─────────────────────────

import { bookingDateFromUserTurn } from "../ai/conversation-intents.js";

describe("date priority: current-turn date beats stale draft (Round 2)", () => {
  it("bookingDateFromUserTurn correctly resolves 'amanhã' from current turn", () => {
    const today = "2026-09-21";
    const tomorrow = "2026-09-22";
    // Simulates the client saying "amanhã" when the draft already has today
    const result = bookingDateFromUserTurn("pode ser amanhã às 18h", today);
    expect(result?.date).toBe(tomorrow);
    expect(result?.source).toBe("amanha");
  });

  it("'hoje' resolves to today's date", () => {
    const today = "2026-09-21";
    const result = bookingDateFromUserTurn("quero hoje às 17h", today);
    expect(result?.date).toBe(today);
  });

  it("shop-hours question does not produce a booking date", () => {
    expect(bookingDateFromUserTurn("estão abertos hoje?", "2026-09-21")).toBeNull();
  });
});

// ─── Round 3 regression: verbal service forms ────────────────────────────────

describe("resolveServiceFromText — verbal forms (Round 3)", () => {
  const catalog = [CORTE, COMBO];

  it("'quero cortar meu cabelo' triggers ambiguous when both exist", () => {
    const r = resolveServiceFromText("quero cortar meu cabelo", catalog);
    expect(r.ambiguous?.simple.id).toBe(CORTE.id);
    expect(r.ambiguous?.combo.id).toBe(COMBO.id);
    expect(r.match).toBeUndefined();
  });

  it("'vou aparar o cabelo' triggers ambiguous when both exist", () => {
    const r = resolveServiceFromText("vou aparar o cabelo", catalog);
    expect(r.ambiguous?.simple.id).toBe(CORTE.id);
    expect(r.ambiguous?.combo.id).toBe(COMBO.id);
  });

  it("'pode cortar' triggers ambiguous when both exist", () => {
    const r = resolveServiceFromText("pode cortar", catalog);
    expect(r.ambiguous?.simple.id).toBe(CORTE.id);
    expect(r.ambiguous?.combo.id).toBe(COMBO.id);
  });

  it("a full catalog name wins over the corte ambiguity heuristic", () => {
    const barba = { id: "00000000-0000-4000-8000-0000000000b1", name: "Barba completa", price: 25 };
    const r = resolveServiceFromText("quero barba completa, não corte", [CORTE, COMBO, barba]);
    expect(r.match?.id).toBe(barba.id);
    expect(r.ambiguous).toBeUndefined();
  });

  it("'fazer a barba' matches the barba service, not the combo", () => {
    const barba = { id: "00000000-0000-4000-8000-0000000000b1", name: "Barba completa", price: 25 };
    const r = resolveServiceFromText("Quero fazer a barba. Qualquer barbeiro", [CORTE, COMBO, barba]);
    expect(r.match?.id).toBe(barba.id);
  });

  it("'quero cortar a barba' does NOT enter the corte-only path", () => {
    // 'barba' guard prevents false-positive corte match
    const r = resolveServiceFromText("quero cortar a barba", catalog);
    expect(r.ambiguous).toBeUndefined();
    // Should not match simple corte; may match combo or remain unresolved
  });

  it("simple catalog resolves to the only service when no combo exists", () => {
    // When catalog has only simple corte, should resolve directly
    const r = resolveServiceFromText("quero cortar meu cabelo", [CORTE]);
    expect(r.match?.id).toBe(CORTE.id);
  });

  // Semantic variant with different terminology (anti-whack-a-mole validation)
  it("'preciso de um corte rápido' also triggers disambiguation", () => {
    const r = resolveServiceFromText("preciso de um corte rápido", catalog);
    expect(r.ambiguous?.simple.id).toBe(CORTE.id);
    expect(r.ambiguous?.combo.id).toBe(COMBO.id);
  });
});

describe("after_time floor on the draft", () => {
  it("survives parse and is not cleared when a later patch omits it", () => {
    const parsed = parseBookingDraft({
      status: "collecting",
      barber_id: LUCAS,
      date: "2026-09-21",
      after_time: "18:00",
      service_ids: [COMBO.id],
    });
    expect(parsed.after_time).toBe("18:00");
    expect(parsed.time).toBeUndefined();
    const next = mergeBookingDraft(parsed, { service_name: COMBO.name });
    expect(next.after_time).toBe("18:00");
    expect(next.date).toBe("2026-09-21");
    expect(next.service_ids).toEqual([COMBO.id]);
  });

  it("promotes an exact clock into the floor when the turn is only 'ou após'", () => {
    const exact = mergeBookingDraft(emptyBookingDraft(), {
      barber_id: LUCAS,
      date: "2026-09-21",
      time: "18:00",
      status: "offered",
    });
    const floored = applyTurnToDraft(exact, {}, { floorWithoutClock: true });
    expect(floored.after_time).toBe("18:00");
    expect(floored.time).toBeUndefined();
    expect(floored.status).toBe("collecting");
  });

  it("locks a concrete offer and drops the floor", () => {
    const collecting = mergeBookingDraft(emptyBookingDraft(), {
      service_ids: [COMBO.id],
      barber_id: LUCAS,
      barber_name: "Lucas Lima",
      date: "2026-09-22",
      after_time: "18:00",
      status: "collecting",
    });
    const offered = lockOfferedSlot(collecting, {
      date: "2026-09-22",
      time: "18:00",
      barber_id: LUCAS,
      barber_name: "Lucas Lima",
    });
    expect(offered.status).toBe("offered");
    expect(offered.time).toBe("18:00");
    expect(offered.date).toBe("2026-09-22");
    expect(offered.after_time).toBeUndefined();
    expect(draftIsCloseable(offered)).toBe(true);
  });
});

// ─── Negated "corte" ("não o corte") must resolve to barba, not the ambiguous
// corte/combo prompt (mem-04 regression) ─────────────────────────────────────

describe("resolveServiceFromText — negation of corte", () => {
  const barba = { id: "00000000-0000-4000-8000-0000000000b1", name: "Barba completa", price: 25 };
  const catalog = [CORTE, COMBO, barba];

  it("'quero fazer a barba desta vez, não o corte' matches barba, not the ambiguous prompt", () => {
    const r = resolveServiceFromText("Quero fazer a barba desta vez, não o corte", catalog);
    expect(r.match?.id).toBe(barba.id);
    expect(r.ambiguous).toBeUndefined();
  });

  it("'sem corte, só a barba' also matches barba only", () => {
    const r = resolveServiceFromText("sem corte, só a barba", catalog);
    expect(r.match?.id).toBe(barba.id);
    expect(r.ambiguous).toBeUndefined();
  });

  it("without negation, bare 'corte' still triggers the ambiguous prompt", () => {
    const r = resolveServiceFromText("quero corte", catalog);
    expect(r.ambiguous?.simple.id).toBe(CORTE.id);
    expect(r.ambiguous?.combo.id).toBe(COMBO.id);
  });
});

// ─── Multiple distinct services named in the same message (edge-08 regression) ──

describe("resolveMultipleServicesFromText", () => {
  const barba = { id: "00000000-0000-4000-8000-0000000000b1", name: "Barba completa", price: 25 };
  const sobrancelha = { id: "00000000-0000-4000-8000-0000000000b2", name: "Sobrancelha", price: 15 };
  const catalog = [CORTE, COMBO, barba, sobrancelha];

  it("'corte, barba e sobrancelha' returns all 3 distinct catalog services", () => {
    const found = resolveMultipleServicesFromText("Quero fazer corte, barba e sobrancelha. Tem horário?", catalog);
    const ids = found.map((s) => s.id).sort();
    expect(ids).toEqual([CORTE.id, barba.id, sobrancelha.id].sort());
  });

  it("'corte e barba' alone (combo phrasing) resolves to the combo, not 2 separate services", () => {
    const found = resolveMultipleServicesFromText("Quero corte e barba amanhã", catalog);
    expect(found).toEqual([]);
  });

  it("a single service mentioned returns an empty array (caller falls back to resolveServiceFromText)", () => {
    expect(resolveMultipleServicesFromText("Quero só a barba", catalog)).toEqual([]);
  });
});
