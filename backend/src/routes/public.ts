import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";

async function getBarbershopIdBySlug(slug: string): Promise<string | null> {
  const r = await pool.query(
    "SELECT id FROM public.barbershops WHERE slug = $1",
    [slug]
  );
  return r.rows[0]?.id ?? null;
}

export const publicRouter = Router();

publicRouter.get("/:slug", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await getBarbershopIdBySlug(req.params.slug);
  if (!barbershopId) {
    res.status(404).json({ error: "Barbearia não encontrada" });
    return;
  }
  const r = await pool.query(
    "SELECT id, name, phone, email, address, business_hours, slug FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  res.json(r.rows[0]);
});

publicRouter.get("/:slug/services", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await getBarbershopIdBySlug(req.params.slug);
  if (!barbershopId) {
    res.status(404).json({ error: "Barbearia não encontrada" });
    return;
  }
  const r = await pool.query(
    `SELECT id, name, description, price, duration_minutes, category
     FROM public.services WHERE barbershop_id = $1 AND is_active = true ORDER BY name`,
    [barbershopId]
  );
  res.json(r.rows);
});

publicRouter.get("/:slug/barbers", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await getBarbershopIdBySlug(req.params.slug);
  if (!barbershopId) {
    res.status(404).json({ error: "Barbearia não encontrada" });
    return;
  }
  const r = await pool.query(
    `SELECT id, name, status
     FROM public.barbers WHERE barbershop_id = $1 AND status IN ('active', 'break') ORDER BY name`,
    [barbershopId]
  );
  res.json(r.rows);
});

publicRouter.get("/:slug/availability", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await getBarbershopIdBySlug(req.params.slug);
  const date = req.query.date as string;
  if (!barbershopId) {
    res.status(404).json({ error: "Barbearia não encontrada" });
    return;
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Query param date (YYYY-MM-DD) is required" });
    return;
  }
  const r = await pool.query(
    `SELECT barber_id, scheduled_time, duration_minutes
     FROM public.appointments
     WHERE barbershop_id = $1 AND scheduled_date = $2::date AND status NOT IN ('cancelled')
     ORDER BY barber_id, scheduled_time`,
    [barbershopId, date]
  );
  res.json(r.rows);
});

const createAppointmentBody = z.object({
  service_id: z.string().uuid().optional(),
  service_ids: z.array(z.string().uuid()).min(1).optional(),
  barber_id: z.string().uuid(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  client_name: z.string().min(1),
  client_phone: z.string().min(1),
  notes: z.string().optional(),
}).refine((d) => (d.service_ids?.length ?? 0) >= 1 || !!d.service_id, { message: "service_id or service_ids required" });

publicRouter.post("/:slug/appointments", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await getBarbershopIdBySlug(req.params.slug);
  if (!barbershopId) {
    res.status(404).json({ error: "Barbearia não encontrada" });
    return;
  }
  const parsed = createAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { barber_id, scheduled_date, scheduled_time, client_name, client_phone, notes } = parsed.data;
  const serviceIds: string[] = parsed.data.service_ids?.length ? parsed.data.service_ids : parsed.data.service_id ? [parsed.data.service_id] : [];
  if (serviceIds.length === 0) {
    res.status(400).json({ error: "service_id or service_ids (min 1) required" });
    return;
  }
  const normalizedPhone = client_phone.replace(/\D/g, "") || client_phone;

  const clientResult = await pool.query(
    `INSERT INTO public.clients (barbershop_id, name, phone, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, clients.name),
       updated_at = now()
     RETURNING id`,
    [barbershopId, client_name, normalizedPhone, notes ?? null]
  );
  const client_id = clientResult.rows[0].id;

  const serviceRows = await pool.query(
    "SELECT id, name, price, duration_minutes FROM public.services WHERE id = ANY($1::uuid[]) AND barbershop_id = $2",
    [serviceIds, barbershopId]
  );
  type ServiceRow = { id: string; name: string; price: unknown; duration_minutes: unknown };
  const byId = new Map<string, ServiceRow>(serviceRows.rows.map((r: ServiceRow) => [r.id, r]));
  if (byId.size !== serviceIds.length) {
    res.status(404).json({ error: "Serviço não encontrado" });
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
  if (barberRow.rows.length === 0) {
    res.status(404).json({ error: "Barbeiro não encontrado" });
    return;
  }
  const timeNorm = scheduled_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  const barberPct = barberRow.rows[0]?.commission_percentage ?? 40;
  const commissionAmount = totalPrice * (barberPct / 100);
  const startMins = parseInt(timeNorm.slice(0, 2), 10) * 60 + parseInt(timeNorm.slice(3, 5), 10);
  const endMins = startMins + totalDuration;
  const conflictCheck = await pool.query(
    `SELECT 1 FROM public.appointments
     WHERE barbershop_id = $1 AND barber_id = $2 AND scheduled_date = $3::date AND status NOT IN ('cancelled')
     AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int + duration_minutes > $4
     AND (EXTRACT(EPOCH FROM scheduled_time) / 60)::int < $5`,
    [barbershopId, barber_id, scheduled_date, startMins, endMins]
  );
  if (conflictCheck.rows.length > 0) {
    res.status(409).json({ error: "Horário já ocupado para este barbeiro" });
    return;
  }
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const appResult = await conn.query(
      `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status, notes)
       VALUES ($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9, 'pending', $10)
       RETURNING id, scheduled_date, scheduled_time, status`,
      [barbershopId, client_id, barber_id, serviceIds[0], scheduled_date, timeNorm, totalDuration, totalPrice, commissionAmount, notes ?? null]
    );
    const appointment = appResult.rows[0];
    for (let pos = 0; pos < snapshots.length; pos++) {
      const s = snapshots[pos];
      await conn.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [appointment.id, s.service_id, s.price, s.duration_minutes, s.name || null, pos]
      );
    }
    await conn.query("COMMIT");
    res.status(201).json(appointment);
  } catch (e) {
    await conn.query("ROLLBACK");
    throw e;
  } finally {
    conn.release();
  }
});
