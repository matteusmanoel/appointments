import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireToolsKey, getBarbershopId } from "../middleware/auth.js";

async function resolveBarbershopId(req: Request): Promise<string | null> {
  try {
    const id = getBarbershopId(req).trim();
    if (id) return id;
  } catch {
    // fall back to first barbershop only in ambientes single-tenant/seed
  }
  const r = await pool.query("SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1");
  return r.rows[0]?.id ?? null;
}

export const toolsRouter = Router();

toolsRouter.use(requireToolsKey);

toolsRouter.get("/list_services", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await resolveBarbershopId(req);
  if (!barbershopId) {
    res.status(400).json({ error: "barbershop_id required", hint: "Run seed and set BARBERSHOP_ID in .env or add a barbershop in the database" });
    return;
  }
  const r = await pool.query(
    `SELECT id, name, description, price, duration_minutes, category
     FROM public.services WHERE barbershop_id = $1 AND is_active = true ORDER BY name`,
    [barbershopId]
  );
  res.json(r.rows);
});

toolsRouter.get("/list_barbers", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await resolveBarbershopId(req);
  if (!barbershopId) {
    res.status(400).json({ error: "barbershop_id required", hint: "Run seed and set BARBERSHOP_ID in .env or add a barbershop in the database" });
    return;
  }
  const r = await pool.query(
    `SELECT id, name, status, schedule
     FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active', 'break') ORDER BY name`,
    [barbershopId]
  );
  res.json(r.rows);
});

toolsRouter.get("/list_appointments", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await resolveBarbershopId(req);
  const date = req.query.date as string;
  const barber_id = req.query.barber_id as string | undefined;
  if (!barbershopId || !date) {
    res.status(400).json({
      error: !barbershopId ? "barbershop_id required" : "date required",
      hint: !barbershopId ? "Run seed or set BARBERSHOP_ID in .env" : "Use query param date=yyyy-MM-dd",
    });
    return;
  }
  let query = `
    SELECT barber_id, scheduled_time, duration_minutes
    FROM public.appointments
    WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled')
    ORDER BY barber_id, scheduled_time
  `;
  const params: unknown[] = [barbershopId, date];
  if (barber_id) {
    params.push(barber_id);
    query = `
    SELECT barber_id, scheduled_time, duration_minutes
    FROM public.appointments
    WHERE barbershop_id = $1 AND scheduled_date = $2::date AND barber_id = $3 AND status NOT IN ('cancelled')
    ORDER BY scheduled_time
    `;
  }
  const r = await pool.query(query, params);
  res.json(r.rows);
});

const upsertClientBody = z.object({
  barbershop_id: z.string().uuid().optional(),
  phone: z.string().min(1),
  name: z.string().optional(),
  notes: z.string().optional(),
});
toolsRouter.post("/upsert_client", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await resolveBarbershopId(req);
  if (!barbershopId) {
    res.status(400).json({ error: "barbershop_id required", hint: "Run seed and set BARBERSHOP_ID in .env or add a barbershop in the database" });
    return;
  }
  const parsed = upsertClientBody.safeParse({ ...req.body, barbershop_id: barbershopId });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { phone, name, notes } = parsed.data;
  const normalizedPhone = phone.replace(/\D/g, "") || phone;
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
  res.json(r.rows[0]);
});

const createAppointmentBody = z.object({
  barbershop_id: z.string().uuid().optional(),
  client_id: z.string().uuid(),
  barber_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  service_ids: z.array(z.string().uuid()).min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  notes: z.string().optional(),
  client_phone: z.string().optional(),
  client_name: z.string().optional(),
}).refine((d) => (d.service_ids?.length ?? 0) >= 1 || !!d.service_id, { message: "service_id or service_ids required" });
toolsRouter.post("/create_appointment", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await resolveBarbershopId(req);
  if (!barbershopId) {
    res.status(400).json({ error: "barbershop_id required", hint: "Run seed and set BARBERSHOP_ID in .env or add a barbershop in the database" });
    return;
  }
  const parsed = createAppointmentBody.safeParse({ ...req.body, barbershop_id: barbershopId });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { client_id, barber_id, date, time, notes } = parsed.data;
  const serviceIds: string[] = parsed.data.service_ids?.length ? parsed.data.service_ids : parsed.data.service_id ? [parsed.data.service_id] : [];
  if (serviceIds.length === 0) {
    res.status(400).json({ error: "service_id or service_ids (min 1) required" });
    return;
  }
  const timeNorm = time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId]
  );
  type ServiceRow = { id: string; name: string; price: unknown; duration_minutes: unknown };
  const byId = new Map<string, ServiceRow>(serviceRows.rows.map((r: ServiceRow) => [r.id, r]));
  if (byId.size !== serviceIds.length) {
    const missing = serviceIds.filter((id) => !byId.has(id));
    res.status(404).json({ error: "Service(s) not found", ids: missing });
    return;
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
    [barber_id, barbershopId]
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
    [barbershopId, barber_id, date, startMins, endMins]
  );
  if (conflictCheck.rows.length > 0) {
    res.status(409).json({ error: "Horário já ocupado para este barbeiro" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appResult = await client.query(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status, notes)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9, 'pending', $10)
       RETURNING id, scheduled_date, scheduled_time, status`,
      [barbershopId, client_id, barber_id, serviceIds[0], date, timeNorm, totalDuration, totalPrice, commissionAmount, notes ?? null]
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
    res.status(201).json(appointment);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});
