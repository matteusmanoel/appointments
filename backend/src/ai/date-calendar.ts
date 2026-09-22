const WEEKDAY_EN = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const WEEKDAY_PT = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

export type WeekdayKey = (typeof WEEKDAY_EN)[number];

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function weekdayIndexFromIso(iso: string): number {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

export function weekdayKeyFromIso(iso: string): WeekdayKey {
  return WEEKDAY_EN[weekdayIndexFromIso(iso)] ?? "monday";
}

export function weekdayPtFromIso(iso: string): string {
  return WEEKDAY_PT[weekdayIndexFromIso(iso)] ?? iso;
}

export function weekdayShortPtFromIso(iso: string): string {
  return weekdayPtFromIso(iso).replace(/-feira$/, "");
}

export function formatDateBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Upcoming occurrence of weekday. If today is that weekday, "próxima" = +7. */
export function nextDateForWeekday(fromIso: string, targetDow: number): string {
  const from = weekdayIndexFromIso(fromIso);
  const delta = (targetDow - from + 7) % 7;
  return addDaysIso(fromIso, delta === 0 ? 7 : delta);
}

export function shopOpensOnIso(
  iso: string,
  businessHours: Record<string, { start?: string; end?: string } | null | undefined> | null | undefined,
): boolean {
  const day = businessHours?.[weekdayKeyFromIso(iso)];
  if (!day || typeof day !== "object") return false;
  const s = String(day.start ?? "").slice(0, 5);
  const e = String(day.end ?? "").slice(0, 5);
  return Boolean(s && e);
}

export function nextOpenIso(
  fromIso: string,
  businessHours: Record<string, { start?: string; end?: string } | null | undefined> | null | undefined,
  maxDays = 14,
): string | null {
  for (let i = 1; i <= maxDays; i++) {
    const iso = addDaysIso(fromIso, i);
    if (shopOpensOnIso(iso, businessHours)) return iso;
  }
  return null;
}

export function dateToolMeta(
  iso: string,
  businessHours?: Record<string, { start?: string; end?: string } | null | undefined> | null,
): {
  date: string;
  date_br: string;
  weekday: WeekdayKey;
  weekday_pt: string;
  next_open_date?: string;
  next_open_date_br?: string;
  next_open_weekday_pt?: string;
} {
  const next = nextOpenIso(iso, businessHours ?? null);
  return {
    date: iso,
    date_br: formatDateBr(iso),
    weekday: weekdayKeyFromIso(iso),
    weekday_pt: weekdayPtFromIso(iso),
    ...(next
      ? {
          next_open_date: next,
          next_open_date_br: formatDateBr(next),
          next_open_weekday_pt: weekdayPtFromIso(next),
        }
      : {}),
  };
}

const WEEKDAY_PATTERNS: Array<{ re: RegExp; dow: number }> = [
  { re: /\bdomingo\b/, dow: 0 },
  { re: /\bsegunda(?:\s*-?\s*feira)?\b/, dow: 1 },
  { re: /\bterca(?:\s*-?\s*feira)?\b/, dow: 2 },
  { re: /\bquarta(?:\s*-?\s*feira)?\b/, dow: 3 },
  { re: /\bquinta(?:\s*-?\s*feira)?\b/, dow: 4 },
  { re: /\bsexta(?:\s*-?\s*feira)?\b/, dow: 5 },
  { re: /\bsabado\b/, dow: 6 },
];

export type ClientDateSource = "hoje" | "amanha" | "depois_de_amanha" | "weekday" | "iso" | "br" | "time_fallback";

function foldPt(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Map client phrasing to a yyyy-MM-dd. Does not infer from time-only ("às 10h"). */
export function resolveClientDateFromText(text: string, todayIso: string): { date: string; source: ClientDateSource } | null {
  const t = foldPt(text);
  // Must be checked before the plain "amanhã" pattern below — "depois de amanhã"
  // contains "amanha" as a substring, so it would otherwise be misread as +1 day
  // instead of +2 days.
  if (/\bdepois\s+de\s+amanha\b/.test(t)) return { date: addDaysIso(todayIso, 2), source: "depois_de_amanha" };
  if (/\bamanha\b/.test(t)) return { date: addDaysIso(todayIso, 1), source: "amanha" };
  if (/\bhoje\b/.test(t) || /\bagora\b/.test(t)) return { date: todayIso, source: "hoje" };

  const forceNextWeek = /\bproxim[oa]\b|\bque vem\b/.test(t);
  for (const { re, dow } of WEEKDAY_PATTERNS) {
    if (!re.test(t)) continue;
    const from = weekdayIndexFromIso(todayIso);
    if (from === dow) {
      return { date: forceNextWeek ? addDaysIso(todayIso, 7) : todayIso, source: "weekday" };
    }
    return { date: addDaysIso(todayIso, (dow - from + 7) % 7), source: "weekday" };
  }

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return { date: iso[1], source: "iso" };

  const br = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (br?.[1] && br?.[2]) {
    const dd = String(parseInt(br[1], 10)).padStart(2, "0");
    const mm = String(parseInt(br[2], 10)).padStart(2, "0");
    const yearPart = br[3];
    const year =
      yearPart && yearPart.length === 4
        ? yearPart
        : yearPart && yearPart.length === 2
          ? `20${yearPart}`
          : todayIso.slice(0, 4);
    return { date: `${year}-${mm}-${dd}`, source: "br" };
  }

  return null;
}

/**
 * Time-only fallback ("às 10h" with no day) must not override a valid date the model already chose.
 * Weekday/explicit dates from the user do override a wrong tool date.
 */
export function pickExecutedToolDate(params: {
  desiredDate?: string;
  desiredSource?: ClientDateSource;
  toolDate?: string;
}): string {
  const desired = params.desiredDate && /^\d{4}-\d{2}-\d{2}$/.test(params.desiredDate) ? params.desiredDate : "";
  const tool = params.toolDate && /^\d{4}-\d{2}-\d{2}$/.test(params.toolDate) ? params.toolDate : "";
  if (desired && params.desiredSource === "time_fallback" && tool && tool !== desired) return tool;
  return desired || tool;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatTimePt(timeHHmm: string): string {
  const [hh, mm] = (timeHHmm ?? "00:00").split(":");
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return timeHHmm;
  return m === 0 ? `${h}h` : `${h}h${pad2(m)}`;
}

/** Aceite summary: Hoje/Amanhã + weekday + dd/MM + time; from day 3 only weekday. */
export function formatResumoWhen(dateIso: string, timeHHmm: string, todayIso: string): string {
  const short = weekdayShortPtFromIso(dateIso);
  const br = formatDateBr(dateIso);
  const ddmm = br.length >= 5 ? br.slice(0, 5) : br;
  const timePt = formatTimePt(timeHHmm);
  const tomorrowIso = addDaysIso(todayIso, 1);
  if (dateIso === todayIso) return `Hoje, ${short} ${ddmm} às ${timePt}`;
  if (dateIso === tomorrowIso) return `Amanhã, ${short} ${ddmm} às ${timePt}`;
  const cap = short ? short.charAt(0).toUpperCase() + short.slice(1) : dateIso;
  return `${cap}, ${ddmm} às ${timePt}`;
}

/** Strip a single period ending a bubble; keep ? ! and ellipsis. */
export function stripTrailingBubblePeriod(text: string): string {
  return (text ?? "").replace(/(\S)\.(?=\s*$)/, "$1").trimEnd();
}

/** Two conversational moves split on [[MSG]]; cap at 3 bubbles. */
export function splitOutgoingBubbles(text: string): string[] {
  return String(text ?? "")
    .split("[[MSG]]")
    .map((p) => stripTrailingBubblePeriod(p.trim()))
    .filter((p) => p.length > 0)
    .slice(0, 3);
}

function normalizeHHmm(hRaw: string, mRaw?: string): string | null {
  const h = parseInt(hRaw, 10);
  const m = mRaw == null || mRaw === "" ? 0 : parseInt(mRaw, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * Client clock time. `18:30` / `18h30` win over `as 18` so a colon is not treated as a word boundary.
 */
export function parseClientTime(text: string): string | null {
  const raw = text ?? "";
  const hm = raw.match(/\b(\d{1,2})\s*[:hH]\s*(\d{2})h?\b/i);
  if (hm?.[1] && hm[2]) return normalizeHHmm(hm[1], hm[2]);

  const asHm = raw.match(/\b(?:às|as|a)\s*(\d{1,2}):(\d{2})h?\b/i);
  if (asHm?.[1] && asHm[2]) return normalizeHHmm(asHm[1], asHm[2]);

  const asHour = raw.match(/\b(?:às|as|à)\s*(\d{1,2})\s*h?\b/i);
  if (asHour?.[1]) return normalizeHHmm(asHour[1], "0");

  const hOnly = raw.match(/\b(\d{1,2})\s*h\b/i);
  if (hOnly?.[1]) return normalizeHHmm(hOnly[1], "0");

  return null;
}

/** Prefer client time; if parse dropped minutes (`18:00` vs tool `18:30`), keep the more specific tool time. */
export function pickExecutedToolTime(params: { desiredTime?: string; toolTime?: string }): string {
  const norm = (raw?: string) => {
    const t = String(raw ?? "").replace(/^(\d{2}):(\d{2})(?::\d{2})?$/, "$1:$2");
    return /^\d{2}:\d{2}$/.test(t) ? t : "";
  };
  const desired = norm(params.desiredTime);
  const tool = norm(params.toolTime);
  if (desired && tool) {
    if (desired.endsWith(":00") && !tool.endsWith(":00") && desired.slice(0, 2) === tool.slice(0, 2)) {
      return tool;
    }
    return desired;
  }
  return desired || tool;
}

/** Compact calendar so relative weekdays ("próxima segunda") are not guessed. */
export function formatWeekCalendarForTools(todayIso: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDaysIso(todayIso, i);
    const prefix = i === 0 ? "hoje: " : i === 1 ? "amanhã: " : "";
    lines.push(`- ${prefix}${weekdayPtFromIso(iso)} ${formatDateBr(iso)} → ${iso}`);
  }
  return lines.join("\n");
}
