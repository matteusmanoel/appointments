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

/**
 * Returns 30-minute time slots (HH:mm) for the given date based on barbershop business_hours.
 * If business_hours is undefined (e.g. before migration), returns default slots.
 * If the day is closed, returns [].
 */
export function getTimeSlotsForDay(
  businessHours: BusinessHours | undefined | null,
  date: Date
): string[] {
  if (!businessHours || typeof businessHours !== "object") {
    return DEFAULT_SLOTS;
  }
  const dayIndex = date.getDay();
  const key = DAY_KEYS[dayIndex];
  const dayConfig = businessHours[key];
  if (!dayConfig || typeof dayConfig !== "object" || !dayConfig.start || !dayConfig.end) {
    return [];
  }
  const startMins = parseTime(dayConfig.start);
  let endMins = parseTime(dayConfig.end);
  if (endMins <= startMins) return [];
  const slots: string[] = [];
  const step = 30;
  for (let m = startMins; m < endMins; m += step) {
    slots.push(formatMins(m));
  }
  return slots;
}
