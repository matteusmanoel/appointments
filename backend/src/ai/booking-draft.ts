import { pool } from "../db.js";
import { isValidUuid } from "../lib/uuid.js";
import { formatTimePt } from "./date-calendar.js";
import type { UnavailableReason } from "./slot-fit.js";

export type BookingDraftStatus = "collecting" | "offered" | "awaiting_name" | "closed";

export type BookingDraft = {
  service_ids?: string[];
  service_name?: string;
  barber_id?: string;
  barber_name?: string;
  date?: string;
  time?: string;
  /** Floor ("após as 18"), not an exact clock. */
  after_time?: string;
  total_price?: number;
  status: BookingDraftStatus;
  appointment_id?: string;
};

export type CatalogService = {
  id: string;
  name: string;
  category?: string;
  price?: number;
};

export type CatalogBarber = {
  id: string;
  name: string;
};

const STATUSES = new Set<BookingDraftStatus>(["collecting", "offered", "awaiting_name", "closed"]);

export function emptyBookingDraft(): BookingDraft {
  return { status: "collecting" };
}

export function parseBookingDraft(raw: unknown): BookingDraft {
  if (!raw || typeof raw !== "object") return emptyBookingDraft();
  const r = raw as Record<string, unknown>;
  const status = STATUSES.has(r.status as BookingDraftStatus) ? (r.status as BookingDraftStatus) : "collecting";
  const serviceIds = Array.isArray(r.service_ids)
    ? r.service_ids.map((id) => String(id)).filter((id) => isValidUuid(id))
    : undefined;
  const barberId = typeof r.barber_id === "string" && isValidUuid(r.barber_id) ? r.barber_id : undefined;
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined;
  const timeRaw = typeof r.time === "string" ? r.time.replace(/^(\d{2}):(\d{2})(?::\d{2})?$/, "$1:$2") : "";
  const time = /^\d{2}:\d{2}$/.test(timeRaw) ? timeRaw : undefined;
  const afterRaw = typeof r.after_time === "string" ? r.after_time.replace(/^(\d{2}):(\d{2})(?::\d{2})?$/, "$1:$2") : "";
  const afterTime = /^\d{2}:\d{2}$/.test(afterRaw) ? afterRaw : undefined;
  const appointmentId =
    typeof r.appointment_id === "string" && isValidUuid(r.appointment_id) ? r.appointment_id : undefined;
  const total = Number(r.total_price);
  return {
    status,
    ...(serviceIds?.length ? { service_ids: serviceIds } : {}),
    ...(typeof r.service_name === "string" && r.service_name.trim()
      ? { service_name: r.service_name.trim() }
      : {}),
    ...(barberId ? { barber_id: barberId } : {}),
    ...(typeof r.barber_name === "string" && r.barber_name.trim() ? { barber_name: r.barber_name.trim() } : {}),
    ...(date ? { date } : {}),
    ...(time ? { time } : {}),
    ...(afterTime ? { after_time: afterTime } : {}),
    ...(Number.isFinite(total) ? { total_price: total } : {}),
    ...(appointmentId ? { appointment_id: appointmentId } : {}),
  };
}

function sameIds(a?: string[], b?: string[]): boolean {
  const left = [...(a ?? [])].sort().join(",");
  const right = [...(b ?? [])].sort().join(",");
  return left === right;
}

/** Merge patch onto previous draft. Omission does not clear. Material change resets offered → collecting. */
export function mergeBookingDraft(prev: BookingDraft, patch: Partial<BookingDraft>): BookingDraft {
  const next: BookingDraft = { ...prev, status: prev.status ?? "collecting" };
  const keys: Array<keyof BookingDraft> = [
    "service_ids",
    "service_name",
    "barber_id",
    "barber_name",
    "date",
    "time",
    "after_time",
    "total_price",
    "appointment_id",
  ];
  let materialChanged = false;
  for (const key of keys) {
    const value = patch[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "service_ids") {
      const ids = (value as string[]).filter((id) => isValidUuid(id));
      if (!ids.length) continue;
      if (!sameIds(next.service_ids, ids)) materialChanged = true;
      next.service_ids = ids;
      continue;
    }
    if (key === "total_price") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      next.total_price = n;
      continue;
    }
    const asText = String(value).trim();
    if (!asText) continue;
    if (key === "barber_id" || key === "appointment_id") {
      if (!isValidUuid(asText)) continue;
    }
    if (
      (key === "date" || key === "time" || key === "after_time" || key === "barber_id" || key === "appointment_id") &&
      next[key] !== asText
    ) {
      materialChanged = true;
    }
    (next as Record<string, unknown>)[key] = asText;
  }
  if (patch.status && STATUSES.has(patch.status)) {
    next.status = patch.status;
  } else if (materialChanged) {
    next.status = "collecting";
  }
  return next;
}

/**
 * Apply a turn patch. A floor replaces an exact clock; an exact clock clears the floor.
 * "Ou após" without its own clock promotes the previous exact time into the floor.
 */
export function applyTurnToDraft(
  prev: BookingDraft,
  patch: Partial<BookingDraft>,
  opts?: { floorWithoutClock?: boolean },
): BookingDraft {
  const withFloor =
    opts?.floorWithoutClock && !patch.after_time && prev.time
      ? { ...patch, after_time: prev.time }
      : patch;
  const next = mergeBookingDraft(prev, withFloor);
  if (withFloor.after_time && /^\d{2}:\d{2}$/.test(withFloor.after_time)) {
    delete next.time;
    if (next.status === "offered" || next.status === "awaiting_name") next.status = "collecting";
  } else if (withFloor.time && /^\d{2}:\d{2}$/.test(String(withFloor.time))) {
    delete next.after_time;
  }
  return next;
}

/** Concrete offer the client can accept. The floor is no longer the search key. */
export function lockOfferedSlot(
  prev: BookingDraft,
  slot: { date: string; time: string; barber_id?: string; barber_name?: string; status?: BookingDraftStatus },
): BookingDraft {
  const next = mergeBookingDraft(prev, {
    date: slot.date,
    time: slot.time,
    ...(slot.barber_id ? { barber_id: slot.barber_id } : {}),
    ...(slot.barber_name ? { barber_name: slot.barber_name } : {}),
    status: slot.status ?? "offered",
  });
  delete next.after_time;
  return next;
}

export function draftIsCloseable(draft: BookingDraft): boolean {
  return (
    (draft.status === "offered" || draft.status === "awaiting_name") &&
    Boolean(draft.date) &&
    Boolean(draft.time) &&
    Boolean(draft.barber_id) &&
    (draft.service_ids?.length ?? 0) > 0
  );
}

function fold(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keyword-based service inference — for contexts where full resolveServiceFromText
 * is not needed (e.g. historical-text fallback, inline catalog selection).
 * Exported so agent.ts can reuse instead of duplicating.
 */
export function inferServiceKeyword(
  text: string,
): "corte" | "barba" | "sobrancelha" | "combo" | null {
  const t = fold(text);
  if (/\bcorte\s*\+\s*barba\b|\bcorte\s+e\s+barba\b|\bcombo\b/.test(t)) return "combo";
  if (/\bbarba\b/.test(t)) return "barba";
  if (/\bsobrancelha\b/.test(t)) return "sobrancelha";
  if (/\bcabelo|cortar|corte\b/.test(t)) return "corte";
  return null;
}

/**
 * Select one service from the catalog given raw user text.
 * Replaces the repeated `inferServiceKeyword + findBy` inline pattern in agent.ts.
 */
export function pickServiceFromCatalog(
  text: string,
  services: CatalogService[],
): CatalogService | undefined {
  if (!services.length) return undefined;
  const keyword = inferServiceKeyword(text);
  const findBy = (n: string) => services.find((s) => fold(s.name).includes(fold(n)));
  if (keyword === "combo") {
    return findBy("corte e barba") ?? findBy("corte + barba") ?? findBy("corte") ?? services[0];
  }
  if (keyword === "barba") return findBy("barba") ?? services[0];
  if (keyword === "sobrancelha") return findBy("sobrancelha") ?? services[0];
  if (keyword === "corte") return findBy("corte") ?? services[0];
  return services[0];
}

export function resolveServiceFromText(
  text: string,
  services: CatalogService[],
): { match?: CatalogService; ambiguous?: { simple: CatalogService; combo: CatalogService } } {
  const t = fold(text);
  if (!t || !services.length) return {};
  const combo =
    services.find((s) => fold(s.category ?? "") === "combo") ??
    services.find((s) => /\bcorte\b/.test(fold(s.name)) && /\bbarba\b/.test(fold(s.name)));
  const simple = services.find((s) => /\bcorte\b/.test(fold(s.name)) && !/\bbarba\b/.test(fold(s.name)));
  const barbaOnly = services.find((s) => /\bbarba\b/.test(fold(s.name)) && !/\bcorte\b/.test(fold(s.name)));

  const named = [...services]
    .filter((s) => fold(s.name).length >= 4 && t.includes(fold(s.name)))
    .sort((a, b) => fold(b.name).length - fold(a.name).length)[0];
  if (named) return { match: named };

  // Explicit negation of "corte" ("não o corte", "sem corte", "só a barba") must win
  // over the generic ambiguous corte/combo heuristic below — the client is explicitly
  // excluding corte, so "barba" alone (not the combo) is the intended service.
  const negatesCorte =
    /\bnao\b[^.!?]{0,24}\bcorte\b/.test(t) ||
    /\bsem\s+corte\b/.test(t) ||
    /\b(so|apenas|somente)\s+(a\s+)?barba\b/.test(t);
  if (negatesCorte && /\bbarba\b/.test(t) && barbaOnly) {
    return { match: barbaOnly };
  }

  if (/\bcorte\s+e\s+barba\b|\bcorte\s*\+\s*barba\b|\bcombo\b/.test(t)) {
    return combo ? { match: combo } : {};
  }
  if (/\b(so|apenas|somente)\s+corte\b|\bcorte\s+masculino\b/.test(t)) {
    return simple ? { match: simple } : {};
  }
  if (/\bcorte\b/.test(t) && combo && simple) {
    return { ambiguous: { simple, combo } };
  }
  // Verbal forms: "cortar", "cortar cabelo", "aparar", "cabelo" — treat as corte intent
  const looksLikeCorte = /\b(cortar?|aparar|cabelo)\b/.test(t) && !/\bbarba\b/.test(t);
  if (looksLikeCorte && combo && simple) return { ambiguous: { simple, combo } };
  if (looksLikeCorte && simple) return { match: simple };
  if (/\bbarba\b/.test(t) && !/\bcorte\b/.test(t) && barbaOnly) return { match: barbaOnly };
  return {};
}

/**
 * Detects multiple distinct services explicitly named in the same message
 * (e.g. "corte, barba e sobrancelha") and returns all matching catalog items.
 * The `service_ids` array (and create_appointment) already support N services
 * on the same appointment — this only fills the extraction gap so a message
 * naming 3 services doesn't collapse into a single (or zero) service.
 *
 * Returns an empty array when fewer than 2 distinct services are detected —
 * callers should fall back to `resolveServiceFromText` for the single/ambiguous
 * case (this function does not replicate that ambiguity handling).
 */
export function resolveMultipleServicesFromText(
  text: string,
  services: CatalogService[],
): CatalogService[] {
  const t = fold(text);
  if (!t || !services.length) return [];

  const combo =
    services.find((s) => fold(s.category ?? "") === "combo") ??
    services.find((s) => /\bcorte\b/.test(fold(s.name)) && /\bbarba\b/.test(fold(s.name)));
  const simple = services.find((s) => /\bcorte\b/.test(fold(s.name)) && !/\bbarba\b/.test(fold(s.name)));
  const barbaOnly = services.find((s) => /\bbarba\b/.test(fold(s.name)) && !/\bcorte\b/.test(fold(s.name)));
  const sobrancelha = services.find((s) => /\bsobrancelha\b/.test(fold(s.name)));

  const mentionsCombo = /\bcorte\s+e\s+barba\b|\bcorte\s*\+\s*barba\b|\bcombo\b/.test(t);
  const mentionsCorte = /\bcorte\b/.test(t) && !mentionsCombo;
  const mentionsBarba = /\bbarba\b/.test(t) && !mentionsCombo;
  const mentionsSobrancelha = /\bsobrancelha\b/.test(t);

  const found: CatalogService[] = [];
  if (mentionsCombo && combo) found.push(combo);
  if (mentionsCorte && simple) found.push(simple);
  if (mentionsBarba && barbaOnly) found.push(barbaOnly);
  if (mentionsSobrancelha && sobrancelha) found.push(sobrancelha);

  const seen = new Set<string>();
  const deduped = found.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return deduped.length >= 2 ? deduped : [];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match a catalog barber mentioned in the turn ("o Lucas" → Lucas Lima). No hardcoded names. */
export function resolveBarberFromText(text: string, barbers: CatalogBarber[]): CatalogBarber | undefined {
  const t = fold(text);
  if (!t || !barbers.length) return undefined;
  let best: { barber: CatalogBarber; score: number } | undefined;
  for (const barber of barbers) {
    const folded = fold(barber.name);
    if (!folded) continue;
    const first = folded.split(/\s+/)[0] ?? "";
    if (folded.length >= 4 && t.includes(folded)) {
      const score = folded.length + 20;
      if (!best || score > best.score) best = { barber, score };
      continue;
    }
    if (first.length >= 3 && new RegExp(`\\b${escapeRe(first)}\\b`).test(t)) {
      const score = first.length;
      if (!best || score > best.score) best = { barber, score };
    }
  }
  return best?.barber;
}

/**
 * When the client names a specific barber ("com o João") who does not resolve to
 * anyone in the roster (resolveBarberFromText returns nothing), returns that raw
 * name so callers can disclose the substitution ("Não temos o João, mas...")
 * instead of silently offering a different barber. Returns null when no name was
 * mentioned or when it resolved to a real barber.
 */
export function unknownNamedBarberFromText(text: string, barbers: CatalogBarber[]): string | null {
  const mentioned = text.match(/\bcom\s+o\s+([A-Za-zÀ-ÖØ-öø-ÿ']{3,})/i)?.[1];
  if (!mentioned) return null;
  return resolveBarberFromText(text, barbers) ? null : mentioned;
}

export function pickRequestedBarber(
  barbers: Array<{ barber_id?: string; barber_name?: string }>,
  preferredId?: string,
): { barber_id: string; barber_name: string } | undefined {
  const valid = barbers.filter((b) => typeof b.barber_id === "string" && isValidUuid(b.barber_id));
  if (preferredId && isValidUuid(preferredId)) {
    const hit = valid.find((b) => b.barber_id === preferredId);
    if (hit) return { barber_id: hit.barber_id!, barber_name: String(hit.barber_name ?? "").trim() };
  }
  const first = valid[0];
  if (!first?.barber_id) return undefined;
  return { barber_id: first.barber_id, barber_name: String(first.barber_name ?? "").trim() };
}

function firstNameOf(full: string): string {
  const t = full.trim().replace(/^o\s+/i, "");
  return t.split(/\s+/)[0] ?? t;
}

function sameBarberName(a?: string, b?: string): boolean {
  const left = fold(a ?? "");
  const right = fold(b ?? "");
  if (!left || !right) return !left && !right;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function formatAltPhrase(
  alts: Array<{ time: string; barber_name?: string }>,
  requestedBarberName: string,
): string {
  const items = alts.slice(0, 2);
  if (!items.length) return "";
  const names = items.map((a) => (a.barber_name ?? "").trim()).filter(Boolean);
  const allSame = names.length === items.length && names.every((n) => sameBarberName(n, names[0]));
  const allRequested = !names.length || names.every((n) => sameBarberName(n, requestedBarberName));

  const timeBit = (time: string) => `*${formatTimePt(time)}*`;
  if (items.length === 1) {
    const a = items[0]!;
    const name = !allRequested && a.barber_name ? ` com o ${firstNameOf(a.barber_name)}` : "";
    return `Tenho às ${timeBit(a.time)}${name}`;
  }
  const [a, b] = items;
  if (allRequested) {
    return `Tenho às ${timeBit(a.time)} ou às ${timeBit(b.time)}`;
  }
  if (allSame) {
    return `Tenho às ${timeBit(a.time)} ou às ${timeBit(b.time)} com o ${firstNameOf(names[0]!)}`;
  }
  const nameA = a.barber_name && !sameBarberName(a.barber_name, requestedBarberName) ? ` com o ${firstNameOf(a.barber_name)}` : "";
  const nameB = b.barber_name && !sameBarberName(b.barber_name, requestedBarberName) ? ` com o ${firstNameOf(b.barber_name)}` : "";
  return `Tenho às ${timeBit(a.time)}${nameA} ou às ${timeBit(b.time)}${nameB}`;
}

export function composeAskService(params?: { usualName?: string | null; formal?: boolean }): string {
  const usual = (params?.usualName ?? "").trim();
  if (params?.formal) {
    if (usual) return `Qual serviço gostaria de agendar? O de sempre, *${usual}*, se possível?`;
    return "Qual serviço você gostaria de agendar?";
  }
  if (usual) return `Qual serviço deseja? O de sempre, *${usual}*?`;
  return "Qual serviço deseja?";
}

export function composeAmbiguousCorte(params: { simpleName: string; comboName: string }): string {
  return `Seria só o *${params.simpleName}* ou o combo *${params.comboName}*?`;
}

export function composeClosedDay(params: {
  weekdayPt: string;
  dateBr?: string;
  nextOpenWeekdayPt?: string | null;
}): string {
  const day = params.weekdayPt.trim() || "nesse dia";
  if (params.nextOpenWeekdayPt) {
    return `Nesse ${day} a barbearia não abre[[MSG]]Posso te encaixar ${params.nextOpenWeekdayPt.replace(/-feira$/, "")}. Fica bom pra você?`;
  }
  return `Nesse ${day} a barbearia não abre. Qual outro dia te atende?`;
}

/** Once we invite last_fit, that clock is the draft candidate — not the refused request. */
export function offeredClockFromUnavailable(params: {
  requestedTime: string;
  reason: UnavailableReason | null;
  lastFitTime?: string | null;
}): string {
  const requested = params.requestedTime.slice(0, 5);
  const lastFit = (params.lastFitTime ?? "").slice(0, 5);
  if (
    (params.reason === "hours_overflow" || params.reason === "past") &&
    /^\d{2}:\d{2}$/.test(lastFit)
  ) {
    return lastFit;
  }
  return /^\d{2}:\d{2}$/.test(requested) ? requested : lastFit;
}

export function composeHoursOverflow(params: {
  lastFitTime?: string | null;
  lastFitBarberName?: string | null;
  isToday: boolean;
  nextOpenWeekdayPt?: string | null;
}): string {
  const who = params.lastFitBarberName ? ` com o ${firstNameOf(params.lastFitBarberName)}` : "";
  if (params.lastFitTime) {
    const when = formatTimePt(params.lastFitTime);
    const day = params.isToday ? "hoje" : "nesse dia";
    return `Posso te encaixar ${day} às ${when}${who}[[MSG]]Fica bom pra você?`;
  }
  if (params.nextOpenWeekdayPt) {
    return `Posso te encaixar ${params.nextOpenWeekdayPt.replace(/-feira$/, "")}${who}[[MSG]]Fica bom pra você?`;
  }
  return "Qual outro horário te atende?";
}

export function composeOccupiedSlot(params: {
  barberName: string;
  timeHHmm: string;
  alternatives: Array<{ time: string; barber_name?: string }>;
  sameTimeOthers?: Array<{ barber_name?: string }>;
}): string {
  const timePt = formatTimePt(params.timeHHmm);
  const rawName = params.barberName.trim().replace(/^o\s+/i, "");
  const who = rawName ? `o ${firstNameOf(rawName)}` : "o barbeiro";
  const other = (params.sameTimeOthers ?? []).find((b) => b.barber_name && !sameBarberName(b.barber_name, rawName));
  if (other?.barber_name) {
    const otherFirst = firstNameOf(other.barber_name);
    return (
      `Neste horário ${who} estará atendendo[[MSG]]` +
      `Posso te encaixar com o ${otherFirst} às ${timePt}. Fica bom? Ou seria só com o ${firstNameOf(rawName || "barbeiro")} mesmo`
    );
  }
  const alts = params.alternatives.slice(0, 2);
  if (alts.length === 0) {
    return `Esse horário das ${timePt} com ${who} já está preenchido[[MSG]]Posso ver outro dia ou horário?`;
  }
  const phrase = formatAltPhrase(alts, rawName);
  return `Esse horário das ${timePt} com ${who} já está preenchido[[MSG]]${phrase}. Qual prefere?`;
}

export function composeUnavailableReply(params: {
  reason: UnavailableReason | null;
  barberName: string;
  timeHHmm: string;
  alternatives: Array<{ time: string; barber_name?: string }>;
  sameTimeOthers?: Array<{ barber_name?: string }>;
  weekdayPt?: string;
  nextOpenWeekdayPt?: string | null;
  lastFitTime?: string | null;
  lastFitBarberName?: string | null;
  isToday?: boolean;
}): string {
  if (params.reason === "closed") {
    return composeClosedDay({
      weekdayPt: params.weekdayPt ?? "",
      nextOpenWeekdayPt: params.nextOpenWeekdayPt,
    });
  }
  if (params.reason === "hours_overflow" || params.reason === "past") {
    return composeHoursOverflow({
      lastFitTime: params.lastFitTime,
      lastFitBarberName: params.lastFitBarberName,
      isToday: Boolean(params.isToday),
      nextOpenWeekdayPt: params.nextOpenWeekdayPt,
    });
  }
  return composeOccupiedSlot({
    barberName: params.barberName,
    timeHHmm: params.timeHHmm,
    alternatives: params.alternatives,
    sameTimeOthers: params.sameTimeOthers,
  });
}

export async function loadBookingDraft(conversationId: string): Promise<BookingDraft> {
  try {
    const r = await pool.query<{ booking_draft: unknown }>(
      `SELECT booking_draft FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
      [conversationId],
    );
    return parseBookingDraft(r.rows[0]?.booking_draft);
  } catch {
    return emptyBookingDraft();
  }
}

export async function saveBookingDraft(conversationId: string, draft: BookingDraft): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.ai_conversation_runtime (conversation_id, booking_draft, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (conversation_id) DO UPDATE SET booking_draft = $2::jsonb, updated_at = now()`,
      [conversationId, JSON.stringify(draft)],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42703") return;
    console.warn("[booking-draft] save failed:", e instanceof Error ? e.message : e);
  }
}
