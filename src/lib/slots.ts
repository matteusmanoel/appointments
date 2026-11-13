import type { BusinessHours } from "@/lib/api";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DEFAULT_SLOTS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00", "18:30", "19:00", "19:30",
];

/** Returns true if slot [slotStartM, slotStartM+30) overlaps any unavailability interval. */
function slotInUnavailability(
  slotStartM: number,
  intervals: { start: string; end: string }[] | undefined
): boolean {
  if (!Array.isArray(intervals) || intervals.length === 0) return false;
  const slotEndM = slotStartM + 30;
  for (const i of intervals) {
    const iStart = parseTime(i.start);
    const iEnd = parseTime(i.end);
    if (iStart == null || iEnd == null) continue;
    if (slotStartM < iEnd && iStart < slotEndM) return true;
  }
  return false;
}

/**
 * Returns 30-minute time slots (HH:mm) for the given date based on barbershop business_hours.
 * Optionally filters out slots that fall inside closure or day-level unavailability_intervals.
 * If business_hours is undefined (e.g. before migration), returns default slots.
 * If the day is closed, returns [].
 */
export function getTimeSlotsForDay(
  businessHours: BusinessHours | undefined | null,
  date: Date,
  options?: {
    /** When provided (e.g. open_partial day), slots outside start/end are excluded and intervals applied */
    closure?: { start_time: string | null; end_time: string | null; unavailability_intervals?: { start: string; end: string }[] };
  }
): string[] {
  if (!businessHours || typeof businessHours !== "object") {
    return DEFAULT_SLOTS;
  }
  const dayIndex = date.getDay();
  const key = DAY_KEYS[dayIndex];
  let dayConfig = businessHours[key];
  let startMins: number;
  let endMins: number;
  let unavailabilityIntervals: { start: string; end: string }[] | undefined;

  if (options?.closure?.start_time != null && options.closure.end_time != null) {
    startMins = parseTime(options.closure.start_time.slice(0, 5));
    endMins = parseTime(options.closure.end_time.slice(0, 5));
    unavailabilityIntervals = options.closure.unavailability_intervals;
  } else {
    if (!dayConfig || typeof dayConfig !== "object" || !dayConfig.start || !dayConfig.end) {
      return [];
    }
    startMins = parseTime(dayConfig.start);
    endMins = parseTime(dayConfig.end);
    unavailabilityIntervals = dayConfig.unavailability_intervals;
  }

  if (endMins <= startMins) return [];
  const slots: string[] = [];
  const step = 30;
  for (let m = startMins; m < endMins; m += step) {
    if (!slotInUnavailability(m, unavailabilityIntervals)) {
      slots.push(formatMins(m));
    }
  }
  return slots;
}

export type BarberSchedule = Partial<Record<(typeof DAY_KEYS)[number], { start?: string; end?: string } | null>> | null | undefined;

/**
 * Filtra horários realmente reservável pelo link público para UM barbeiro:
 * - sem horários que já passaram (quando a data é hoje);
 * - dentro do expediente do barbeiro (barbers.schedule);
 * - cabendo a duração total dos serviços sem bater em outro agendamento
 *   (antes só o início do slot era checado, então serviços longos podiam sobrepor).
 * O backend continua sendo a autoridade (validateSlotForPublicReschedule).
 */
export function isSlotBookable(opts: {
  slot: string;
  date: Date;
  now?: Date;
  durationMinutes: number;
  occupied: Array<{ scheduled_time: string; duration_minutes: number }>;
  barberSchedule?: BarberSchedule;
  /** Limite de fechamento da barbearia no dia (minutos); se informado, o serviço precisa terminar até ele. */
  shopEndMinutes?: number | null;
}): boolean {
  const { slot, date, durationMinutes, occupied, barberSchedule } = opts;
  const now = opts.now ?? new Date();
  const start = parseTime(slot);
  const end = start + durationMinutes;
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay && start <= now.getHours() * 60 + now.getMinutes()) return false;
  const day = barberSchedule?.[DAY_KEYS[date.getDay()]];
  if (day && typeof day === "object") {
    if (day.start && start < parseTime(day.start)) return false;
    if (day.end && end > parseTime(day.end)) return false;
  }
  if (opts.shopEndMinutes != null && end > opts.shopEndMinutes) return false;
  for (const o of occupied) {
    const oStart = parseTime(String(o.scheduled_time).slice(0, 5));
    const oEnd = oStart + (o.duration_minutes ?? 30);
    if (start < oEnd && end > oStart) return false;
  }
  return true;
}
