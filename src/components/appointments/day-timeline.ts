export const PX_PER_MINUTE_MOBILE = 1.2;
export const PX_PER_MINUTE_DESKTOP = 1.5;
export const MIN_BLOCK_PX = 28;
export const SLOT_MINUTES = 30;

export type TimelineRange = {
  startMin: number;
  endMin: number;
};

export type AppointmentSpanInput = {
  id: string;
  barberId: string;
  status: string;
  scheduledTime: string;
  durationMinutes: number | null;
  completedTime?: string | null;
};

export type PlacedBlock = {
  id: string;
  barberId: string;
  startMin: number;
  endMin: number;
  topPx: number;
  heightPx: number;
  lane: number;
  laneCount: number;
};

export type UnavailabilityBand = {
  startMin: number;
  endMin: number;
  reason?: string;
  topPx: number;
  heightPx: number;
};

export function parseTimeToMinutes(value: string): number {
  const clock = value.includes("T") ? (value.split("T")[1] ?? "") : value;
  const [h, m] = clock.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

export function formatMinutes(mins: number): string {
  if (!Number.isFinite(mins)) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Janela contínua do primeiro slot até 30 min depois do último. */
export function rangeFromSlots(slots: string[]): TimelineRange | null {
  if (slots.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const slot of slots) {
    const mins = parseTimeToMinutes(slot);
    if (!Number.isFinite(mins)) continue;
    if (mins < start) start = mins;
    if (mins + SLOT_MINUTES > end) end = mins + SLOT_MINUTES;
  }
  if (!Number.isFinite(start) || end <= start) return null;
  return { startMin: start, endMin: end };
}

export function appointmentSpan(apt: {
  status: string;
  scheduledTime: string;
  durationMinutes: number | null;
  completedTime?: string | null;
}): { startMin: number; endMin: number } | null {
  const startMin = parseTimeToMinutes(apt.scheduledTime);
  if (!Number.isFinite(startMin)) return null;
  let endMin: number;
  if (apt.status === "completed" && apt.completedTime) {
    endMin = parseTimeToMinutes(apt.completedTime);
  } else {
    const duration = apt.durationMinutes ?? SLOT_MINUTES;
    endMin = startMin + (duration > 0 ? duration : SLOT_MINUTES);
  }
  if (!Number.isFinite(endMin) || endMin <= startMin) {
    endMin = startMin + SLOT_MINUTES;
  }
  return { startMin, endMin };
}

function overlaps(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

function assignLanes<T extends { id: string; startMin: number; endMin: number }>(
  items: T[],
): Array<T & { lane: number; laneCount: number }> {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id),
  );
  const laneEnds: number[] = [];
  const assigned: Array<T & { lane: number }> = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    assigned.push({ ...item, lane });
  }

  const parent = assigned.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < assigned.length; i++) {
    for (let j = i + 1; j < assigned.length; j++) {
      if (overlaps(assigned[i], assigned[j])) union(i, j);
    }
  }

  const laneCountByRoot = new Map<number, number>();
  assigned.forEach((item, i) => {
    const root = find(i);
    laneCountByRoot.set(root, Math.max(laneCountByRoot.get(root) ?? 0, item.lane + 1));
  });

  return assigned.map((item, i) => ({
    ...item,
    laneCount: laneCountByRoot.get(find(i)) ?? 1,
  }));
}

export function placeBlocks(opts: {
  appointments: AppointmentSpanInput[];
  range: TimelineRange;
  pxPerMinute: number;
  minHeightPx?: number;
}): PlacedBlock[] {
  const minHeight = opts.minHeightPx ?? MIN_BLOCK_PX;
  const byBarber = new Map<
    string,
    Array<{ id: string; barberId: string; startMin: number; endMin: number }>
  >();

  for (const apt of opts.appointments) {
    if (apt.status === "cancelled" || apt.status === "no_show") continue;
    const span = appointmentSpan(apt);
    if (!span) continue;
    if (span.endMin <= opts.range.startMin || span.startMin >= opts.range.endMin) continue;
    const list = byBarber.get(apt.barberId) ?? [];
    list.push({ id: apt.id, barberId: apt.barberId, ...span });
    byBarber.set(apt.barberId, list);
  }

  const placed: PlacedBlock[] = [];
  for (const list of byBarber.values()) {
    for (const item of assignLanes(list)) {
      const visibleStart = Math.max(item.startMin, opts.range.startMin);
      const visibleEnd = Math.min(item.endMin, opts.range.endMin);
      const topPx = (visibleStart - opts.range.startMin) * opts.pxPerMinute;
      const rawHeight = (visibleEnd - visibleStart) * opts.pxPerMinute;
      placed.push({
        ...item,
        topPx,
        heightPx: Math.max(rawHeight, minHeight),
      });
    }
  }
  return placed;
}

export function placeUnavailability(opts: {
  intervals: Array<{ start: string; end: string; reason?: string }>;
  range: TimelineRange;
  pxPerMinute: number;
}): UnavailabilityBand[] {
  const bands: UnavailabilityBand[] = [];
  for (const interval of opts.intervals) {
    const start = parseTimeToMinutes(interval.start);
    const end = parseTimeToMinutes(interval.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const startMin = Math.max(start, opts.range.startMin);
    const endMin = Math.min(end, opts.range.endMin);
    if (endMin <= startMin) continue;
    const reason = interval.reason?.trim();
    bands.push({
      startMin,
      endMin,
      reason: reason || undefined,
      topPx: (startMin - opts.range.startMin) * opts.pxPerMinute,
      heightPx: (endMin - startMin) * opts.pxPerMinute,
    });
  }
  return bands;
}

/** Encaixa o clique em um slot de 30 min que exista na lista (indisponibilidade fica de fora). */
export function snapClickToSlot(opts: {
  offsetY: number;
  range: TimelineRange;
  pxPerMinute: number;
  slots: string[];
}): string | null {
  if (opts.pxPerMinute <= 0 || opts.slots.length === 0) return null;
  const raw = opts.range.startMin + opts.offsetY / opts.pxPerMinute;
  if (raw < opts.range.startMin || raw >= opts.range.endMin) return null;
  const snapped = Math.floor(raw / SLOT_MINUTES) * SLOT_MINUTES;
  if (snapped < opts.range.startMin || snapped >= opts.range.endMin) return null;
  const label = formatMinutes(snapped);
  const open = new Set(
    opts.slots
      .map((slot) => formatMinutes(parseTimeToMinutes(slot)))
      .filter((slot) => slot.length > 0),
  );
  return open.has(label) ? label : null;
}

export function nowOffsetPx(
  now: Date,
  range: TimelineRange,
  pxPerMinute: number,
): number | null {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < range.startMin || mins > range.endMin) return null;
  return (mins - range.startMin) * pxPerMinute;
}
