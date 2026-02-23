import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { validateSlotForPublicReschedule } from "../ai/tools.js";
import { barbershopHasAutomation, cancelReminderForAppointment, scheduleReminderForAppointment } from "../outbound/scheduled-messages.js";

const RESCHEDULE_CUTOFF_MINUTES = 120;

async function getBarbershopIdBySlug(slug: string): Promise<string | null> {
  const r = await pool.query(
    "SELECT id FROM public.barbershops WHERE slug = $1",
    [slug]
  );
  return r.rows[0]?.id ?? null;
}

export const publicRouter = Router();

const rescheduleBody = z.object({
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduled_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  barber_id: z.string().uuid().optional(),
});

async function getAppointmentByToken(token: string): Promise<{
  id: string;
  barbershop_id: string;
  barber_id: string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  status: string;
  barbershop_name: string;
  slug: string | null;
  service_names: string;
} | null> {
  const r = await pool.query<{
    id: string;
    barbershop_id: string;
    barber_id: string;
    scheduled_date: string;
    scheduled_time: string;
    duration_minutes: number;
    status: string;
    barbershop_name: string;
    slug: string | null;
    service_names: string;
  }>(
    `SELECT a.id, a.barbershop_id, a.barber_id, a.scheduled_date::text, a.scheduled_time::text, a.duration_minutes, a.status,
            bs.name AS barbershop_name, bs.slug,
            (SELECT string_agg(aps.service_name, ', ' ORDER BY aps.position) FROM public.appointment_services aps WHERE aps.appointment_id = a.id) AS service_names
     FROM public.appointments a
     JOIN public.barbershops bs ON bs.id = a.barbershop_id
     WHERE a.public_token = $1 AND a.status NOT IN ('cancelled')`,
    [token]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...row,
    scheduled_date: String(row.scheduled_date),
    scheduled_time: String(row.scheduled_time).slice(0, 5),
    service_names: row.service_names ?? "",
  };
}

publicRouter.get("/appointments/:token", async (req: Request, res: Response): Promise<void> => {
  const appointment = await getAppointmentByToken(req.params.token);
  if (!appointment) {
    res.status(404).json({ error: "Agendamento não encontrado ou já cancelado" });
    return;
  }
  res.json(appointment);
});

async function getAppointmentStartUtc(appointmentId: string): Promise<Date | null> {
  const r = await pool.query<{ start_utc: Date }>(
    `SELECT ((a.scheduled_date::date + a.scheduled_time::time) AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::timestamptz AS start_utc
     FROM public.appointments a
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = a.barbershop_id
     WHERE a.id = $1`,
    [appointmentId]
  );
  return r.rows[0]?.start_utc ?? null;
}

publicRouter.post("/appointments/:token/cancel", async (req: Request, res: Response): Promise<void> => {
  const appointment = await getAppointmentByToken(req.params.token);
  if (!appointment) {
    res.status(404).json({ error: "Agendamento não encontrado ou já cancelado" });
    return;
  }
  const startUtc = await getAppointmentStartUtc(appointment.id);
  if (startUtc) {
    const now = Date.now();
    if (startUtc.getTime() <= now) {
      res.status(400).json({ error: "Não é possível cancelar agendamento que já passou" });
      return;
    }
    if (startUtc.getTime() - now < RESCHEDULE_CUTOFF_MINUTES * 60 * 1000) {
      res.status(400).json({ error: "Só é possível cancelar até 2 horas antes do horário" });
      return;
    }
  }
  await pool.query(
    `UPDATE public.appointments SET status = 'cancelled', updated_at = now() WHERE id = $1`,
    [appointment.id]
  );
  await cancelReminderForAppointment(appointment.id);
  res.status(200).json({ ok: true, message: "Agendamento cancelado" });
});

publicRouter.post("/appointments/:token/reschedule", async (req: Request, res: Response): Promise<void> => {
  const appointment = await getAppointmentByToken(req.params.token);
  if (!appointment) {
    res.status(404).json({ error: "Agendamento não encontrado ou já cancelado" });
    return;
  }
  const startUtc = await getAppointmentStartUtc(appointment.id);
  if (startUtc) {
    const now = Date.now();
    if (startUtc.getTime() <= now) {
      res.status(400).json({ error: "Não é possível reagendar agendamento que já passou" });
      return;
    }
    if (startUtc.getTime() - now < RESCHEDULE_CUTOFF_MINUTES * 60 * 1000) {
      res.status(400).json({ error: "Só é possível reagendar até 2 horas antes do horário" });
      return;
    }
  }
  const parsed = rescheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
    return;
  }
  const { scheduled_date, scheduled_time, barber_id } = parsed.data;
  const timeNorm = scheduled_time.replace(/^(\d{2}):(\d{2})(:\d{2})?$/, "$1:$2");
  const barbershopId = appointment.barbershop_id;
  const barberId = barber_id ?? appointment.barber_id;
  if (!barberId) {
    res.status(400).json({ error: "Barbeiro não encontrado" });
    return;
  }
  const validation = await validateSlotForPublicReschedule(barbershopId, {
    date: scheduled_date,
    time: timeNorm,
    duration_minutes: appointment.duration_minutes,
    barber_id: barberId,
    excludeAppointmentId: appointment.id,
  });
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  await cancelReminderForAppointment(appointment.id);
  await pool.query(
    `UPDATE public.appointments SET scheduled_date = $1::date, scheduled_time = $2::time, barber_id = $4, updated_at = now() WHERE id = $3`,
    [scheduled_date, timeNorm, appointment.id, barberId]
  );
  const updated = await getAppointmentByToken(req.params.token);
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
        if (!row) return;
        return pool
          .query<{ name: string }>(
            `SELECT s.name FROM public.appointment_services aps JOIN public.services s ON s.id = aps.service_id WHERE aps.appointment_id = $1 ORDER BY aps.position`,
            [appointment.id]
          )
          .then((sr) =>
            scheduleReminderForAppointment({
              barbershopId,
              appointmentId: appointment.id,
              publicToken: row.public_token,
              clientPhone: row.client_phone,
              clientName: row.client_name,
              barberName: row.barber_name,
              serviceNames: sr.rows.map((x) => x.name),
              scheduledDate: scheduled_date,
              scheduledTime: timeNorm,
              slug: row.slug,
              timezone: row.timezone,
            })
          );
      });
  }).catch(() => {});
  res.status(200).json(updated ?? { ok: true });
});

publicRouter.get("/:slug", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = await getBarbershopIdBySlug(req.params.slug);
  if (!barbershopId) {
    res.status(404).json({ error: "NavalhIA não encontrada" });
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
    res.status(404).json({ error: "NavalhIA não encontrada" });
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
    res.status(404).json({ error: "NavalhIA não encontrada" });
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
    res.status(404).json({ error: "NavalhIA não encontrada" });
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
    res.status(404).json({ error: "NavalhIA não encontrada" });
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
       RETURNING id, scheduled_date, scheduled_time, status, public_token`,
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

    const slug = req.params.slug;
    const serviceNamesArr = snapshots.map((s) => s.name);
    const publicToken = appointment.public_token;
    barbershopHasAutomation(barbershopId).then((has) => {
      if (!has || !publicToken) return;
      return pool
        .query<{ barber_name: string; timezone: string }>(
          `SELECT b.name AS barber_name, COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone
           FROM public.barbers b
           LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = b.barbershop_id
           WHERE b.id = $1 AND b.barbershop_id = $2`,
          [barber_id, barbershopId]
        )
        .then((r) => {
          const row = r.rows[0];
          if (!row) return;
          return scheduleReminderForAppointment({
            barbershopId,
            appointmentId: appointment.id,
            publicToken,
            clientPhone: normalizedPhone,
            clientName: client_name || null,
            barberName: row.barber_name,
            serviceNames: serviceNamesArr,
            scheduledDate: scheduled_date,
            scheduledTime: timeNorm,
            slug,
            timezone: row.timezone,
          });
        });
    }).catch(() => {});
  } catch (e) {
    await conn.query("ROLLBACK");
    throw e;
  } finally {
    conn.release();
  }
});
