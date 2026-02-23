/**
 * Demo tools: list services, get next slots, check availability, create appointment.
 * Uses catalog and availability engine with seeded fake agenda.
 */

import type {
  DemoCatalog,
  DemoSessionState,
  Slot,
  CheckAvailabilityResult,
  GetNextSlotsResult,
} from "./types";
import { DEFAULT_DEMO_CATALOG } from "./catalog";
import { getOccupiedSlotsForDate } from "./availability";

export function listServices(catalog: DemoCatalog = DEFAULT_DEMO_CATALOG) {
  return catalog.services.map((s) => ({
    id: s.id,
    name: s.name,
    price: s.price,
    duration_minutes: s.durationMinutes,
    category: s.category,
  }));
}

const occupiedCache = new Map<string, ReturnType<typeof getOccupiedSlotsForDate>>();

function getOccupied(catalog: DemoCatalog, date: string, seed?: number) {
  if (seed == null) return [];
  const key = `${date}-${seed}`;
  if (!occupiedCache.has(key)) {
    occupiedCache.set(key, getOccupiedSlotsForDate(catalog, date, seed));
  }
  return occupiedCache.get(key)!;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function getNextSlots(
  catalog: DemoCatalog,
  params: {
    date: string;
    serviceIds: string[];
    afterTime?: string;
    barberId?: string | null;
    limit?: number;
    seed?: number;
  }
): GetNextSlotsResult {
  const limit = Math.min(params.limit ?? 5, 10);
  const duration = getTotalDuration(catalog, params.serviceIds);
  if (duration <= 0) return { date: params.date, slots: [] };

  const occupied = getOccupied(catalog, params.date, params.seed);
  const slots: Slot[] = [];
  const barbers = params.barberId
    ? catalog.barbers.filter((b) => b.id === params.barberId)
    : catalog.barbers;
  const dayKey = getDayKey(params.date);
  const shopHours = catalog.businessHours[dayKey];
  if (!shopHours) return { date: params.date, slots: [] };

  let startM = timeToMinutes(shopHours.start);
  const endM = timeToMinutes(shopHours.end);
  if (params.afterTime) {
    const after = timeToMinutes(params.afterTime);
    if (after > startM) startM = after;
  }
  const slotEndMax = endM - duration;
  const step = 15;

  for (let t = startM; t < slotEndMax && slots.length < limit; t += step) {
    const slotEnd = t + duration;
    const timeStr = minutesToTime(t);
    for (const b of barbers) {
      const sched = b.schedule[dayKey];
      const bStart = sched ? timeToMinutes(sched.start) : startM;
      const bEnd = sched ? timeToMinutes(sched.end) : endM;
      if (t < bStart || slotEnd > bEnd) continue;
      const barberOccupied = occupied.filter((o) => o.barber_id === b.id);
      const barberConflict = barberOccupied.some((o) => overlaps(t, slotEnd, o.start, o.end));
      if (!barberConflict) {
        slots.push({ time: timeStr, barber_id: b.id, barber_name: b.name });
        break;
      }
    }
  }

  return { date: params.date, slots, duration_minutes: duration };
}

export function checkAvailability(
  catalog: DemoCatalog,
  params: {
    date: string;
    time: string;
    serviceIds: string[];
    barberId?: string | null;
    afterTime?: string;
    occupiedSlots?: Array<{ barber_id: string; start: number; end: number }>;
    seed?: number;
  }
): CheckAvailabilityResult {
  const duration = getTotalDuration(catalog, params.serviceIds);
  const totalPrice = getTotalPrice(catalog, params.serviceIds);
  const startM = timeToMinutes(params.time);
  const endM = startM + duration;
  const dayKey = getDayKey(params.date);
  const shopHours = catalog.businessHours[dayKey];
  const occupied =
    params.occupiedSlots ?? getOccupied(catalog, params.date, params.seed);

  if (!shopHours) {
    return {
      date: params.date,
      time: params.time,
      duration_minutes: duration,
      total_price: totalPrice,
      requested: { available: false, barbers: [] },
      alternatives: [],
    };
  }

  const barbers = params.barberId
    ? catalog.barbers.filter((b) => b.id === params.barberId)
    : catalog.barbers;

  const availableBarbers: Array<{ barber_id: string; barber_name: string }> = [];
  for (const b of barbers) {
    const sched = b.schedule[dayKey];
    const bStart = sched ? timeToMinutes(sched.start) : timeToMinutes(shopHours.start);
    const bEnd = sched ? timeToMinutes(sched.end) : timeToMinutes(shopHours.end);
    if (startM < bStart || endM > bEnd) continue;
    const hasConflict = occupied.some(
      (o) => o.barber_id === b.id && startM < o.end && endM > o.start
    );
    if (!hasConflict) availableBarbers.push({ barber_id: b.id, barber_name: b.name });
  }

  let alternatives: CheckAvailabilityResult["alternatives"] = [];
  if (availableBarbers.length === 0) {
    const next = getNextSlots(catalog, {
      date: params.date,
      serviceIds: params.serviceIds,
      afterTime: params.time,
      limit: 3,
    });
    alternatives = next.slots.slice(0, 3).map((s) => ({
      time: s.time,
      barber_id: s.barber_id,
      barber_name: s.barber_name,
    }));
  }

  return {
    date: params.date,
    time: params.time,
    duration_minutes: duration,
    total_price: totalPrice,
    requested: {
      available: availableBarbers.length > 0,
      barbers: availableBarbers,
    },
    alternatives,
  };
}

export function createAppointment(
  catalog: DemoCatalog,
  state: DemoSessionState
): { ok: true; summary: string } {
  const serviceNames =
    catalog.services
      .filter((s) => state.serviceIds.includes(s.id))
      .map((s) => s.name)
      .join(" + ") || "Serviço";
  const barber = catalog.barbers.find((b) => b.id === state.barberId);
  const total = getTotalPrice(catalog, state.serviceIds);
  const summary = `${serviceNames} com ${barber?.name ?? "barbeiro"}, ${state.date} às ${state.time} — R$ ${total.toFixed(2).replace(".", ",")}`;
  return { ok: true, summary };
}

function getTotalDuration(catalog: DemoCatalog, serviceIds: string[]): number {
  return catalog.services
    .filter((s) => serviceIds.includes(s.id))
    .reduce((sum, s) => sum + s.durationMinutes, 0);
}

function getTotalPrice(catalog: DemoCatalog, serviceIds: string[]): number {
  return catalog.services
    .filter((s) => serviceIds.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0);
}

function getDayKey(dateStr: string): "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" {
  const d = new Date(dateStr + "T12:00:00");
  const i = d.getDay();
  const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  return keys[i];
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
