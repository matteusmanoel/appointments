import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

const statusEnum = z.enum(["pending", "confirmed", "completed", "cancelled", "no_show"]);
const createBody = z.object({
  client_id: z.string().uuid(),
  barber_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  service_ids: z.array(z.string().uuid()).min(1).optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  notes: z.string().optional(),
}).refine((d) => d.service_ids?.length ?? (d.service_id ? 1 : 0) >= 1, { message: "service_id or service_ids (min 1) required" });
const updateBody = z.object({
  status: statusEnum.optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  notes: z.string().optional(),
  price: z.number().positive().optional(),
  service_ids: z.array(z.string().uuid()).min(1).optional(),
});

async function checkSlotConflict(
  barbershopId: string,
  barberId: string,
  date: string,
  time: string,
  durationMinutes: number,
  excludeAppointmentId?: string
): Promise<boolean> {
  const [h, m] = time.split(":").map(Number);
  const startMins = h * 60 + m;
  const endMins = startMins + durationMinutes;
  let query = `
    SELECT 1 FROM public.appointments
    WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date
      AND status NOT IN ('cancelled')
      AND (
        (EXTRACT(EPOCH FROM scheduled_time) / 60)::int < $5
        AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes > $4
      )
  `;
  const params: unknown[] = [barbershopId, barberId, date, startMins, endMins];
  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    query += ` AND id != $${params.length}`;
  }
  const r = await pool.query(query, params);
  return r.rows.length > 0;
}

export const appointmentsRouter = Router();

appointmentsRouter.use(requireJwt);

appointmentsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const date = req.query.date as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const barber_id = req.query.barber_id as string | undefined;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const limit = req.query.limit != null ? Math.min(Math.max(0, parseInt(String(req.query.limit), 10)), 500) : undefined;
  const offset = req.query.offset != null ? Math.max(0, parseInt(String(req.query.offset), 10)) : undefined;
  let query = `
    SELECT a.id, a.barbershop_id, a.client_id, a.barber_id, a.service_id, a.scheduled_date, a.scheduled_time,
           a.duration_minutes, a.price, a.commission_amount, a.status, a.notes, a.created_at, a.updated_at,
           c.name AS client_name, c.phone AS client_phone,
           b.name AS barber_name,
           (SELECT COALESCE(array_agg(aps.service_id ORDER BY aps.position), ARRAY[]::uuid[]) FROM public.appointment_services aps WHERE aps.appointment_id = a.id) AS service_ids,
           (SELECT COALESCE(array_agg(COALESCE(aps.service_name, s.name) ORDER BY aps.position), ARRAY[]::text[]) FROM public.appointment_services aps LEFT JOIN public.services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS service_names
    FROM public.appointments a
    JOIN public.clients c ON c.id = a.client_id
    JOIN public.barbers b ON b.id = a.barber_id
    LEFT JOIN public.services s ON s.id = a.service_id
    WHERE a.barbershop_id = $1
  `;
  const params: unknown[] = [barbershopId];
  let paramIdx = 2;
  if (from && to) {
    params.push(from, to);
    query += ` AND a.scheduled_date >= $${paramIdx}::date AND a.scheduled_date <= $${paramIdx + 1}::date`;
    paramIdx += 2;
  } else if (date) {
    params.push(date);
    query += ` AND a.scheduled_date = $${paramIdx}::date`;
    paramIdx += 1;
  }
  if (barber_id) {
    params.push(barber_id);
    query += ` AND a.barber_id = $${paramIdx}`;
    paramIdx += 1;
  }
  if (status) {
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length) {
      params.push(statuses);
      query += ` AND a.status = ANY($${paramIdx}::text[])`;
      paramIdx += 1;
    }
  }
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    params.push(term, term);
    query += ` AND (c.name ILIKE $${paramIdx} OR c.phone ILIKE $${paramIdx + 1})`;
    paramIdx += 2;
  }
  query += " ORDER BY a.scheduled_date, a.scheduled_time";
  if (limit != null) {
    params.push(limit);
    query += ` LIMIT $${paramIdx}`;
    paramIdx += 1;
  }
  if (offset != null) {
    params.push(offset);
    query += ` OFFSET $${paramIdx}`;
  }
  const r = await pool.query(query, params);
  res.json(r.rows);
});

appointmentsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { client_id, barber_id, scheduled_date, scheduled_time, notes } = parsed.data;
  const serviceIds: string[] = parsed.data.service_ids?.length
    ? parsed.data.service_ids
    : parsed.data.service_id
      ? [parsed.data.service_id]
      : [];
  if (serviceIds.length === 0) {
    res.status(400).json({ error: "service_id or service_ids (min 1) required" });
    return;
  }
  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId]
  );
  type ServiceRow = { id: string; name: string; price: unknown; duration_minutes: unknown };
  const byId = new Map<string, ServiceRow>(serviceRows.rows.map((r: ServiceRow) => [r.id, r]));
  const missing = serviceIds.filter((id) => !byId.has(id));
  if (missing.length) {
    res.status(404).json({ error: "Service(s) not found", ids: missing });
    return;
  }
  const barberRow = await pool.query(
    "SELECT commission_percentage FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
    [barber_id, barbershopId]
  );
  const barberPct = barberRow.rows[0]?.commission_percentage ?? 40;
  let totalPrice = 0;
  let totalDuration = 0;
  const snapshots: { service_id: string; name: string; price: number; duration_minutes: number }[] = [];
  for (const sid of serviceIds) {
    const row = byId.get(sid)!;
    const price = Number(row.price);
    const dur = Number(row.duration_minutes);
    totalPrice += price;
    totalDuration += dur;
    snapshots.push({ service_id: row.id, name: row.name ?? "", price, duration_minutes: dur });
  }
  const commissionAmount = totalPrice * (barberPct / 100);
  const timeNorm = scheduled_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  const hasConflict = await checkSlotConflict(
    barbershopId,
    barber_id,
    scheduled_date,
    timeNorm,
    totalDuration
  );
  if (hasConflict) {
    res.status(409).json({ error: "Horário já ocupado para este barbeiro" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appResult = await client.query(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status, notes)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9, 'pending', $10)
       RETURNING id, barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status, notes, created_at, updated_at`,
      [barbershopId, client_id, barber_id, serviceIds[0], scheduled_date, timeNorm, totalDuration, totalPrice, commissionAmount, notes ?? null]
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
    const serviceIdsArr = snapshots.map((s) => s.service_id);
    const serviceNamesArr = snapshots.map((s) => s.name);
    res.status(201).json({ ...appointment, service_ids: serviceIdsArr, service_names: serviceNamesArr });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

appointmentsRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT a.*, c.name AS client_name, c.phone AS client_phone, b.name AS barber_name,
            (SELECT COALESCE(array_agg(aps.service_id ORDER BY aps.position), ARRAY[]::uuid[]) FROM public.appointment_services aps WHERE aps.appointment_id = a.id) AS service_ids,
            (SELECT COALESCE(array_agg(COALESCE(aps.service_name, s2.name) ORDER BY aps.position), ARRAY[]::text[]) FROM public.appointment_services aps LEFT JOIN public.services s2 ON s2.id = aps.service_id WHERE aps.appointment_id = a.id) AS service_names
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     JOIN public.barbers b ON b.id = a.barber_id
     LEFT JOIN public.services s ON s.id = a.service_id
     WHERE a.id = $1 AND a.barbershop_id = $2`,
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }
  const row = r.rows[0];
  res.json({
    ...row,
    service_name: Array.isArray(row.service_names) && row.service_names.length ? row.service_names[0] : row.service_name,
  });
});

appointmentsRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const existing = await pool.query(
    "SELECT * FROM public.appointments WHERE id = $1 AND barbershop_id = $2",
    [req.params.id, barbershopId]
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }
  const row = existing.rows[0];
  let durationMinutes = Number(row.duration_minutes);
  if (parsed.data.service_ids?.length) {
    const serviceRows = await pool.query(
      "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
      [parsed.data.service_ids, barbershopId]
    );
    type ServiceRowP = { id: string; name: string; price: unknown; duration_minutes: unknown };
    const byId = new Map<string, ServiceRowP>(serviceRows.rows.map((r: ServiceRowP) => [r.id, r]));
    const missing = parsed.data.service_ids.filter((id: string) => !byId.has(id));
    if (missing.length) {
      res.status(404).json({ error: "Service(s) not found", ids: missing });
      return;
    }
    let totalPrice = 0;
    let totalDuration = 0;
    const snapshots: { service_id: string; name: string; price: number; duration_minutes: number }[] = [];
    for (const sid of parsed.data.service_ids) {
      const r2 = byId.get(sid)!;
      const price = Number(r2.price);
      const dur = Number(r2.duration_minutes);
      totalPrice += price;
      totalDuration += dur;
      snapshots.push({ service_id: r2.id, name: r2.name ?? "", price, duration_minutes: dur });
    }
    const barberRow = await pool.query(
      "SELECT commission_percentage FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
      [row.barber_id, barbershopId]
    );
    const pct = barberRow.rows[0] ? Number(barberRow.rows[0].commission_percentage) || 0 : 0;
    const commissionAmount = totalPrice * (pct / 100);
    durationMinutes = totalDuration;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM public.appointment_services WHERE appointment_id = $1", [req.params.id]);
      for (let pos = 0; pos < snapshots.length; pos++) {
        const s = snapshots[pos];
        await client.query(
          `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.params.id, s.service_id, s.price, s.duration_minutes, s.name || null, pos]
        );
      }
      await client.query(
        `UPDATE public.appointments SET service_id = $1, duration_minutes = $2, price = $3, commission_amount = $4, updated_at = now() WHERE id = $5 AND barbershop_id = $6`,
        [parsed.data.service_ids[0], totalDuration, totalPrice, commissionAmount, req.params.id, barbershopId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (parsed.data.scheduled_date != null || parsed.data.scheduled_time != null) {
    const date = parsed.data.scheduled_date ?? row.scheduled_date;
    const time = (parsed.data.scheduled_time ?? String(row.scheduled_time).slice(0, 5)).replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
    const conflict = await checkSlotConflict(
      barbershopId,
      row.barber_id,
      String(date),
      time,
      durationMinutes,
      req.params.id
    );
    if (conflict) {
      res.status(409).json({ error: "Horário já ocupado para este barbeiro" });
      return;
    }
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (parsed.data.status !== undefined) {
    updates.push(`status = $${i++}`);
    values.push(parsed.data.status);
  }
  if (parsed.data.scheduled_date !== undefined) {
    updates.push(`scheduled_date = $${i++}::date`);
    values.push(parsed.data.scheduled_date);
  }
  if (parsed.data.scheduled_time !== undefined) {
    const t = parsed.data.scheduled_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
    updates.push(`scheduled_time = $${i++}::time`);
    values.push(t);
  }
  if (parsed.data.notes !== undefined) {
    updates.push(`notes = $${i++}`);
    values.push(parsed.data.notes);
  }
  if (parsed.data.price !== undefined && !parsed.data.service_ids?.length) {
    const price = Number(parsed.data.price);
    const barberRow = await pool.query(
      "SELECT commission_percentage FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
      [row.barber_id, barbershopId]
    );
    const pct = barberRow.rows[0] ? Number(barberRow.rows[0].commission_percentage) || 0 : 0;
    const commissionAmount = (price * pct) / 100;
    updates.push(`price = $${i++}::numeric`, `commission_amount = $${i++}::numeric`);
    values.push(price, commissionAmount);
  }
  if (updates.length > 0) {
    values.push(req.params.id, barbershopId);
    await pool.query(
      `UPDATE public.appointments SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} AND barbershop_id = $${i + 1}`,
      values
    );
  }
  const r = await pool.query(
    `SELECT a.*,
            (SELECT COALESCE(array_agg(aps.service_id ORDER BY aps.position), ARRAY[]::uuid[]) FROM public.appointment_services aps WHERE aps.appointment_id = a.id) AS service_ids,
            (SELECT COALESCE(array_agg(COALESCE(aps.service_name, s2.name) ORDER BY aps.position), ARRAY[]::text[]) FROM public.appointment_services aps LEFT JOIN public.services s2 ON s2.id = aps.service_id WHERE aps.appointment_id = a.id) AS service_names
     FROM public.appointments a WHERE a.id = $1 AND a.barbershop_id = $2`,
    [req.params.id, barbershopId]
  );
  const out = r.rows[0];
  if (out && Array.isArray(out.service_names) && out.service_names.length) {
    out.service_name = out.service_names[0];
  }
  res.json(out ?? existing.rows[0]);
});

appointmentsRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    "UPDATE public.appointments SET status = 'cancelled', updated_at = now() WHERE id = $1 AND barbershop_id = $2 RETURNING id",
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }
  res.json({ id: r.rows[0].id, status: "cancelled" });
});
