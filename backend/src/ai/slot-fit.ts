export type UnavailableReason = "closed" | "hours_overflow" | "occupied" | "past";

export function minutesToHHmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Last 30-min start in the window where duration still fits, not before minStart. */
export function lastFitStartMins(params: {
  durationMins: number;
  windowStart: number;
  windowEnd: number;
  minStart: number | null;
  step?: number;
}): number | null {
  const step = params.step ?? 30;
  const duration = params.durationMins;
  if (!(duration > 0) || params.windowEnd <= params.windowStart) return null;
  const latest = params.windowEnd - duration;
  if (latest < params.windowStart) return null;
  let start = Math.floor(latest / step) * step;
  while (start >= params.windowStart) {
    if (start + duration <= params.windowEnd && (params.minStart == null || start >= params.minStart)) {
      return start;
    }
    start -= step;
  }
  return null;
}

/**
 * First 30-min start in the window where duration still fits, not before minStart.
 * Mirror of lastFitStartMins — used when the client asked for a time *before* opening,
 * so the offered alternative is the start of the day rather than the end of it.
 */
export function firstFitStartMins(params: {
  durationMins: number;
  windowStart: number;
  windowEnd: number;
  minStart: number | null;
  step?: number;
}): number | null {
  const step = params.step ?? 30;
  const duration = params.durationMins;
  if (!(duration > 0) || params.windowEnd <= params.windowStart) return null;
  let start = params.minStart != null ? Math.max(params.windowStart, params.minStart) : params.windowStart;
  start = Math.ceil(start / step) * step;
  while (start + duration <= params.windowEnd) {
    return start;
  }
  return null;
}

/** Hours-window classification. Lunch/conflict is occupied; duration past closing is hours_overflow. */
export function classifyRequestedSlot(params: {
  requestedStart: number;
  durationMins: number;
  windowStart: number;
  windowEnd: number;
  minStart: number | null;
  inUnavailability?: boolean;
}): UnavailableReason | null {
  const end = params.requestedStart + params.durationMins;
  if (params.minStart != null && params.requestedStart < params.minStart) return "past";
  if (params.inUnavailability) return "occupied";
  if (end > params.windowEnd && params.requestedStart >= params.windowStart) return "hours_overflow";
  if (params.requestedStart < params.windowStart || end > params.windowEnd) return "hours_overflow";
  return null;
}
