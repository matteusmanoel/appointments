import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";
import { brPhonesMatch } from "../lib/phone-match.js";
import { recordAgendaChange } from "../agenda/record-agenda-change.js";
import {
  closingMinutesForDay,
  composeManualWaitlistMessage,
  computeDispatchDeadline,
} from "../agenda/waitlist-dispatch.js";

export const waitlistRouter = Router();
waitlistRouter.use(requireJwt);

waitlistRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT w.id, w.client_name, w.client_phone,
            w.desired_date::text AS desired_date,
            w.desired_time::text AS desired_time,
            w.service_id, w.barber_id, w.status, w.notes, w.created_at,
            s.name AS service_name, s.duration_minutes,
            b.name AS barber_name
     FROM public.appointment_waitlist w
     LEFT JOIN public.services s ON s.id = w.service_id
     LEFT JOIN public.barbers b ON b.id = w.barber_id
     WHERE w.barbershop_id = $1 AND w.status IN ('active', 'notified')
     ORDER BY w.desired_date ASC, w.desired_time ASC NULLS LAST, w.created_at ASC`,
    [barbershopId],
  );
  res.json(
    r.rows.map((row) => ({
      ...row,
      desired_time: row.desired_time ? String(row.desired_time).slice(0, 5) : null,
      duration_minutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    })),
  );
});

const dispatchBody = z.object({
  barber_id: z.string().uuid(),
});

waitlistRouter.post("/:id/dispatch", async (req: Request, res: Response): Promise<void> => {
  const parsed = dispatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "barber_id inválido" });
    return;
  }
  const barbershopId = getBarbershopId(req);
  const entry = await pool.query<{
    id: string;
    client_name: string | null;
    client_phone: string;
    desired_date: string;
    desired_time: string | null;
    duration_minutes: number | null;
    status: string;
  }>(
    `SELECT w.id, w.client_name, w.client_phone,
            w.desired_date::text AS desired_date,
            w.desired_time::text AS desired_time,
            s.duration_minutes,
            w.status
     FROM public.appointment_waitlist w
     LEFT JOIN public.services s ON s.id = w.service_id
     WHERE w.id = $1 AND w.barbershop_id = $2 AND w.status IN ('active', 'notified')`,
    [req.params.id, barbershopId],
  );
  const row = entry.rows[0];
  if (!row) {
    res.status(404).json({ error: "Entrada da fila não encontrada" });
    return;
  }
  const duration = Number(row.duration_minutes);
  if (!Number.isFinite(duration) || duration <= 0) {
    res.status(400).json({ error: "Serviço da fila sem duração" });
    return;
  }

  const barber = await pool.query<{
    id: string;
    name: string;
    schedule: unknown;
    status: string;
  }>(
    `SELECT id, name, schedule, status
     FROM public.barbers
     WHERE id = $1 AND barbershop_id = $2 AND status = 'active'`,
    [parsed.data.barber_id, barbershopId],
  );
  const chosen = barber.rows[0];
  if (!chosen) {
    res.status(400).json({ error: "Barbeiro indisponível" });
    return;
  }

  const shop = await pool.query<{ business_hours: unknown; timezone: string }>(
    `SELECT b.business_hours,
            COALESCE(s.timezone, 'America/Sao_Paulo') AS timezone
     FROM public.barbershops b
     LEFT JOIN public.barbershop_ai_settings s ON s.barbershop_id = b.id
     WHERE b.id = $1`,
    [barbershopId],
  );
  const tz = shop.rows[0]?.timezone || "America/Sao_Paulo";
  const nowRow = await pool.query<{ today: string; now_hm: string }>(
    `SELECT (NOW() AT TIME ZONE $1)::date::text AS today,
            to_char(NOW() AT TIME ZONE $1, 'HH24:MI') AS now_hm`,
    [tz],
  );
  const today = String(nowRow.rows[0]?.today ?? "").slice(0, 10);
  const nowHm = String(nowRow.rows[0]?.now_hm ?? "00:00").slice(0, 5);
  const nowMins = Number(nowHm.slice(0, 2)) * 60 + Number(nowHm.slice(3, 5));

  const next = await pool.query<{ scheduled_time: string; client_phone: string }>(
    `SELECT a.scheduled_time::text AS scheduled_time,
            regexp_replace(c.phone, '[^0-9]', '', 'g') AS client_phone
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1
       AND a.barber_id = $2
       AND a.scheduled_date = $3::date
       AND a.status NOT IN ('cancelled', 'no_show')
       AND a.scheduled_time > $4::time
     ORDER BY a.scheduled_time ASC
     LIMIT 1`,
    [barbershopId, chosen.id, today, nowHm],
  );
  const nextAppt = next.rows[0];
  const nextMins = nextAppt
    ? Number(String(nextAppt.scheduled_time).slice(0, 2)) * 60 +
      Number(String(nextAppt.scheduled_time).slice(3, 5))
    : null;
  const sameClient = nextAppt
    ? brPhonesMatch(row.client_phone, nextAppt.client_phone)
    : false;
  const deadlineHm = computeDispatchDeadline({
    nowMins,
    durationMinutes: duration,
    nextAppointmentMins: nextMins,
    nextAppointmentIsWaitlistedClient: sameClient,
    closingMins: closingMinutesForDay({
      dateIso: today,
      businessHours: shop.rows[0]?.business_hours,
      barberSchedule: chosen.schedule,
    }),
  });

  const text = composeManualWaitlistMessage({
    clientName: row.client_name,
    barberName: chosen.name,
    deadlineHm,
  });
  const session = await getWhatsAppOrNull(barbershopId);
  if (!session) {
    res.status(409).json({ error: "WhatsApp não conectado" });
    return;
  }
  try {
    await session.sendText(row.client_phone, text);
  } catch (e) {
    console.warn("[waitlist] dispatch failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "Não foi possível enviar a mensagem" });
    return;
  }

  await pool.query(
    `UPDATE public.appointment_waitlist
     SET status = 'notified', updated_at = now()
     WHERE id = $1 AND barbershop_id = $2`,
    [row.id, barbershopId],
  );
  await recordAgendaChange({
    barbershopId,
    appointmentId: null,
    type: "waitlist_offered",
    actor: "owner",
    clientName: row.client_name,
    clientPhone: row.client_phone,
    scheduledDate: today,
    scheduledTime: deadlineHm ?? (row.desired_time ? String(row.desired_time).slice(0, 5) : null),
    summary: "waitlist_manual",
  });

  res.json({ ok: true, message: text, next_slot_in_use: deadlineHm });
});
