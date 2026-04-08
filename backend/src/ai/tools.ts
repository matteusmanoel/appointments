import { createHash } from "node:crypto";
import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendPixRequest } from "../integrations/uazapi/client.js";
import { validateUuidIds, isValidUuid } from "../lib/uuid.js";
import {
  canonicalizeBrPhoneDigits,
  brPhoneMatchKeys,
} from "../lib/phone-match.js";
import {
  barbershopHasAutomation,
  cancelReminderForAppointment,
  scheduleReminder2hForAppointment,
  scheduleReminderForAppointment,
} from "../outbound/scheduled-messages.js";

const MAX_TEXT_LENGTH = 8 * 1024;

export type BookingErrorCode =
  | "SLOT_CONFLICT"
  | "BUFFER_CONFLICT"
  | "PAST_TIME"
  | "OUT_OF_HOURS";

export function isStructuredBookingError(
  value: unknown,
): value is { code: BookingErrorCode; message: string; details?: unknown } {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).code === "string" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

/** Returns booking buffer minutes (0–30) for the barbershop. */
async function getBookingBufferMinutes(barbershopId: string): Promise<number> {
  const r = await pool.query<{ booking_buffer_minutes: number | null }>(
    `SELECT COALESCE(booking_buffer_minutes, 0)::int AS booking_buffer_minutes
     FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
    [barbershopId],
  );
  const v = r.rows[0]?.booking_buffer_minutes ?? 0;
  return Math.min(30, Math.max(0, Number(v) || 0));
}

function truncateForLlm(obj: unknown): unknown {
  if (typeof obj === "string") return obj.slice(0, MAX_TEXT_LENGTH);
  if (Array.isArray(obj)) return obj.map(truncateForLlm);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = truncateForLlm(v);
    return out;
  }
  return obj;
}

/** Normaliza nome do cliente para persistência (title case por palavra / parte após hífen). */
export function formatStoredClientName(
  name: string | undefined | null,
): string | undefined {
  if (name == null || typeof name !== "string") return undefined;
  const t = name.trim();
  if (!t) return undefined;
  return t
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      return word
        .split("-")
        .map((part) => {
          if (!part) return part;
          const lower = part.toLowerCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join("-");
    })
    .join(" ");
}

export async function listServices(barbershopId: string): Promise<unknown> {
  const r = await pool.query(
    `SELECT id, name, description, price, duration_minutes, category
     FROM public.services WHERE barbershop_id = $1 AND is_active = true ORDER BY name`,
    [barbershopId],
  );
  return truncateForLlm(r.rows);
}

export async function listBarbers(barbershopId: string): Promise<unknown> {
  const r = await pool.query(
    `SELECT id, name, status, schedule
     FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active', 'break') ORDER BY name`,
    [barbershopId],
  );
  return truncateForLlm(r.rows);
}

export async function listAppointments(
  barbershopId: string,
  date: string,
  barberId?: string,
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date must be yyyy-MM-dd" };
  }
  if (
    barberId != null &&
    String(barberId).trim() !== "" &&
    !isValidUuid(String(barberId).trim())
  ) {
    return {
      error: "barber_id deve ser o UUID retornado por list_barbers, não o nome do barbeiro.",
    };
  }
  let query = `
    SELECT barber_id, scheduled_time, duration_minutes
    FROM public.appointments
    WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled')
    ORDER BY barber_id, scheduled_time
  `;
  const params: unknown[] = [barbershopId, date];
  if (barberId) {
    params.push(barberId);
    query = `
    SELECT barber_id, scheduled_time, duration_minutes
    FROM public.appointments
    WHERE barbershop_id = $1 AND scheduled_date = $2::date AND barber_id = $3 AND status NOT IN ('cancelled')
    ORDER BY scheduled_time
    `;
  }
  const r = await pool.query(query, params);
  return truncateForLlm(r.rows);
}

function timeToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** True if intervals conflict when a minimum gap of bufferMins is required between them. */
function overlapsWithBuffer(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  bufferMins: number,
): boolean {
  if (bufferMins <= 0) return overlaps(aStart, aEnd, bStart, bEnd);
  return aEnd + bufferMins > bStart && bEnd + bufferMins > aStart;
}

/** Returns today (YYYY-MM-DD) and current minutes since midnight in the barbershop timezone. */
async function getNowInBarbershopTz(
  barbershopId: string,
): Promise<{ todayStr: string; nowMins: number }> {
  const r = await pool.query<{ today_str: string; now_mins: number }>(
    `SELECT
       (NOW() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::date::text AS today_str,
       (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::time) / 60)::int AS now_mins
     FROM (SELECT $1::uuid AS barbershop_id) x
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = x.barbershop_id`,
    [barbershopId],
  );
  const row = r.rows[0];
  const todayStr = row?.today_str ?? new Date().toISOString().slice(0, 10);
  const nowMins = Number(row?.now_mins) ?? 0;
  return { todayStr, nowMins: Number.isFinite(nowMins) ? nowMins : 0 };
}

export async function checkAvailability(
  barbershopId: string,
  params: {
    date: string;
    time: string;
    barber_id?: string;
    service_id?: string;
    service_ids?: string[];
    after_time?: string;
  },
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date))
    return { error: "date must be yyyy-MM-dd" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  if (!/^\d{2}:\d{2}$/.test(timeNorm)) return { error: "time must be HH:mm" };
  if (
    params.barber_id != null &&
    String(params.barber_id).trim() !== "" &&
    !isValidUuid(String(params.barber_id).trim())
  ) {
    return {
      error:
        "barber_id deve ser o UUID retornado por list_barbers, não o nome do barbeiro.",
    };
  }

  const serviceIds: string[] = (
    params.service_ids?.length
      ? params.service_ids
      : params.service_id
        ? [params.service_id]
        : []
  ) as string[];
  if (serviceIds.length === 0)
    return { error: "service_id or service_ids (min 1) required" };
  const uuidErr = validateUuidIds(serviceIds, "service_id");
  if (uuidErr) return { error: uuidErr };

  const afterMins = params.after_time
    ? timeToMinutes(
        params.after_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2"),
      )
    : null;
  if (params.after_time != null && afterMins == null)
    return { error: "after_time must be HH:mm" };

  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId],
  );
  if (serviceRows.rows.length !== serviceIds.length)
    return { error: "Service(s) not found" };
  const services = serviceRows.rows.map((r) => ({
    service_id: String(r.id),
    name: String(r.name ?? ""),
    price: Number(r.price ?? 0),
    duration_minutes: Number(r.duration_minutes ?? 0),
  }));
  const totalDuration = services.reduce(
    (sum, r) => sum + Number(r.duration_minutes ?? 0),
    0,
  );
  const totalPrice = services.reduce((sum, r) => sum + Number(r.price ?? 0), 0);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0)
    return { error: "Invalid service duration" };
  if (!Number.isFinite(totalPrice) || totalPrice < 0)
    return { error: "Invalid service price" };

  const requestedStart = timeToMinutes(timeNorm);
  if (requestedStart == null) return { error: "Invalid time" };
  const requestedEnd = requestedStart + totalDuration;

  const bufferMins = await getBookingBufferMinutes(barbershopId);
  const { todayStr, nowMins } = await getNowInBarbershopTz(barbershopId);
  const MIN_TRAVEL_BUFFER_MINS = 15;
  const effectiveAfterMins =
    params.date === todayStr
      ? Math.max(afterMins ?? 0, nowMins + MIN_TRAVEL_BUFFER_MINS)
      : (afterMins ?? null);
  if (effectiveAfterMins != null && requestedStart < effectiveAfterMins) {
    return truncateForLlm({
      date: params.date,
      time: timeNorm,
      duration_minutes: totalDuration,
      total_price: services.reduce((s, r) => s + Number(r.price ?? 0), 0),
      services,
      requested: { available: false, barbers: [] },
      why_unavailable:
        "Horário no passado ou antes do mínimo para hoje. Use get_next_slots para obter os próximos horários.",
      alternatives: [],
    });
  }

  const barbers = await pool.query<{
    id: string;
    name: string;
    schedule: unknown;
  }>(
    `SELECT id, name, schedule
     FROM public.barbers
     WHERE barbershop_id = $1 AND status IN ('active','break')
     ${params.barber_id ? "AND id = $2" : ""}
     ORDER BY name`,
    params.barber_id ? [barbershopId, params.barber_id] : [barbershopId],
  );
  if (barbers.rows.length === 0) return { error: "No barbers available" };

  const dowRow = await pool.query<{ dow: number }>(
    "select extract(dow from $1::date)::int as dow",
    [params.date],
  );
  const dow = dowRow.rows[0]?.dow ?? 0; // 0=Sunday ... 6=Saturday
  const dayKey =
    (
      [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ] as const
    )[dow] ?? "monday";

  // Shop-level business hours + closures (single source of open/closed for slot calculation).
  const [shopRow, closureRow] = await Promise.all([
    pool.query<{ business_hours: unknown }>(
      "SELECT business_hours FROM public.barbershops WHERE id = $1",
      [barbershopId],
    ),
    pool.query<{
      status: string;
      start_time: string | null;
      end_time: string | null;
      unavailability_intervals: unknown;
    }>(
      "SELECT status, start_time::text as start_time, end_time::text as end_time, unavailability_intervals FROM public.barbershop_closures WHERE barbershop_id = $1 AND closure_date = $2::date",
      [barbershopId, params.date],
    ),
  ]);
  const closure = closureRow.rows[0];
  if (closure?.status === "closed") {
    return truncateForLlm({
      date: params.date,
      time: timeNorm,
      duration_minutes: totalDuration,
      total_price: totalPrice,
      services,
      requested: { available: false, barbers: [] },
      why_unavailable: "Barbearia fechada nesta data.",
      alternatives: [],
    });
  }
  const bh = (shopRow.rows[0]?.business_hours ?? {}) as Record<
    string,
    {
      start?: string;
      end?: string;
      unavailability_intervals?: { start: string; end: string }[];
    } | null
  >;
  const bhDay = bh[dayKey];
  let shopStartM: number | null = null;
  let shopEndM: number | null = null;
  let unavailabilityIntervals: { start: string; end: string }[] = [];
  if (
    closure?.status === "open_partial" &&
    closure.start_time &&
    closure.end_time
  ) {
    shopStartM = timeToMinutes(closure.start_time.slice(0, 5));
    shopEndM = timeToMinutes(closure.end_time.slice(0, 5));
    const raw = closure.unavailability_intervals;
    if (Array.isArray(raw))
      unavailabilityIntervals = raw
        .filter(
          (x: unknown) =>
            x && typeof x === "object" && "start" in x && "end" in x,
        )
        .map((x: unknown) => ({
          start: String((x as { start: string }).start).slice(0, 5),
          end: String((x as { end: string }).end).slice(0, 5),
        }));
  } else if (bhDay && typeof bhDay === "object") {
    shopStartM = timeToMinutes(String(bhDay.start ?? ""));
    shopEndM = timeToMinutes(String(bhDay.end ?? ""));
    const raw = bhDay.unavailability_intervals;
    if (Array.isArray(raw))
      unavailabilityIntervals = raw
        .filter(
          (x: unknown) =>
            x && typeof x === "object" && "start" in x && "end" in x,
        )
        .map((x: unknown) => ({
          start: String((x as { start: string }).start).slice(0, 5),
          end: String((x as { end: string }).end).slice(0, 5),
        }));
  }
  if (shopStartM == null || shopEndM == null) {
    return truncateForLlm({
      date: params.date,
      time: timeNorm,
      duration_minutes: totalDuration,
      total_price: totalPrice,
      services,
      requested: { available: false, barbers: [] },
      why_unavailable: "Barbearia não abre neste dia.",
      alternatives: [],
    });
  }
  const inUnavailability = unavailabilityIntervals.some((i) => {
    const iStart = timeToMinutes(i.start);
    const iEnd = timeToMinutes(i.end);
    return (
      iStart != null &&
      iEnd != null &&
      overlaps(requestedStart, requestedEnd, iStart, iEnd)
    );
  });
  if (inUnavailability) {
    return truncateForLlm({
      date: params.date,
      time: timeNorm,
      duration_minutes: totalDuration,
      total_price: totalPrice,
      services,
      requested: { available: false, barbers: [] },
      why_unavailable:
        "Horário dentro de um intervalo de indisponibilidade (ex.: almoço).",
      alternatives: [],
    });
  }

  const candidates: {
    barber_id: string;
    barber_name: string;
    start: number;
    end: number;
  }[] = [];
  for (const b of barbers.rows) {
    const sched = (b.schedule ?? {}) as Record<string, any>;
    const day = sched?.[dayKey];
    let startM = shopStartM;
    let endM = shopEndM;
    if (day && typeof day === "object") {
      const bStart = timeToMinutes(String(day.start ?? ""));
      const bEnd = timeToMinutes(String(day.end ?? ""));
      if (bStart != null) startM = Math.max(startM, bStart);
      if (bEnd != null) endM = Math.min(endM, bEnd);
    }
    if (requestedStart < startM) continue;
    if (requestedEnd > endM) continue;
    candidates.push({
      barber_id: b.id,
      barber_name: b.name,
      start: startM,
      end: endM,
    });
  }

  const appts = await pool.query<{
    barber_id: string;
    scheduled_time: string;
    duration_minutes: number;
    status: string;
    completed_time: string | null;
  }>(
    `SELECT barber_id, scheduled_time::text as scheduled_time, duration_minutes, status, completed_time::text as completed_time
     FROM public.appointments
     WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled', 'no_show')
     ${params.barber_id ? "AND barber_id = $3" : ""}`,
    params.barber_id
      ? [barbershopId, params.date, params.barber_id]
      : [barbershopId, params.date],
  );
  const byBarber = new Map<string, { start: number; end: number }[]>();
  for (const a of appts.rows) {
    const t = String(a.scheduled_time ?? "").slice(0, 5);
    const s = timeToMinutes(t);
    if (s == null) continue;
    const d = Number(a.duration_minutes ?? 0);
    const effectiveEndMins =
      a.status === "completed" && a.completed_time != null
        ? (timeToMinutes(String(a.completed_time).slice(0, 5)) ?? s + d)
        : s + (Number.isFinite(d) && d > 0 ? d : 0);
    const e =
      effectiveEndMins > s
        ? effectiveEndMins
        : s + (Number.isFinite(d) && d > 0 ? d : 0);
    const list = byBarber.get(a.barber_id) ?? [];
    list.push({ start: s, end: e });
    byBarber.set(a.barber_id, list);
  }

  const availableBarbers: { barber_id: string; barber_name: string }[] = [];
  const debugBarbers: {
    barber_id: string;
    barber_name: string;
    in_schedule: boolean;
    conflict: boolean;
  }[] = [];
  for (const c of candidates) {
    const occ = byBarber.get(c.barber_id) ?? [];
    const conflict = occ.some((o) =>
      overlapsWithBuffer(
        requestedStart,
        requestedEnd,
        o.start,
        o.end,
        bufferMins,
      ),
    );
    if (!conflict)
      availableBarbers.push({
        barber_id: c.barber_id,
        barber_name: c.barber_name,
      });
    debugBarbers.push({
      barber_id: c.barber_id,
      barber_name: c.barber_name,
      in_schedule: true,
      conflict,
    });
  }

  const available = availableBarbers.length > 0;

  // Alternatives: closest free slots on a 30-min grid around the requested time.
  // Using 30-min intervals avoids impractical suggestions like 18h05 / 18h10.
  const alternatives: {
    time: string;
    barber_id: string;
    barber_name: string;
  }[] = [];
  if (!available) {
    const baseSlot = Math.round(requestedStart / 30) * 30;
    const deltas: number[] = [];
    for (let step = 1; step <= 12; step++) {
      deltas.push(step * 30, -step * 30);
    }
    const minStartMins = effectiveAfterMins ?? afterMins;
    outer: for (const delta of deltas) {
      const slotStart = baseSlot + delta;
      if (minStartMins != null && slotStart < minStartMins) continue;
      const slotEnd = slotStart + totalDuration;
      for (const b of barbers.rows) {
        const sched = (b.schedule ?? {}) as Record<string, any>;
        const day = sched?.[dayKey];
        let startM = shopStartM;
        let endM = shopEndM;
        if (day && typeof day === "object") {
          const bStart = timeToMinutes(String(day.start ?? ""));
          const bEnd = timeToMinutes(String(day.end ?? ""));
          if (bStart != null) startM = Math.max(startM, bStart);
          if (bEnd != null) endM = Math.min(endM, bEnd);
        }
        if (slotStart < startM || slotEnd > endM) continue;
        const occ = byBarber.get(b.id) ?? [];
        const conflict = occ.some((o) =>
          overlapsWithBuffer(slotStart, slotEnd, o.start, o.end, bufferMins),
        );
        if (!conflict) {
          alternatives.push({
            time: minutesToTime(slotStart),
            barber_id: b.id,
            barber_name: b.name,
          });
          if (alternatives.length >= 3) break outer;
        }
      }
    }
  }

  return truncateForLlm({
    date: params.date,
    time: timeNorm,
    duration_minutes: totalDuration,
    total_price: totalPrice,
    services,
    requested: { available, barbers: availableBarbers },
    why_unavailable: available
      ? null
      : "Não encaixou no expediente ou conflitou com outros horários do barbeiro (sem expor dados).",
    alternatives,
    debug: { evaluated_barbers: debugBarbers },
  });
}

/**
 * Validates that a slot (date, time, duration, barber) is within business hours, not in closures, fits barber schedule, and is not in the past.
 * Used by public reschedule. excludeAppointmentId is excluded from conflict check.
 */
export async function validateSlotForPublicReschedule(
  barbershopId: string,
  params: {
    date: string;
    time: string;
    duration_minutes: number;
    barber_id: string;
    excludeAppointmentId?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date))
    return { ok: false, error: "Data inválida" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  if (!/^\d{2}:\d{2}$/.test(timeNorm))
    return { ok: false, error: "Horário inválido" };
  const startMins = timeToMinutes(timeNorm);
  if (startMins == null) return { ok: false, error: "Horário inválido" };
  const endMins = startMins + params.duration_minutes;

  const tzRow = await pool.query<{ timezone: string }>(
    `SELECT COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone FROM public.barbershop_ai_settings ais WHERE ais.barbershop_id = $1`,
    [barbershopId],
  );
  const tz = tzRow.rows[0]?.timezone ?? "America/Sao_Paulo";
  const startUtcRow = await pool.query<{ start_utc: Date }>(
    `SELECT (($1::date + $2::time) AT TIME ZONE $3)::timestamptz AS start_utc`,
    [params.date, timeNorm, tz],
  );
  const startUtc = startUtcRow.rows[0]?.start_utc;
  if (!startUtc || startUtc.getTime() <= Date.now()) {
    return { ok: false, error: "Horário não pode ser no passado" };
  }

  const dowRow = await pool.query<{ dow: number }>(
    "SELECT extract(dow from $1::date)::int AS dow",
    [params.date],
  );
  const dow = dowRow.rows[0]?.dow ?? 0;
  const dayKey =
    (
      [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ] as const
    )[dow] ?? "monday";

  const [shopRow, closureRow, barberRow] = await Promise.all([
    pool.query<{ business_hours: unknown }>(
      "SELECT business_hours FROM public.barbershops WHERE id = $1",
      [barbershopId],
    ),
    pool.query<{
      status: string;
      start_time: string | null;
      end_time: string | null;
      unavailability_intervals: unknown;
    }>(
      "SELECT status, start_time::text as start_time, end_time::text as end_time, unavailability_intervals FROM public.barbershop_closures WHERE barbershop_id = $1 AND closure_date = $2::date",
      [barbershopId, params.date],
    ),
    pool.query<{ id: string; schedule: unknown }>(
      "SELECT id, schedule FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
      [params.barber_id, barbershopId],
    ),
  ]);
  if (barberRow.rows.length === 0)
    return { ok: false, error: "Barbeiro não encontrado" };
  const closure = closureRow.rows[0];
  if (closure?.status === "closed")
    return { ok: false, error: "Barbearia fechada nesta data" };

  const bh = (shopRow.rows[0]?.business_hours ?? {}) as Record<
    string,
    {
      start?: string;
      end?: string;
      unavailability_intervals?: { start: string; end: string }[];
    } | null
  >;
  let shopStartM: number | null = null;
  let shopEndM: number | null = null;
  let unavail: { start: number; end: number }[] = [];
  if (
    closure?.status === "open_partial" &&
    closure.start_time &&
    closure.end_time
  ) {
    shopStartM = timeToMinutes(closure.start_time.slice(0, 5));
    shopEndM = timeToMinutes(closure.end_time.slice(0, 5));
    const raw = closure.unavailability_intervals;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (x && typeof x === "object" && "start" in x && "end" in x) {
          const s = timeToMinutes(
            String((x as { start: string }).start).slice(0, 5),
          );
          const e = timeToMinutes(
            String((x as { end: string }).end).slice(0, 5),
          );
          if (s != null && e != null) unavail.push({ start: s, end: e });
        }
      }
    }
  } else {
    const bhDay = bh[dayKey];
    if (bhDay && typeof bhDay === "object") {
      shopStartM = timeToMinutes(String(bhDay.start ?? ""));
      shopEndM = timeToMinutes(String(bhDay.end ?? ""));
      const raw = bhDay.unavailability_intervals;
      if (Array.isArray(raw)) {
        for (const x of raw) {
          if (x && typeof x === "object" && "start" in x && "end" in x) {
            const s = timeToMinutes(
              String((x as { start: string }).start).slice(0, 5),
            );
            const e = timeToMinutes(
              String((x as { end: string }).end).slice(0, 5),
            );
            if (s != null && e != null) unavail.push({ start: s, end: e });
          }
        }
      }
    }
  }
  if (shopStartM == null || shopEndM == null)
    return { ok: false, error: "Barbearia não abre neste dia" };
  if (startMins < shopStartM || endMins > shopEndM)
    return { ok: false, error: "Horário fora do expediente" };
  if (unavail.some((u) => overlaps(startMins, endMins, u.start, u.end)))
    return {
      ok: false,
      error: "Horário dentro de intervalo de indisponibilidade",
    };

  const sched = (barberRow.rows[0].schedule ?? {}) as Record<
    string,
    { start?: string; end?: string } | null
  >;
  const barberDay = sched[dayKey];
  if (barberDay && typeof barberDay === "object") {
    const bStart = timeToMinutes(String(barberDay.start ?? ""));
    const bEnd = timeToMinutes(String(barberDay.end ?? ""));
    if (bStart != null && startMins < bStart)
      return { ok: false, error: "Horário fora do expediente do barbeiro" };
    if (bEnd != null && endMins > bEnd)
      return { ok: false, error: "Horário fora do expediente do barbeiro" };
  }

  const conflictParams = params.excludeAppointmentId
    ? [
        barbershopId,
        params.barber_id,
        params.date,
        startMins,
        endMins,
        params.excludeAppointmentId,
      ]
    : [barbershopId, params.barber_id, params.date, startMins, endMins];
  const conflictQuery = params.excludeAppointmentId
    ? `SELECT 1 FROM public.appointments a
       WHERE a.barbershop_id = $1 AND a.barber_id = $2 AND a.scheduled_date = $3::date AND a.status NOT IN ('cancelled', 'no_show') AND a.id != $6
       AND (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int < $5::int
       AND (CASE WHEN a.status = 'completed' AND a.completed_time IS NOT NULL THEN (EXTRACT(EPOCH FROM a.completed_time) / 60)::int ELSE (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int + a.duration_minutes::int END) > $4::int`
    : `SELECT 1 FROM public.appointments a
       WHERE a.barbershop_id = $1 AND a.barber_id = $2 AND a.scheduled_date = $3::date AND a.status NOT IN ('cancelled', 'no_show')
       AND (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int < $5::int
       AND (CASE WHEN a.status = 'completed' AND a.completed_time IS NOT NULL THEN (EXTRACT(EPOCH FROM a.completed_time) / 60)::int ELSE (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int + a.duration_minutes::int END) > $4::int`;
  const conflictCheck = await pool.query(conflictQuery, conflictParams);
  if (conflictCheck.rows.length > 0)
    return { ok: false, error: "Horário já ocupado para este barbeiro" };

  return { ok: true };
}

/** Returns the next available time slots for a date, respecting business_hours, closures, and appointments. Use after_time when date is today. */
export async function getNextSlots(
  barbershopId: string,
  params: {
    date: string;
    service_id?: string;
    service_ids?: string[];
    after_time?: string;
    barber_id?: string;
    limit?: number;
  },
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date))
    return { error: "date must be yyyy-MM-dd" };
  const serviceIds: string[] = (
    params.service_ids?.length
      ? params.service_ids
      : params.service_id
        ? [params.service_id]
        : []
  ) as string[];
  if (serviceIds.length === 0)
    return { error: "service_id or service_ids (min 1) required" };
  const uuidErrGetSlots = validateUuidIds(serviceIds, "service_id");
  if (uuidErrGetSlots) return { error: uuidErrGetSlots };

  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 20);
  const afterMins = params.after_time
    ? timeToMinutes(
        params.after_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2"),
      )
    : null;
  if (params.after_time != null && afterMins == null)
    return { error: "after_time must be HH:mm" };
  if (
    params.barber_id != null &&
    String(params.barber_id).trim() !== "" &&
    !isValidUuid(String(params.barber_id).trim())
  ) {
    return {
      error:
        "barber_id deve ser o UUID retornado por list_barbers, não o nome do barbeiro.",
    };
  }

  const bufferMins = await getBookingBufferMinutes(barbershopId);
  const { todayStr, nowMins } = await getNowInBarbershopTz(barbershopId);

  const [shopRow, closureRow, serviceRows, barbersRows, apptsRows] =
    await Promise.all([
      pool.query<{ business_hours: unknown }>(
        "SELECT business_hours FROM public.barbershops WHERE id = $1",
        [barbershopId],
      ),
      pool.query<{
        status: string;
        start_time: string | null;
        end_time: string | null;
        unavailability_intervals: unknown;
      }>(
        "SELECT status, start_time::text as start_time, end_time::text as end_time, unavailability_intervals FROM public.barbershop_closures WHERE barbershop_id = $1 AND closure_date = $2::date",
        [barbershopId, params.date],
      ),
      pool.query(
        "SELECT id, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
        [serviceIds, barbershopId],
      ),
      pool.query<{ id: string; name: string; schedule: unknown }>(
        `SELECT id, name, schedule FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active','break') ${params.barber_id ? "AND id = $2" : ""} ORDER BY name`,
        params.barber_id ? [barbershopId, params.barber_id] : [barbershopId],
      ),
      pool.query<{
        barber_id: string;
        scheduled_time: string;
        duration_minutes: number;
        status: string;
        completed_time: string | null;
      }>(
        `SELECT barber_id, scheduled_time::text as scheduled_time, duration_minutes, status, completed_time::text as completed_time FROM public.appointments
       WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled', 'no_show') ${params.barber_id ? "AND barber_id = $3" : ""}`,
        params.barber_id
          ? [barbershopId, params.date, params.barber_id]
          : [barbershopId, params.date],
      ),
    ]);

  if (shopRow.rows.length === 0) return { error: "Barbershop not found" };
  if (serviceRows.rows.length !== serviceIds.length)
    return { error: "Service(s) not found" };
  const totalDuration = serviceRows.rows.reduce(
    (s, r) => s + Number(r.duration_minutes ?? 0),
    0,
  );
  if (!Number.isFinite(totalDuration) || totalDuration <= 0)
    return { error: "Invalid service duration" };

  const barbers = barbersRows.rows;
  if (barbers.length === 0)
    return { slots: [], message: "Nenhum barbeiro disponível." };

  const dowRow = await pool.query<{ dow: number }>(
    "SELECT extract(dow from $1::date)::int AS dow",
    [params.date],
  );
  const dow = dowRow.rows[0]?.dow ?? 0;
  const dayKey =
    (
      [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ] as const
    )[dow] ?? "monday";

  let startM: number;
  let endM: number;
  let unavailIntervals: { start: number; end: number }[] = [];
  const closure = closureRow.rows[0];
  if (closure?.status === "closed") {
    return truncateForLlm({
      date: params.date,
      slots: [],
      message: "Barbearia fechada nesta data.",
    });
  }
  if (
    closure?.status === "open_partial" &&
    closure.start_time != null &&
    closure.end_time != null
  ) {
    const s = timeToMinutes(closure.start_time.slice(0, 5));
    const e = timeToMinutes(closure.end_time.slice(0, 5));
    if (s == null || e == null) return { error: "Invalid closure times" };
    startM = s;
    endM = e;
    const raw = (closure as { unavailability_intervals?: unknown })
      .unavailability_intervals;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (x && typeof x === "object" && "start" in x && "end" in x) {
          const is_ = timeToMinutes(
            String((x as { start: string }).start).slice(0, 5),
          );
          const ie = timeToMinutes(
            String((x as { end: string }).end).slice(0, 5),
          );
          if (is_ != null && ie != null)
            unavailIntervals.push({ start: is_, end: ie });
        }
      }
    }
  } else {
    const bh = (shopRow.rows[0].business_hours ?? {}) as Record<
      string,
      {
        start?: string;
        end?: string;
        unavailability_intervals?: { start: string; end: string }[];
      } | null
    >;
    const day = bh[dayKey];
    if (!day || typeof day !== "object") {
      return truncateForLlm({
        date: params.date,
        slots: [],
        message: "Barbearia não abre neste dia.",
      });
    }
    const s = timeToMinutes(String(day.start ?? "09:00"));
    const e = timeToMinutes(String(day.end ?? "19:00"));
    if (s == null || e == null) return { error: "Invalid business_hours" };
    startM = s;
    endM = e;
    const raw = day.unavailability_intervals;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (x && typeof x === "object" && "start" in x && "end" in x) {
          const is_ = timeToMinutes(
            String((x as { start: string }).start).slice(0, 5),
          );
          const ie = timeToMinutes(
            String((x as { end: string }).end).slice(0, 5),
          );
          if (is_ != null && ie != null)
            unavailIntervals.push({ start: is_, end: ie });
        }
      }
    }
  }

  const MIN_TRAVEL_BUFFER_MINS = 15;
  if (params.date === todayStr) {
    startM = Math.max(startM, nowMins + MIN_TRAVEL_BUFFER_MINS);
  }
  if (afterMins != null) {
    startM = Math.max(startM, afterMins);
  }
  // Snap to next 30-minute boundary for clean slot presentation
  startM = Math.ceil(startM / 30) * 30;
  const slotEndMax = endM - totalDuration;
  if (startM >= slotEndMax) {
    return truncateForLlm({
      date: params.date,
      slots: [],
      message:
        "Não há mais horários disponíveis a partir do horário informado.",
    });
  }

  const byBarber = new Map<string, { start: number; end: number }[]>();
  for (const a of apptsRows.rows) {
    const t = String(a.scheduled_time ?? "").slice(0, 5);
    const s = timeToMinutes(t);
    if (s == null) continue;
    const d = Number(a.duration_minutes ?? 0);
    const effectiveEndMins =
      a.status === "completed" && a.completed_time != null
        ? (timeToMinutes(String(a.completed_time).slice(0, 5)) ?? s + d)
        : s + (Number.isFinite(d) && d > 0 ? d : 0);
    const e =
      effectiveEndMins > s
        ? effectiveEndMins
        : s + (Number.isFinite(d) && d > 0 ? d : 0);
    const list = byBarber.get(a.barber_id) ?? [];
    list.push({ start: s, end: e });
    byBarber.set(a.barber_id, list);
  }

  const slots: { time: string; barber_id: string; barber_name: string }[] = [];
  const STEP = 30;
  for (
    let slotStart = startM;
    slotStart < slotEndMax && slots.length < limit;
    slotStart += STEP
  ) {
    const slotEnd = slotStart + totalDuration;
    if (
      unavailIntervals.some((u) => overlaps(slotStart, slotEnd, u.start, u.end))
    )
      continue;
    for (const b of barbers) {
      const sched = (b.schedule ?? {}) as Record<
        string,
        { start?: string; end?: string }
      >;
      const day = sched[dayKey];
      let barberStart = startM;
      let barberEnd = endM;
      if (day && typeof day === "object") {
        const s = timeToMinutes(String(day.start ?? ""));
        const e = timeToMinutes(String(day.end ?? ""));
        if (s != null) barberStart = Math.max(barberStart, s);
        if (e != null) barberEnd = Math.min(barberEnd, e);
      }
      if (slotStart < barberStart || slotEnd > barberEnd) continue;
      const occ = byBarber.get(b.id) ?? [];
      if (
        occ.some((o) =>
          overlapsWithBuffer(slotStart, slotEnd, o.start, o.end, bufferMins),
        )
      )
        continue;
      slots.push({
        time: minutesToTime(slotStart),
        barber_id: b.id,
        barber_name: b.name,
      });
      break;
    }
  }

  return truncateForLlm({
    date: params.date,
    slots,
    duration_minutes: totalDuration,
  });
}

export async function upsertClient(
  barbershopId: string,
  phone: string,
  name?: string,
  notes?: string,
): Promise<unknown> {
  const digits = phone.replace(/\D/g, "") || phone;
  if (!digits) return { error: "phone required" };
  const canonicalPhone = canonicalizeBrPhoneDigits(digits) ?? digits;
  const matchKeys = brPhoneMatchKeys(canonicalPhone);
  const resolvedNameInput = (): string | null => {
    if (name === undefined) return null;
    const t = String(name).trim();
    if (!t) return null;
    return formatStoredClientName(t) ?? t;
  };
  const nameForUpdate = resolvedNameInput();
  const existing = await pool.query<{
    id: string;
    name: string | null;
    phone: string;
  }>(
    `SELECT id, name, phone FROM public.clients
     WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])
     LIMIT 1`,
    [barbershopId, matchKeys],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    await pool.query(
      `UPDATE public.clients SET
         name = COALESCE($2, name),
         notes = COALESCE($3, notes),
         updated_at = now()
       WHERE id = $1`,
      [row.id, nameForUpdate, notes ?? null],
    );
    const updated = await pool.query<{
      id: string;
      name: string | null;
      phone: string;
      barbershop_id: string;
    }>(
      `SELECT id, name, phone, barbershop_id FROM public.clients WHERE id = $1`,
      [row.id],
    );
    return truncateForLlm(updated.rows[0]);
  }
  const insertName =
    name !== undefined && String(name).trim()
      ? (formatStoredClientName(String(name).trim()) ?? String(name).trim())
      : "Cliente";
  const r = await pool.query(
    `INSERT INTO public.clients (barbershop_id, name, phone, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, clients.name),
       notes = COALESCE(EXCLUDED.notes, clients.notes),
       updated_at = now()
     RETURNING id, name, phone, barbershop_id`,
    [barbershopId, insertName, canonicalPhone, notes ?? null],
  );
  return truncateForLlm(r.rows[0]);
}

export async function createAppointment(
  barbershopId: string,
  params: {
    client_id?: string;
    client_phone?: string;
    client_name?: string;
    barber_id: string;
    service_id?: string;
    service_ids?: string[];
    date: string;
    time: string;
    notes?: string;
  },
): Promise<unknown> {
  const resolveClientId = async (): Promise<string | null> => {
    if (params.client_id && typeof params.client_id === "string")
      return params.client_id;
    const phone = (params.client_phone ?? "").toString();
    if (!phone) return null;
    const r = (await upsertClient(
      barbershopId,
      phone,
      params.client_name,
    )) as unknown;
    if (r && typeof r === "object") {
      const id = (r as Record<string, unknown>).id;
      if (typeof id === "string" && id) return id;
    }
    return null;
  };

  const clientId = await resolveClientId();
  if (!clientId) return { error: "client_phone or client_id required" };

  const serviceIds: string[] = (
    params.service_ids?.length
      ? params.service_ids
      : params.service_id
        ? [params.service_id]
        : []
  ) as string[];
  if (serviceIds.length === 0)
    return { error: "service_id or service_ids (min 1) required" };
  const uuidErrBook = validateUuidIds(serviceIds, "service_id");
  if (uuidErrBook) return { error: uuidErrBook };
  if (!isValidUuid(params.barber_id)) {
    return {
      error:
        "barber_id deve ser o UUID do barbeiro; use list_barbers para obter os IDs (não use nome ou slug).",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date))
    return { error: "date must be yyyy-MM-dd" };
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(params.time))
    return { error: "time must be HH:mm or HH:mm:ss" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");

  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId],
  );
  type ServiceRow = {
    id: string;
    name: string;
    price: unknown;
    duration_minutes: unknown;
  };
  const byId = new Map<string, ServiceRow>(
    serviceRows.rows.map((r: ServiceRow) => [r.id, r]),
  );
  if (byId.size !== serviceIds.length) {
    const missing = serviceIds.filter((id) => !byId.has(id));
    return { error: "Service(s) not found", ids: missing };
  }
  let totalPrice = 0;
  let totalDuration = 0;
  const snapshots: {
    service_id: string;
    name: string;
    price: number;
    duration_minutes: number;
  }[] = [];
  for (const sid of serviceIds) {
    const r = byId.get(sid)!;
    const price = Number(r.price);
    const dur = Number(r.duration_minutes);
    totalPrice += price;
    totalDuration += dur;
    snapshots.push({
      service_id: r.id,
      name: r.name ?? "",
      price,
      duration_minutes: dur,
    });
  }
  const barberRow = await pool.query(
    "SELECT commission_percentage FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
    [params.barber_id, barbershopId],
  );
  if (barberRow.rows.length === 0) {
    return {
      error:
        "Barbeiro não encontrado; use list_barbers para obter os IDs (UUID) válidos desta barbearia.",
    };
  }
  const barberPct = barberRow.rows[0]?.commission_percentage ?? 40;
  const commissionAmount = totalPrice * (barberPct / 100);
  const startMins =
    parseInt(timeNorm.slice(0, 2), 10) * 60 +
    parseInt(timeNorm.slice(3, 5), 10);
  const endMins = startMins + totalDuration;

  const bufferMins = await getBookingBufferMinutes(barbershopId);
  const { todayStr, nowMins } = await getNowInBarbershopTz(barbershopId);
  if (params.date === todayStr && startMins < Math.ceil(nowMins / 5) * 5) {
    return {
      error:
        "Horário no passado. Use get_next_slots ou check_availability para obter horários válidos.",
      code: "PAST_TIME" as const,
      message:
        "Horário no passado. Ofereça 2–3 alternativas com get_next_slots ou check_availability.",
    };
  }

  const conflictCheck = await pool.query(
    `SELECT 1 FROM public.appointments a
     WHERE a.barbershop_id = $1 AND a.barber_id = $2 AND a.scheduled_date = $3::date
       AND a.status NOT IN ('cancelled', 'no_show')
       AND (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int < ($5::int + $6::int)
       AND (
         CASE
           WHEN a.status = 'completed' AND a.completed_time IS NOT NULL
           THEN (EXTRACT(EPOCH FROM a.completed_time) / 60)::int
           ELSE (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int + a.duration_minutes::int
         END
       ) > ($4::int - $6::int)`,
    [
      barbershopId,
      params.barber_id,
      params.date,
      startMins,
      endMins,
      bufferMins,
    ],
  );
  if (conflictCheck.rows.length > 0) {
    return {
      error: "Horário já ocupado ou insuficiente intervalo para este barbeiro.",
      code: "SLOT_CONFLICT" as const,
      message:
        "Horário indisponível. Chame get_next_slots ou check_availability e ofereça 2–3 alternativas.",
    };
  }
  const lockKeyBuf = createHash("md5")
    .update(barbershopId + params.barber_id + params.date)
    .digest();
  // Advisory locks in Postgres take a signed bigint; using unsigned can overflow.
  const lockKey = lockKeyBuf.readBigInt64BE(0);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockRow = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1::bigint)",
      [lockKey.toString()],
    );
    if (!lockRow.rows[0]?.pg_try_advisory_xact_lock) {
      await client.query("ROLLBACK");
      return {
        error: "Conflito ao reservar; tente novamente.",
        code: "SLOT_CONFLICT" as const,
        message:
          "Outro agendamento em andamento. Chame get_next_slots e ofereça alternativas.",
      };
    }
    const recheck = await client.query(
      `SELECT 1 FROM public.appointments a
       WHERE a.barbershop_id = $1 AND a.barber_id = $2 AND a.scheduled_date = $3::date
         AND a.status NOT IN ('cancelled', 'no_show')
         AND (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int < ($5::int + $6::int)
         AND (
           CASE
             WHEN a.status = 'completed' AND a.completed_time IS NOT NULL
             THEN (EXTRACT(EPOCH FROM a.completed_time) / 60)::int
             ELSE (EXTRACT(EPOCH FROM a.scheduled_time) / 60)::int + a.duration_minutes::int
           END
         ) > ($4::int - $6::int)`,
      [
        barbershopId,
        params.barber_id,
        params.date,
        startMins,
        endMins,
        bufferMins,
      ],
    );
    if (recheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return {
        error: "Horário já ocupado para este barbeiro.",
        code: "SLOT_CONFLICT" as const,
        message:
          "Horário indisponível. Chame get_next_slots ou check_availability e ofereça 2–3 alternativas.",
      };
    }
    const appResult = await client.query(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status, notes)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9, 'pending', $10)
       RETURNING id, scheduled_date, scheduled_time, status, public_token`,
      [
        barbershopId,
        clientId,
        params.barber_id,
        serviceIds[0],
        params.date,
        timeNorm,
        totalDuration,
        totalPrice,
        commissionAmount,
        params.notes ?? null,
      ],
    );
    const appointment = appResult.rows[0];
    for (let pos = 0; pos < snapshots.length; pos++) {
      const s = snapshots[pos];
      await client.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          appointment.id,
          s.service_id,
          s.price,
          s.duration_minutes,
          s.name || null,
          pos,
        ],
      );
    }
    await client.query("COMMIT");
    const serviceNamesArr = snapshots.map((s) => s.name);
    barbershopHasAutomation(barbershopId)
      .then((has) => {
        if (!has) return;
        return pool
          .query<{
            client_phone: string;
            client_name: string | null;
            barber_name: string;
            slug: string | null;
            timezone: string;
            public_token: string;
          }>(
            `SELECT c.phone AS client_phone, c.name AS client_name, b.name AS barber_name, bs.slug, COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone, a.public_token
           FROM public.appointments a
           JOIN public.clients c ON c.id = a.client_id
           JOIN public.barbers b ON b.id = a.barber_id
           JOIN public.barbershops bs ON bs.id = a.barbershop_id
           LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = a.barbershop_id
           WHERE a.id = $1 AND a.barbershop_id = $2`,
            [appointment.id, barbershopId],
          )
          .then(async (r) => {
            const row = r.rows[0];
            if (!row?.public_token) return;
            await scheduleReminderForAppointment({
              barbershopId,
              appointmentId: appointment.id,
              publicToken: row.public_token,
              clientPhone: row.client_phone,
              clientName: row.client_name,
              barberName: row.barber_name,
              serviceNames: serviceNamesArr,
              scheduledDate: params.date,
              scheduledTime: timeNorm,
              slug: row.slug,
              timezone: row.timezone,
            });
            await scheduleReminder2hForAppointment({
              barbershopId,
              appointmentId: appointment.id,
              publicToken: row.public_token,
              clientPhone: row.client_phone,
              clientName: row.client_name,
              barberName: row.barber_name,
              serviceNames: serviceNamesArr,
              scheduledDate: params.date,
              scheduledTime: timeNorm,
              slug: row.slug,
              timezone: row.timezone,
            });
          });
      })
      .catch(() => {});
    return truncateForLlm({
      ...appointment,
      services: snapshots.map((s) => ({ name: s.name, price: s.price })),
      total_price: totalPrice,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Returns "o de sempre" for a client: last appointment's services and top 1–2 most frequent combos in last 6 months.
 * Used by agent to suggest proactively on greeting.
 */
export async function getClientFavoriteServices(
  barbershopId: string,
  clientPhone: string,
): Promise<{
  last: { service_ids: string[]; service_names: string } | null;
  frequent: Array<{
    service_ids: string[];
    service_names: string;
    count: number;
  }>;
} | null> {
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits) return null;
  const matchKeys = brPhoneMatchKeys(
    canonicalizeBrPhoneDigits(digits) ?? digits,
  );

  const lastRow = await pool.query<{
    service_ids: string[];
    service_names: string;
  }>(
    `WITH client_appointments AS (
       SELECT a.id
       FROM public.appointments a
       JOIN public.clients c ON c.id = a.client_id
       WHERE a.barbershop_id = $1 AND a.status NOT IN ('cancelled')
         AND a.scheduled_date < CURRENT_DATE
         AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($2::text[])
       ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
       LIMIT 1
     ),
     svcs AS (
       SELECT aps.service_id, aps.service_name
       FROM public.appointment_services aps
       JOIN client_appointments ca ON ca.id = aps.appointment_id
       ORDER BY aps.position
     )
     SELECT
       COALESCE(array_agg(svcs.service_id::text) FILTER (WHERE svcs.service_id IS NOT NULL), ARRAY[]::text[]) AS service_ids,
       COALESCE(string_agg(svcs.service_name, ', ' ORDER BY (SELECT 1)), '') AS service_names
     FROM svcs`,
    [barbershopId, matchKeys],
  );
  const last = lastRow.rows[0];
  const lastResult =
    last && Array.isArray(last.service_ids) && last.service_ids.length > 0
      ? {
          service_ids: last.service_ids,
          service_names: last.service_names ?? "",
        }
      : null;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const frequentRows = await pool.query<{
    service_ids: string[];
    service_names: string;
    cnt: string;
  }>(
    `WITH past AS (
       SELECT a.id
       FROM public.appointments a
       JOIN public.clients c ON c.id = a.client_id
       WHERE a.barbershop_id = $1 AND a.status NOT IN ('cancelled')
         AND a.scheduled_date >= $2::date
         AND a.scheduled_date < CURRENT_DATE
         AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($3::text[])
     ),
     combo AS (
       SELECT
         array_agg(aps.service_id::text ORDER BY aps.position) AS service_ids,
         string_agg(aps.service_name, ', ' ORDER BY aps.position) AS service_names
       FROM public.appointment_services aps
       JOIN past p ON p.id = aps.appointment_id
       GROUP BY aps.appointment_id
     )
     SELECT service_ids, service_names, COUNT(*)::text AS cnt
     FROM combo
     GROUP BY service_ids, service_names
     ORDER BY COUNT(*) DESC
     LIMIT 2`,
    [barbershopId, sixMonthsAgo.toISOString().slice(0, 10), matchKeys],
  );
  const frequent = frequentRows.rows.map((r) => ({
    service_ids: r.service_ids ?? [],
    service_names: r.service_names ?? "",
    count: parseInt(r.cnt, 10) || 0,
  }));

  if (!lastResult && frequent.length === 0) return null;
  return { last: lastResult, frequent };
}

/**
 * List upcoming appointments for the client (by phone). Used by agent for cancel/reschedule intents.
 */
export async function listClientUpcomingAppointments(
  barbershopId: string,
  clientPhone: string,
): Promise<unknown> {
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits) return { error: "client_phone required" };
  const canonical = canonicalizeBrPhoneDigits(digits) ?? digits;
  const matchKeys = brPhoneMatchKeys(canonical);
  const r = await pool.query<{
    id: string;
    scheduled_date: string;
    scheduled_time: string;
    service_names: string;
    barber_name: string;
  }>(
    `SELECT a.id, a.scheduled_date::text, a.scheduled_time::text,
            (SELECT string_agg(aps.service_name, ', ' ORDER BY aps.position) FROM public.appointment_services aps WHERE aps.appointment_id = a.id) AS service_names,
            b.name AS barber_name
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     JOIN public.barbers b ON b.id = a.barber_id
     WHERE a.barbershop_id = $1 AND a.status NOT IN ('cancelled')
       AND a.scheduled_date >= CURRENT_DATE
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($2::text[])
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [barbershopId, matchKeys],
  );
  return truncateForLlm(
    r.rows.map((row) => ({
      id: row.id,
      date: row.scheduled_date,
      time: String(row.scheduled_time).slice(0, 5),
      service_names: row.service_names ?? "",
      barber_name: row.barber_name,
    })),
  );
}

/**
 * Cancel an appointment. Only allowed if the appointment's client phone matches client_phone.
 */
export async function cancelAppointmentByAgent(
  barbershopId: string,
  appointmentId: string,
  clientPhone: string,
): Promise<unknown> {
  if (!isValidUuid(appointmentId))
    return { error: "appointment_id deve ser o UUID retornado por list_client_upcoming_appointments, não um número ou nome." };
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits) return { error: "Telefone do cliente é obrigatório" };
  const matchKeys = brPhoneMatchKeys(
    canonicalizeBrPhoneDigits(digits) ?? digits,
  );
  const check = await pool.query<{ id: string }>(
    `SELECT a.id FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.id = $1 AND a.barbershop_id = $2 AND a.status NOT IN ('cancelled')
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($3::text[])`,
    [appointmentId, barbershopId, matchKeys],
  );
  if (check.rows.length === 0)
    return {
      error:
        "Agendamento não encontrado, já cancelado ou não pertence a este cliente",
    };
  await pool.query(
    `UPDATE public.appointments SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND barbershop_id = $2`,
    [appointmentId, barbershopId],
  );
  await cancelReminderForAppointment(appointmentId);
  return { ok: true, message: "Agendamento cancelado" };
}

/**
 * Reschedule an appointment to a new date/time. Only allowed if the appointment's client phone matches client_phone. Checks conflicts.
 */
export async function rescheduleAppointmentByAgent(
  barbershopId: string,
  appointmentId: string,
  clientPhone: string,
  params: { date: string; time: string; barber_id?: string },
): Promise<unknown> {
  if (!isValidUuid(appointmentId))
    return { error: "appointment_id deve ser o UUID retornado por list_client_upcoming_appointments, não um número ou nome." };
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits) return { error: "Telefone do cliente é obrigatório" };
  const matchKeys = brPhoneMatchKeys(
    canonicalizeBrPhoneDigits(digits) ?? digits,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date))
    return { error: "date must be yyyy-MM-dd" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  if (!/^\d{2}:\d{2}$/.test(timeNorm)) return { error: "time must be HH:mm" };
  if (
    params.barber_id != null &&
    String(params.barber_id).trim() !== "" &&
    !isValidUuid(String(params.barber_id).trim())
  ) {
    return {
      error:
        "barber_id deve ser UUID do barbeiro (list_barbers), não o nome.",
    };
  }

  const appRow = await pool.query<{
    barber_id: string;
    duration_minutes: number;
  }>(
    `SELECT a.barber_id, a.duration_minutes FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.id = $1 AND a.barbershop_id = $2 AND a.status NOT IN ('cancelled')
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($3::text[])`,
    [appointmentId, barbershopId, matchKeys],
  );
  if (appRow.rows.length === 0)
    return {
      error:
        "Agendamento não encontrado, já cancelado ou não pertence a este cliente",
    };
  const { barber_id: currentBarberId, duration_minutes: duration } =
    appRow.rows[0];
  const barberId = params.barber_id ?? currentBarberId;

  const bufferMins = await getBookingBufferMinutes(barbershopId);
  const startMins =
    parseInt(timeNorm.slice(0, 2), 10) * 60 +
    parseInt(timeNorm.slice(3, 5), 10);
  const endMins = startMins + duration;
  const { todayStr, nowMins } = await getNowInBarbershopTz(barbershopId);
  if (params.date === todayStr && startMins < Math.ceil(nowMins / 5) * 5) {
    return {
      error: "Horário no passado.",
      code: "PAST_TIME" as const,
      message:
        "Escolha um horário a partir de agora. Use get_next_slots ou check_availability.",
    };
  }
  const conflictCheck = await pool.query(
    `SELECT 1 FROM public.appointments
   WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date AND status NOT IN ('cancelled') AND id != $4
   AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes::int + $7::int > $5::int
   AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int - $7::int < $6::int`,
    [
      barbershopId,
      barberId,
      params.date,
      appointmentId,
      startMins,
      endMins,
      bufferMins,
    ],
  );
  if (conflictCheck.rows.length > 0) {
    return {
      error: "Horário já ocupado ou intervalo insuficiente para este barbeiro.",
      code: "SLOT_CONFLICT" as const,
      message:
        "Horário indisponível. Chame get_next_slots ou check_availability e ofereça alternativas.",
    };
  }
  await cancelReminderForAppointment(appointmentId);
  await pool.query(
    `UPDATE public.appointments SET scheduled_date = $1::date, scheduled_time = $2::time, barber_id = $3, updated_at = now() WHERE id = $4`,
    [params.date, timeNorm, barberId, appointmentId],
  );
  const hasAutomation = await barbershopHasAutomation(barbershopId);
  if (hasAutomation) {
    const reminderRow = await pool.query<{
      client_phone: string;
      client_name: string | null;
      barber_name: string;
      slug: string | null;
      timezone: string;
      public_token: string;
    }>(
      `SELECT c.phone AS client_phone, c.name AS client_name, b.name AS barber_name, bs.slug, COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone, a.public_token
       FROM public.appointments a
       JOIN public.clients c ON c.id = a.client_id
       JOIN public.barbers b ON b.id = a.barber_id
       JOIN public.barbershops bs ON bs.id = a.barbershop_id
       LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = a.barbershop_id
       WHERE a.id = $1 AND a.barbershop_id = $2`,
      [appointmentId, barbershopId],
    );
    const sr = await pool.query<{ name: string }>(
      `SELECT s.name FROM public.appointment_services aps JOIN public.services s ON s.id = aps.service_id WHERE aps.appointment_id = $1 ORDER BY aps.position`,
      [appointmentId],
    );
    const row = reminderRow.rows[0];
    if (row) {
      await scheduleReminderForAppointment({
        barbershopId,
        appointmentId,
        publicToken: row.public_token,
        clientPhone: row.client_phone,
        clientName: row.client_name,
        barberName: row.barber_name,
        serviceNames: sr.rows.map((r) => r.name),
        scheduledDate: params.date,
        scheduledTime: timeNorm,
        slug: row.slug,
        timezone: row.timezone,
      });
      await scheduleReminder2hForAppointment({
        barbershopId,
        appointmentId,
        publicToken: row.public_token,
        clientPhone: row.client_phone,
        clientName: row.client_name,
        barberName: row.barber_name,
        serviceNames: sr.rows.map((r) => r.name),
        scheduledDate: params.date,
        scheduledTime: timeNorm,
        slug: row.slug,
        timezone: row.timezone,
      });
    }
  }
  return { ok: true, date: params.date, time: timeNorm };
}

export async function addToWaitlist(
  barbershopId: string,
  params: {
    client_phone: string;
    client_name?: string;
    desired_date: string;
    service_id?: string;
    barber_id?: string;
    notes?: string;
  },
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.desired_date))
    return { error: "desired_date must be yyyy-MM-dd" };
  const phone = params.client_phone.replace(/\D/g, "");
  if (!phone) return { error: "client_phone required" };
  if (params.service_id && !isValidUuid(params.service_id))
    return { error: "service_id inválido" };
  if (params.barber_id && !isValidUuid(params.barber_id))
    return { error: "barber_id inválido" };

  const r = await pool.query(
    `INSERT INTO public.appointment_waitlist
      (barbershop_id, client_phone, client_name, desired_date, service_id, barber_id, source, notes, status, updated_at)
     VALUES ($1, $2, $3, $4::date, $5, $6, 'ai', $7, 'active', now())
     RETURNING id, barbershop_id, client_phone, client_name, desired_date, service_id, barber_id, status, created_at`,
    [
      barbershopId,
      phone,
      params.client_name ?? null,
      params.desired_date,
      params.service_id ?? null,
      params.barber_id ?? null,
      params.notes ?? null,
    ],
  );
  return truncateForLlm(r.rows[0]);
}

// ─── Plan tools ──────────────────────────────────────────────────────────────

export async function listPlans(barbershopId: string): Promise<unknown> {
  try {
    const r = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      service_ids: string[];
      price: string;
      billing_cycle: string;
      max_visits: number | null;
      service_names: unknown;
    }>(
      `SELECT p.id, p.name, p.description, p.service_ids, p.price, p.billing_cycle, p.max_visits,
              COALESCE(
                (SELECT json_agg(s.name ORDER BY s.name)
                 FROM public.services s
                 WHERE s.id = ANY(p.service_ids) AND s.barbershop_id = $1),
                '[]'::json
              ) AS service_names
       FROM public.barbershop_plans p
       WHERE p.barbershop_id = $1 AND p.is_active = true
       ORDER BY p.price ASC`,
      [barbershopId],
    );
    if (r.rows.length === 0) return { plans: [], message: "Nenhum plano cadastrado nesta barbearia." };
    return truncateForLlm({ plans: r.rows });
  } catch {
    return { plans: [], message: "Planos indisponíveis no momento." };
  }
}

export async function subscribeClientToPlan(
  barbershopId: string,
  params: { client_phone: string; plan_id: string; billing_day?: number },
): Promise<unknown> {
  if (!isValidUuid(params.plan_id)) return { error: "plan_id inválido" };
  const phone = params.client_phone.replace(/\D/g, "");
  if (!phone) return { error: "client_phone required" };

  const planRow = await pool.query<{ id: string; name: string; price: string; billing_cycle: string }>(
    `SELECT id, name, price, billing_cycle FROM public.barbershop_plans
     WHERE id = $1 AND barbershop_id = $2 AND is_active = true`,
    [params.plan_id, barbershopId],
  );
  if (!planRow.rows[0]) return { error: "Plano não encontrado ou inativo." };
  const plan = planRow.rows[0];

  const clientRow = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = $2 LIMIT 1`,
    [barbershopId, phone],
  );
  if (!clientRow.rows[0]) return { error: "Cliente não encontrado. Realize um agendamento primeiro para criar o cadastro." };
  const clientId = clientRow.rows[0].id;

  const today = new Date();
  const billingDay = Math.min(Math.max(params.billing_day ?? today.getDate(), 1), 28);
  const nextBillingDate = new Date(today.getFullYear(), today.getMonth(), billingDay);
  if (nextBillingDate <= today) {
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
  }
  const nextBillingStr = nextBillingDate.toISOString().slice(0, 10);

  const sub = await pool.query<{ id: string }>(
    `INSERT INTO public.client_plan_subscriptions
       (barbershop_id, client_id, plan_id, billing_day, next_billing_date)
     VALUES ($1, $2, $3, $4, $5::date)
     RETURNING id`,
    [barbershopId, clientId, params.plan_id, billingDay, nextBillingStr],
  );
  const subscriptionId = sub.rows[0]?.id;
  if (!subscriptionId) return { error: "Falha ao criar assinatura." };

  await pool.query(
    `INSERT INTO public.plan_pix_charges
       (subscription_id, barbershop_id, amount, due_date, status)
     VALUES ($1, $2, $3::numeric, $4::date, 'pending')`,
    [subscriptionId, barbershopId, plan.price, nextBillingStr],
  );

  return truncateForLlm({
    ok: true,
    subscription_id: subscriptionId,
    plan_name: plan.name,
    price: plan.price,
    billing_cycle: plan.billing_cycle,
    next_billing_date: nextBillingStr,
    billing_day: billingDay,
    message: `Assinatura do plano "${plan.name}" criada! A cobrança PIX de R$ ${Number(plan.price).toFixed(2)} será enviada por aqui no dia ${billingDay} de cada mês.`,
  });
}

export async function sendPixPlanCharge(
  barbershopId: string,
  params: { subscription_id: string; client_phone: string },
): Promise<unknown> {
  if (!isValidUuid(params.subscription_id)) return { error: "subscription_id inválido" };

  const subRow = await pool.query<{
    plan_name: string;
    price: string;
    client_phone: string;
    next_billing_date: string;
  }>(
    `SELECT bp.name AS plan_name, bp.price, c.phone AS client_phone, s.next_billing_date
     FROM public.client_plan_subscriptions s
     JOIN public.barbershop_plans bp ON bp.id = s.plan_id
     JOIN public.clients c ON c.id = s.client_id
     WHERE s.id = $1 AND s.barbershop_id = $2 AND s.status = 'active'`,
    [params.subscription_id, barbershopId],
  );
  if (!subRow.rows[0]) return { error: "Assinatura não encontrada ou inativa." };
  const sub = subRow.rows[0];

  const shopRow = await pool.query<{ pix_key: string | null; name: string; address: string | null }>(
    `SELECT pix_key, name, address FROM public.barbershops WHERE id = $1`,
    [barbershopId],
  );
  const shop = shopRow.rows[0];
  if (!shop?.pix_key) return { error: "Chave PIX não cadastrada. Configure em Configurações → Dados da NavalhIA." };

  const connRow = await pool.query<{ uazapi_instance_token_encrypted: string }>(
    `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
     WHERE barbershop_id = $1 AND provider = 'uazapi' AND status = 'connected' AND uazapi_instance_token_encrypted IS NOT NULL LIMIT 1`,
    [barbershopId],
  );
  const enc = connRow.rows[0]?.uazapi_instance_token_encrypted;
  if (!enc || !config.appEncryptionKey) return { error: "WhatsApp não conectado." };
  const token = decrypt(enc, config.appEncryptionKey);

  const clientPhone = (params.client_phone || sub.client_phone).replace(/\D/g, "");
  const amount = Number(sub.price);
  const city = (shop.address ?? "").split(",").pop()?.trim() || "Brasil";

  try {
    await sendPixRequest({
      token,
      number: clientPhone,
      amount,
      description: `Plano ${sub.plan_name} — NavalhIA`,
      pixKey: shop.pix_key,
      name: shop.name,
      city,
    });
  } catch (e) {
    return { error: `Falha ao enviar PIX: ${e instanceof Error ? e.message : String(e)}` };
  }

  await pool.query(
    `UPDATE public.plan_pix_charges SET status = 'sent', sent_at = now()
     WHERE subscription_id = $1 AND status = 'pending' AND due_date = $2`,
    [params.subscription_id, sub.next_billing_date],
  );

  return {
    ok: true,
    amount,
    message: `Cobrança PIX de R$ ${amount.toFixed(2)} enviada para o plano "${sub.plan_name}".`,
  };
}
