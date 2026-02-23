import { pool } from "../../db.js";

const SLUG_PREFIX = "test-public-";

export type PublicRoutesFixture = {
  barbershopId: string;
  barberId: string;
  appointmentId: string;
  publicToken: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
};

const defaultBusinessHours = {
  monday: { start: "09:00", end: "18:00" },
  tuesday: { start: "09:00", end: "18:00" },
  wednesday: { start: "09:00", end: "18:00" },
  thursday: { start: "09:00", end: "18:00" },
  friday: { start: "09:00", end: "18:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

const defaultBarberSchedule = {
  monday: { start: "09:00", end: "18:00" },
  tuesday: { start: "09:00", end: "18:00" },
  wednesday: { start: "09:00", end: "18:00" },
  thursday: { start: "09:00", end: "18:00" },
  friday: { start: "09:00", end: "18:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

/**
 * Creates fixtures for public cancel/reschedule tests.
 * appointmentOffsetDays: 1 = tomorrow, -1 = yesterday.
 * Optionally add a closure for a given date (closed or open_partial).
 */
export async function createPublicRoutesFixtures(opts: {
  appointmentOffsetDays?: number;
  appointmentTime?: string;
  closureDate?: string; // yyyy-MM-dd
  closureStatus?: "closed" | "open_partial";
  closureStart?: string;
  closureEnd?: string;
} = {}): Promise<PublicRoutesFixture> {
  const appointmentOffsetDays = opts.appointmentOffsetDays ?? 1;
  const appointmentTime = opts.appointmentTime ?? "14:00";
  const slug = `${SLUG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, '5511999990000', 'pro', $2, $3::jsonb)
     RETURNING id`,
    [`Test Public ${slug}`, slug, JSON.stringify(defaultBusinessHours)]
  );
  const barbershopId = shop.rows[0].id;

  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, timezone)
     VALUES ($1, 'America/Sao_Paulo')
     ON CONFLICT (barbershop_id) DO UPDATE SET timezone = 'America/Sao_Paulo'`,
    [barbershopId]
  );

  if (opts.closureDate && opts.closureStatus) {
    await pool.query(
      `INSERT INTO public.barbershop_closures (barbershop_id, closure_date, status, start_time, end_time)
       VALUES ($1, $2::date, $3, $4::time, $5::time)
       ON CONFLICT (barbershop_id, closure_date) DO UPDATE SET status = $3, start_time = $4::time, end_time = $5::time`,
      [
        barbershopId,
        opts.closureDate,
        opts.closureStatus,
        opts.closureStart ?? "09:00",
        opts.closureEnd ?? "18:00",
      ]
    );
  }

  const client = await pool.query<{ id: string }>(
    `INSERT INTO public.clients (barbershop_id, name, phone)
     VALUES ($1, 'Cliente Public Test', '5511999990002')
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = 'Cliente Public Test' RETURNING id`,
    [barbershopId]
  );
  const clientId = client.rows[0].id;

  const barber = await pool.query<{ id: string }>(
    `INSERT INTO public.barbers (barbershop_id, name, status, schedule)
     VALUES ($1, 'Barbeiro Public Test', 'active', $2::jsonb)
     RETURNING id`,
    [barbershopId, JSON.stringify(defaultBarberSchedule)]
  );
  const barberId = barber.rows[0].id;

  const service = await pool.query<{ id: string }>(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
     VALUES ($1, 'Corte Public Test', 35, 30, true)
     RETURNING id`,
    [barbershopId]
  );
  const serviceId = service.rows[0].id;

  const scheduledDate = await pool.query<{ d: string }>(
    `SELECT (CURRENT_DATE + $1::int)::text AS d`,
    [appointmentOffsetDays]
  );
  const dateStr = scheduledDate.rows[0].d;

  const app = await pool.query<{ id: string; public_token: string }>(
    `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, $6::time, 30, 35, 14, 'pending')
     RETURNING id, public_token`,
    [barbershopId, clientId, barberId, serviceId, dateStr, appointmentTime]
  );
  const appointmentId = app.rows[0].id;
  const publicToken = app.rows[0].public_token;

  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 35, 30, 'Corte Public Test', 0)
     ON CONFLICT (appointment_id, position) DO NOTHING`,
    [appointmentId, serviceId]
  );

  return {
    barbershopId,
    barberId,
    appointmentId,
    publicToken,
    scheduledDate: dateStr,
    scheduledTime: appointmentTime,
    durationMinutes: 30,
  };
}

export async function deletePublicRoutesFixtures(barbershopIds: string[]): Promise<void> {
  if (barbershopIds.length === 0) return;
  await pool.query(
    `DELETE FROM public.barbershops WHERE id = ANY($1::uuid[]) AND slug LIKE $2`,
    [barbershopIds, `${SLUG_PREFIX}%`]
  );
}
