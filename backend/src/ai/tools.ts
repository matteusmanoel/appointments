import { pool } from "../db.js";
import { barbershopHasAutomation, cancelReminderForAppointment, scheduleReminderForAppointment } from "../outbound/scheduled-messages.js";

const MAX_TEXT_LENGTH = 8 * 1024;

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

export async function listServices(barbershopId: string): Promise<unknown> {
  const r = await pool.query(
    `SELECT id, name, description, price, duration_minutes, category
     FROM public.services WHERE barbershop_id = $1 AND is_active = true ORDER BY name`,
    [barbershopId]
  );
  return truncateForLlm(r.rows);
}

export async function listBarbers(barbershopId: string): Promise<unknown> {
  const r = await pool.query(
    `SELECT id, name, status, schedule
     FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active', 'break') ORDER BY name`,
    [barbershopId]
  );
  return truncateForLlm(r.rows);
}

export async function listAppointments(
  barbershopId: string,
  date: string,
  barberId?: string
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "date must be yyyy-MM-dd" };
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

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
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
  }
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return { error: "date must be yyyy-MM-dd" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  if (!/^\d{2}:\d{2}$/.test(timeNorm)) return { error: "time must be HH:mm" };

  const serviceIds: string[] = (params.service_ids?.length ? params.service_ids : params.service_id ? [params.service_id] : []) as string[];
  if (serviceIds.length === 0) return { error: "service_id or service_ids (min 1) required" };

  const afterMins = params.after_time ? timeToMinutes(params.after_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2")) : null;
  if (params.after_time != null && afterMins == null) return { error: "after_time must be HH:mm" };

  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId]
  );
  if (serviceRows.rows.length !== serviceIds.length) return { error: "Service(s) not found" };
  const services = serviceRows.rows.map((r) => ({
    service_id: String(r.id),
    name: String(r.name ?? ""),
    price: Number(r.price ?? 0),
    duration_minutes: Number(r.duration_minutes ?? 0),
  }));
  const totalDuration = services.reduce((sum, r) => sum + Number(r.duration_minutes ?? 0), 0);
  const totalPrice = services.reduce((sum, r) => sum + Number(r.price ?? 0), 0);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return { error: "Invalid service duration" };
  if (!Number.isFinite(totalPrice) || totalPrice < 0) return { error: "Invalid service price" };

  const requestedStart = timeToMinutes(timeNorm);
  if (requestedStart == null) return { error: "Invalid time" };
  const requestedEnd = requestedStart + totalDuration;

  if (afterMins != null && requestedStart < afterMins) {
    return truncateForLlm({
      date: params.date,
      time: timeNorm,
      duration_minutes: totalDuration,
      total_price: services.reduce((s, r) => s + Number(r.price ?? 0), 0),
      services,
      requested: { available: false, barbers: [] },
      why_unavailable: "Horário no passado ou antes do mínimo para hoje. Use get_next_slots para obter os próximos horários.",
      alternatives: [],
    });
  }

  const barbers = await pool.query<{ id: string; name: string; schedule: unknown }>(
    `SELECT id, name, schedule
     FROM public.barbers
     WHERE barbershop_id = $1 AND status IN ('active','break')
     ${params.barber_id ? "AND id = $2" : ""}
     ORDER BY name`,
    params.barber_id ? [barbershopId, params.barber_id] : [barbershopId]
  );
  if (barbers.rows.length === 0) return { error: "No barbers available" };

  const dowRow = await pool.query<{ dow: number }>("select extract(dow from $1::date)::int as dow", [params.date]);
  const dow = dowRow.rows[0]?.dow ?? 0; // 0=Sunday ... 6=Saturday
  const dayKey = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[dow] ?? "monday";

  // Shop-level business hours + closures (single source of open/closed for slot calculation).
  const [shopRow, closureRow] = await Promise.all([
    pool.query<{ business_hours: unknown }>("SELECT business_hours FROM public.barbershops WHERE id = $1", [barbershopId]),
    pool.query<{ status: string; start_time: string | null; end_time: string | null }>(
      "SELECT status, start_time::text as start_time, end_time::text as end_time FROM public.barbershop_closures WHERE barbershop_id = $1 AND closure_date = $2::date",
      [barbershopId, params.date]
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
  const bh = (shopRow.rows[0]?.business_hours ?? {}) as Record<string, { start?: string; end?: string } | null>;
  const bhDay = bh[dayKey];
  let shopStartM: number | null = null;
  let shopEndM: number | null = null;
  if (closure?.status === "open_partial" && closure.start_time && closure.end_time) {
    shopStartM = timeToMinutes(closure.start_time.slice(0, 5));
    shopEndM = timeToMinutes(closure.end_time.slice(0, 5));
  } else if (bhDay && typeof bhDay === "object") {
    shopStartM = timeToMinutes(String(bhDay.start ?? ""));
    shopEndM = timeToMinutes(String(bhDay.end ?? ""));
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

  const candidates: { barber_id: string; barber_name: string; start: number; end: number }[] = [];
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
    candidates.push({ barber_id: b.id, barber_name: b.name, start: startM, end: endM });
  }

  const appts = await pool.query<{ barber_id: string; scheduled_time: string; duration_minutes: number }>(
    `SELECT barber_id, scheduled_time::text as scheduled_time, duration_minutes
     FROM public.appointments
     WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled')
     ${params.barber_id ? "AND barber_id = $3" : ""}`,
    params.barber_id ? [barbershopId, params.date, params.barber_id] : [barbershopId, params.date]
  );
  const byBarber = new Map<string, { start: number; end: number }[]>();
  for (const a of appts.rows) {
    const t = String(a.scheduled_time ?? "").slice(0, 5);
    const s = timeToMinutes(t);
    const d = Number(a.duration_minutes ?? 0);
    if (s == null || !Number.isFinite(d) || d <= 0) continue;
    const e = s + d;
    const list = byBarber.get(a.barber_id) ?? [];
    list.push({ start: s, end: e });
    byBarber.set(a.barber_id, list);
  }

  const availableBarbers: { barber_id: string; barber_name: string }[] = [];
  const debugBarbers: { barber_id: string; barber_name: string; in_schedule: boolean; conflict: boolean }[] = [];
  for (const c of candidates) {
    const occ = byBarber.get(c.barber_id) ?? [];
    const conflict = occ.some((o) => overlaps(requestedStart, requestedEnd, o.start, o.end));
    if (!conflict) availableBarbers.push({ barber_id: c.barber_id, barber_name: c.barber_name });
    debugBarbers.push({ barber_id: c.barber_id, barber_name: c.barber_name, in_schedule: true, conflict });
  }

  const available = availableBarbers.length > 0;

  // Alternatives: closest free slots on a 15-min grid around the requested time.
  const alternatives: { time: string; barber_id: string; barber_name: string }[] = [];
  if (!available) {
    const deltas: number[] = [];
    for (let step = 1; step <= 12; step++) {
      deltas.push(step * 15, -step * 15); // +/- up to 3 hours
    }
    outer: for (const delta of deltas) {
      const slotStart = requestedStart + delta;
      if (afterMins != null && slotStart < afterMins) continue;
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
        const conflict = occ.some((o) => overlaps(slotStart, slotEnd, o.start, o.end));
        if (!conflict) {
          alternatives.push({ time: minutesToTime(slotStart), barber_id: b.id, barber_name: b.name });
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
    why_unavailable:
      available ? null : "Não encaixou no expediente ou conflitou com outros horários do barbeiro (sem expor dados).",
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
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return { ok: false, error: "Data inválida" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  if (!/^\d{2}:\d{2}$/.test(timeNorm)) return { ok: false, error: "Horário inválido" };
  const startMins = timeToMinutes(timeNorm);
  if (startMins == null) return { ok: false, error: "Horário inválido" };
  const endMins = startMins + params.duration_minutes;

  const tzRow = await pool.query<{ timezone: string }>(
    `SELECT COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone FROM public.barbershop_ai_settings ais WHERE ais.barbershop_id = $1`,
    [barbershopId]
  );
  const tz = tzRow.rows[0]?.timezone ?? "America/Sao_Paulo";
  const startUtcRow = await pool.query<{ start_utc: Date }>(
    `SELECT (($1::date + $2::time) AT TIME ZONE $3)::timestamptz AS start_utc`,
    [params.date, timeNorm, tz]
  );
  const startUtc = startUtcRow.rows[0]?.start_utc;
  if (!startUtc || startUtc.getTime() <= Date.now()) {
    return { ok: false, error: "Horário não pode ser no passado" };
  }

  const dowRow = await pool.query<{ dow: number }>("SELECT extract(dow from $1::date)::int AS dow", [params.date]);
  const dow = dowRow.rows[0]?.dow ?? 0;
  const dayKey = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[dow] ?? "monday";

  const [shopRow, closureRow, barberRow] = await Promise.all([
    pool.query<{ business_hours: unknown }>("SELECT business_hours FROM public.barbershops WHERE id = $1", [barbershopId]),
    pool.query<{ status: string; start_time: string | null; end_time: string | null }>(
      "SELECT status, start_time::text as start_time, end_time::text as end_time FROM public.barbershop_closures WHERE barbershop_id = $1 AND closure_date = $2::date",
      [barbershopId, params.date]
    ),
    pool.query<{ id: string; schedule: unknown }>("SELECT id, schedule FROM public.barbers WHERE id = $1 AND barbershop_id = $2", [params.barber_id, barbershopId]),
  ]);
  if (barberRow.rows.length === 0) return { ok: false, error: "Barbeiro não encontrado" };
  const closure = closureRow.rows[0];
  if (closure?.status === "closed") return { ok: false, error: "Barbearia fechada nesta data" };

  const bh = (shopRow.rows[0]?.business_hours ?? {}) as Record<string, { start?: string; end?: string } | null>;
  let shopStartM: number | null = null;
  let shopEndM: number | null = null;
  if (closure?.status === "open_partial" && closure.start_time && closure.end_time) {
    shopStartM = timeToMinutes(closure.start_time.slice(0, 5));
    shopEndM = timeToMinutes(closure.end_time.slice(0, 5));
  } else {
    const bhDay = bh[dayKey];
    if (bhDay && typeof bhDay === "object") {
      shopStartM = timeToMinutes(String(bhDay.start ?? ""));
      shopEndM = timeToMinutes(String(bhDay.end ?? ""));
    }
  }
  if (shopStartM == null || shopEndM == null) return { ok: false, error: "Barbearia não abre neste dia" };
  if (startMins < shopStartM || endMins > shopEndM) return { ok: false, error: "Horário fora do expediente" };

  const sched = (barberRow.rows[0].schedule ?? {}) as Record<string, { start?: string; end?: string } | null>;
  const barberDay = sched[dayKey];
  if (barberDay && typeof barberDay === "object") {
    const bStart = timeToMinutes(String(barberDay.start ?? ""));
    const bEnd = timeToMinutes(String(barberDay.end ?? ""));
    if (bStart != null && startMins < bStart) return { ok: false, error: "Horário fora do expediente do barbeiro" };
    if (bEnd != null && endMins > bEnd) return { ok: false, error: "Horário fora do expediente do barbeiro" };
  }

  const conflictParams = params.excludeAppointmentId
    ? [barbershopId, params.barber_id, params.date, startMins, endMins, params.excludeAppointmentId]
    : [barbershopId, params.barber_id, params.date, startMins, endMins];
  const conflictQuery = params.excludeAppointmentId
    ? `SELECT 1 FROM public.appointments
       WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date AND status NOT IN ('cancelled') AND id != $6
       AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes > $4 AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int < $5`
    : `SELECT 1 FROM public.appointments
       WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date AND status NOT IN ('cancelled')
       AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes > $4 AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int < $5`;
  const conflictCheck = await pool.query(conflictQuery, conflictParams);
  if (conflictCheck.rows.length > 0) return { ok: false, error: "Horário já ocupado para este barbeiro" };

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
  }
): Promise<unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return { error: "date must be yyyy-MM-dd" };
  const serviceIds: string[] = (params.service_ids?.length ? params.service_ids : params.service_id ? [params.service_id] : []) as string[];
  if (serviceIds.length === 0) return { error: "service_id or service_ids (min 1) required" };

  const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 20);
  const afterMins = params.after_time ? timeToMinutes(params.after_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2")) : null;
  if (params.after_time != null && afterMins == null) return { error: "after_time must be HH:mm" };

  const [shopRow, closureRow, serviceRows, barbersRows, apptsRows] = await Promise.all([
    pool.query<{ business_hours: unknown }>("SELECT business_hours FROM public.barbershops WHERE id = $1", [barbershopId]),
    pool.query<{ status: string; start_time: string | null; end_time: string | null }>(
      "SELECT status, start_time::text as start_time, end_time::text as end_time FROM public.barbershop_closures WHERE barbershop_id = $1 AND closure_date = $2::date",
      [barbershopId, params.date]
    ),
    pool.query("SELECT id, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2", [serviceIds, barbershopId]),
    pool.query<{ id: string; name: string; schedule: unknown }>(
      `SELECT id, name, schedule FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active','break') ${params.barber_id ? "AND id = $2" : ""} ORDER BY name`,
      params.barber_id ? [barbershopId, params.barber_id] : [barbershopId]
    ),
    pool.query<{ barber_id: string; scheduled_time: string; duration_minutes: number }>(
      `SELECT barber_id, scheduled_time::text as scheduled_time, duration_minutes FROM public.appointments
       WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled') ${params.barber_id ? "AND barber_id = $3" : ""}`,
      params.barber_id ? [barbershopId, params.date, params.barber_id] : [barbershopId, params.date]
    ),
  ]);

  if (shopRow.rows.length === 0) return { error: "Barbershop not found" };
  if (serviceRows.rows.length !== serviceIds.length) return { error: "Service(s) not found" };
  const totalDuration = serviceRows.rows.reduce((s, r) => s + Number(r.duration_minutes ?? 0), 0);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return { error: "Invalid service duration" };

  const barbers = barbersRows.rows;
  if (barbers.length === 0) return { slots: [], message: "Nenhum barbeiro disponível." };

  const dowRow = await pool.query<{ dow: number }>("SELECT extract(dow from $1::date)::int AS dow", [params.date]);
  const dow = dowRow.rows[0]?.dow ?? 0;
  const dayKey = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[dow] ?? "monday";

  let startM: number;
  let endM: number;
  const closure = closureRow.rows[0];
  if (closure?.status === "closed") {
    return truncateForLlm({ date: params.date, slots: [], message: "Barbearia fechada nesta data." });
  }
  if (closure?.status === "open_partial" && closure.start_time != null && closure.end_time != null) {
    const s = timeToMinutes(closure.start_time.slice(0, 5));
    const e = timeToMinutes(closure.end_time.slice(0, 5));
    if (s == null || e == null) return { error: "Invalid closure times" };
    startM = s;
    endM = e;
  } else {
    const bh = (shopRow.rows[0].business_hours ?? {}) as Record<string, { start?: string; end?: string } | null>;
    const day = bh[dayKey];
    if (!day || typeof day !== "object") {
      return truncateForLlm({ date: params.date, slots: [], message: "Barbearia não abre neste dia." });
    }
    const s = timeToMinutes(String(day.start ?? "09:00"));
    const e = timeToMinutes(String(day.end ?? "19:00"));
    if (s == null || e == null) return { error: "Invalid business_hours" };
    startM = s;
    endM = e;
  }

  if (afterMins != null) startM = Math.max(startM, afterMins);
  const slotEndMax = endM - totalDuration;
  if (startM >= slotEndMax) {
    return truncateForLlm({ date: params.date, slots: [], message: "Não há mais horários disponíveis a partir do horário informado." });
  }

  const byBarber = new Map<string, { start: number; end: number }[]>();
  for (const a of apptsRows.rows) {
    const t = String(a.scheduled_time ?? "").slice(0, 5);
    const s = timeToMinutes(t);
    const d = Number(a.duration_minutes ?? 0);
    if (s == null || !Number.isFinite(d) || d <= 0) continue;
    const list = byBarber.get(a.barber_id) ?? [];
    list.push({ start: s, end: s + d });
    byBarber.set(a.barber_id, list);
  }

  const slots: { time: string; barber_id: string; barber_name: string }[] = [];
  const STEP = 15;
  for (let slotStart = startM; slotStart < slotEndMax && slots.length < limit; slotStart += STEP) {
    const slotEnd = slotStart + totalDuration;
    for (const b of barbers) {
      const sched = (b.schedule ?? {}) as Record<string, { start?: string; end?: string }>;
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
      if (occ.some((o) => overlaps(slotStart, slotEnd, o.start, o.end))) continue;
      slots.push({ time: minutesToTime(slotStart), barber_id: b.id, barber_name: b.name });
      break;
    }
  }

  return truncateForLlm({ date: params.date, slots, duration_minutes: totalDuration });
}

export async function upsertClient(
  barbershopId: string,
  phone: string,
  name?: string,
  notes?: string
): Promise<unknown> {
  const normalizedPhone = phone.replace(/\D/g, "") || phone;
  if (!normalizedPhone) return { error: "phone required" };
  const r = await pool.query(
    `INSERT INTO public.clients (barbershop_id, name, phone, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, clients.name),
       notes = COALESCE(EXCLUDED.notes, clients.notes),
       updated_at = now()
     RETURNING id, name, phone, barbershop_id`,
    [barbershopId, name ?? "Cliente", normalizedPhone, notes ?? null]
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
  }
): Promise<unknown> {
  const resolveClientId = async (): Promise<string | null> => {
    if (params.client_id && typeof params.client_id === "string") return params.client_id;
    const phone = (params.client_phone ?? "").toString();
    if (!phone) return null;
    const r = (await upsertClient(barbershopId, phone, params.client_name)) as unknown;
    if (r && typeof r === "object") {
      const id = (r as Record<string, unknown>).id;
      if (typeof id === "string" && id) return id;
    }
    return null;
  };

  const clientId = await resolveClientId();
  if (!clientId) return { error: "client_phone or client_id required" };

  const serviceIds: string[] = (params.service_ids?.length ? params.service_ids : params.service_id ? [params.service_id] : []) as string[];
  if (serviceIds.length === 0) return { error: "service_id or service_ids (min 1) required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return { error: "date must be yyyy-MM-dd" };
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(params.time)) return { error: "time must be HH:mm or HH:mm:ss" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");

  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId]
  );
  type ServiceRow = { id: string; name: string; price: unknown; duration_minutes: unknown };
  const byId = new Map<string, ServiceRow>(serviceRows.rows.map((r: ServiceRow) => [r.id, r]));
  if (byId.size !== serviceIds.length) {
    const missing = serviceIds.filter((id) => !byId.has(id));
    return { error: "Service(s) not found", ids: missing };
  }
  let totalPrice = 0;
  let totalDuration = 0;
  const snapshots: { service_id: string; name: string; price: number; duration_minutes: number }[] = [];
  for (const sid of serviceIds) {
    const r = byId.get(sid)!;
    const price = Number(r.price);
    const dur = Number(r.duration_minutes);
    totalPrice += price;
    totalDuration += dur;
    snapshots.push({ service_id: r.id, name: r.name ?? "", price, duration_minutes: dur });
  }
  const barberRow = await pool.query(
    "SELECT commission_percentage FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
    [params.barber_id, barbershopId]
  );
  const barberPct = barberRow.rows[0]?.commission_percentage ?? 40;
  const commissionAmount = totalPrice * (barberPct / 100);
  const startMins = parseInt(timeNorm.slice(0, 2), 10) * 60 + parseInt(timeNorm.slice(3, 5), 10);
  const endMins = startMins + totalDuration;
  const conflictCheck = await pool.query(
    `SELECT 1 FROM public.appointments
     WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date AND status NOT IN ('cancelled')
     AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes > $4
     AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int < $5`,
    [barbershopId, params.barber_id, params.date, startMins, endMins]
  );
  if (conflictCheck.rows.length > 0) {
    return { error: "Horário já ocupado para este barbeiro" };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appResult = await client.query(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status, notes)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9, 'pending', $10)
       RETURNING id, scheduled_date, scheduled_time, status, public_token`,
      [barbershopId, clientId, params.barber_id, serviceIds[0], params.date, timeNorm, totalDuration, totalPrice, commissionAmount, params.notes ?? null]
    );
    const appointment = appResult.rows[0];
    for (let pos = 0; pos < snapshots.length; pos++) {
      const s = snapshots[pos];
      await client.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [appointment.id, s.service_id, s.price, s.duration_minutes, s.name || null, pos]
      );
    }
    await client.query("COMMIT");
    const serviceNamesArr = snapshots.map((s) => s.name);
    barbershopHasAutomation(barbershopId).then((has) => {
      if (!has) return;
      return pool
        .query<{ client_phone: string; client_name: string | null; barber_name: string; slug: string | null; timezone: string; public_token: string }>(
          `SELECT c.phone AS client_phone, c.name AS client_name, b.name AS barber_name, bs.slug, COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone, a.public_token
           FROM public.appointments a
           JOIN public.clients c ON c.id = a.client_id
           JOIN public.barbers b ON b.id = a.barber_id
           JOIN public.barbershops bs ON bs.id = a.barbershop_id
           LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = a.barbershop_id
           WHERE a.id = $1 AND a.barbershop_id = $2`,
          [appointment.id, barbershopId]
        )
        .then((r) => {
          const row = r.rows[0];
          if (!row?.public_token) return;
          return scheduleReminderForAppointment({
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
    }).catch(() => {});
    return truncateForLlm(appointment);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * List upcoming appointments for the client (by phone). Used by agent for cancel/reschedule intents.
 */
export async function listClientUpcomingAppointments(
  barbershopId: string,
  clientPhone: string
): Promise<unknown> {
  const normalized = clientPhone.replace(/\D/g, "");
  if (!normalized) return { error: "client_phone required" };
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
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $2
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [barbershopId, normalized]
  );
  return truncateForLlm(
    r.rows.map((row) => ({
      id: row.id,
      date: row.scheduled_date,
      time: String(row.scheduled_time).slice(0, 5),
      service_names: row.service_names ?? "",
      barber_name: row.barber_name,
    }))
  );
}

/**
 * Cancel an appointment. Only allowed if the appointment's client phone matches client_phone.
 */
export async function cancelAppointmentByAgent(
  barbershopId: string,
  appointmentId: string,
  clientPhone: string
): Promise<unknown> {
  const normalized = clientPhone.replace(/\D/g, "");
  if (!normalized) return { error: "Telefone do cliente é obrigatório" };
  const check = await pool.query<{ id: string }>(
    `SELECT a.id FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.id = $1 AND a.barbershop_id = $2 AND a.status NOT IN ('cancelled')
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $3`,
    [appointmentId, barbershopId, normalized]
  );
  if (check.rows.length === 0) return { error: "Agendamento não encontrado, já cancelado ou não pertence a este cliente" };
  await pool.query(
    `UPDATE public.appointments SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND barbershop_id = $2`,
    [appointmentId, barbershopId]
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
  params: { date: string; time: string; barber_id?: string }
): Promise<unknown> {
  const normalized = clientPhone.replace(/\D/g, "");
  if (!normalized) return { error: "Telefone do cliente é obrigatório" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return { error: "date must be yyyy-MM-dd" };
  const timeNorm = params.time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  if (!/^\d{2}:\d{2}$/.test(timeNorm)) return { error: "time must be HH:mm" };

  const appRow = await pool.query<{ barber_id: string; duration_minutes: number }>(
    `SELECT a.barber_id, a.duration_minutes FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.id = $1 AND a.barbershop_id = $2 AND a.status NOT IN ('cancelled')
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $3`,
    [appointmentId, barbershopId, normalized]
  );
  if (appRow.rows.length === 0) return { error: "Agendamento não encontrado, já cancelado ou não pertence a este cliente" };
  const { barber_id: currentBarberId, duration_minutes: duration } = appRow.rows[0];
  const barberId = params.barber_id ?? currentBarberId;

  const startMins = parseInt(timeNorm.slice(0, 2), 10) * 60 + parseInt(timeNorm.slice(3, 5), 10);
  const endMins = startMins + duration;
  const conflictCheck = await pool.query(
    `SELECT 1 FROM public.appointments
     WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date AND status NOT IN ('cancelled') AND id != $4
     AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes > $5
     AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int < $6`,
    [barbershopId, barberId, params.date, appointmentId, startMins, endMins]
  );
  if (conflictCheck.rows.length > 0) {
    return { error: "Horário já ocupado para este barbeiro" };
  }
  await cancelReminderForAppointment(appointmentId);
  await pool.query(
    `UPDATE public.appointments SET scheduled_date = $1::date, scheduled_time = $2::time, barber_id = $3, updated_at = now() WHERE id = $4`,
    [params.date, timeNorm, barberId, appointmentId]
  );
  const hasAutomation = await barbershopHasAutomation(barbershopId);
  if (hasAutomation) {
    const reminderRow = await pool.query<{ client_phone: string; client_name: string | null; barber_name: string; slug: string | null; timezone: string; public_token: string }>(
      `SELECT c.phone AS client_phone, c.name AS client_name, b.name AS barber_name, bs.slug, COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone, a.public_token
       FROM public.appointments a
       JOIN public.clients c ON c.id = a.client_id
       JOIN public.barbers b ON b.id = a.barber_id
       JOIN public.barbershops bs ON bs.id = a.barbershop_id
       LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = a.barbershop_id
       WHERE a.id = $1 AND a.barbershop_id = $2`,
      [appointmentId, barbershopId]
    );
    const sr = await pool.query<{ name: string }>(
      `SELECT s.name FROM public.appointment_services aps JOIN public.services s ON s.id = aps.service_id WHERE aps.appointment_id = $1 ORDER BY aps.position`,
      [appointmentId]
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
    }
  }
  return { ok: true, date: params.date, time: timeNorm };
}
