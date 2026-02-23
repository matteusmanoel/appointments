/**
 * Deterministic simulated occupancy per session (seed-based).
 * Generates fake "occupied" slots so some times appear busy and alternatives are shown.
 */

import type { DemoCatalog, DayKey } from "./types";

const DAY_KEYS: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Simple seeded PRNG (mulberry32). Returns 0..1. */
function seededRandom(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDayKey(dateStr: string): DayKey {
  const d = new Date(dateStr + "T12:00:00");
  return DAY_KEYS[d.getDay()];
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export interface OccupiedSlot {
  barber_id: string;
  start: number; // minutes from midnight
  end: number;
}

/**
 * Generate deterministic occupied slots for a date and barbershop.
 * Seed can be from session (e.g. hash of sessionId or number from localStorage).
 */
export function getOccupiedSlotsForDate(
  catalog: DemoCatalog,
  date: string,
  seed: number
): OccupiedSlot[] {
  const dayKey = getDayKey(date);
  const shopHours = catalog.businessHours[dayKey];
  if (!shopHours) return [];

  const startM = timeToMinutes(shopHours.start);
  const endM = timeToMinutes(shopHours.end);
  const rng = seededRandom(seed);

  const occupied: OccupiedSlot[] = [];
  const dateSeed = date.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng2 = seededRandom(seed + dateSeed);

  for (const barber of catalog.barbers) {
    const sched = barber.schedule[dayKey];
    const bStart = sched ? timeToMinutes(sched.start) : startM;
    const bEnd = sched ? timeToMinutes(sched.end) : endM;
    const range = bEnd - bStart;
    if (range < 30) continue;

    const numSlots = Math.floor(rng2() * 4) + 2;
    for (let i = 0; i < numSlots; i++) {
      const duration = 15 + Math.floor(rng() * 3) * 15;
      const maxStart = bEnd - duration - bStart;
      if (maxStart <= 0) continue;
      const offset = Math.floor(rng() * maxStart);
      const start = bStart + offset;
      occupied.push({
        barber_id: barber.id,
        start,
        end: start + duration,
      });
    }
  }

  return occupied;
}

/**
 * Get a stable seed for the current demo session (e.g. from sessionStorage or passed in).
 */
export function getSessionSeed(): number {
  if (typeof window === "undefined") return 42;
  const key = "demo_agent_seed";
  let v = sessionStorage.getItem(key);
  if (!v) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    v = String(arr[0]);
    sessionStorage.setItem(key, v);
  }
  return parseInt(v, 10) || 12345;
}
