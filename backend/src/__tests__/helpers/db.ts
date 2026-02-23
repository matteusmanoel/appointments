import { pool } from "../../db.js";

export type ScheduledMessagesFixture = {
  barbershopId: string;
  aiSettingsTimezone: string;
  clientId: string;
  clientPhone: string;
  barberId: string;
  serviceId: string;
  appointmentId: string;
  publicToken: string;
  scheduledDate: string;
  scheduledTime: string;
};

const SLUG_PREFIX = "test-sched-";

/**
 * Creates minimal fixtures for scheduled-messages tests.
 * Caller must ensure DB is available; cleanup via deleteScheduledMessagesFixtures.
 */
export async function createScheduledMessagesFixtures(
  opts: {
    billingPlan?: "essential" | "pro" | "premium";
    appointmentOffsetDays?: number; // 1 = tomorrow, -31 = 31 days ago
    appointmentTime?: string;
    clientOptOut?: boolean;
  } = {}
): Promise<ScheduledMessagesFixture> {
  const billingPlan = opts.billingPlan ?? "pro";
  const appointmentOffsetDays = opts.appointmentOffsetDays ?? 1;
  const appointmentTime = opts.appointmentTime ?? "14:00";
  const clientOptOut = opts.clientOptOut ?? false;
  const slug = `${SLUG_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const shop = await pool.query<{ id: string }>(
    `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
     VALUES ($1, '5511999990000', $2, $3, '{"monday":{"start":"09:00","end":"19:00"}}'::jsonb)
     RETURNING id`,
    [`Test Sched ${slug}`, billingPlan, slug]
  );
  const barbershopId = shop.rows[0].id;

  await pool.query(
    `INSERT INTO public.barbershop_ai_settings (barbershop_id, timezone)
     VALUES ($1, 'America/Sao_Paulo')
     ON CONFLICT (barbershop_id) DO UPDATE SET timezone = 'America/Sao_Paulo'`,
    [barbershopId]
  );

  const client = await pool.query<{ id: string }>(
    `INSERT INTO public.clients (barbershop_id, name, phone, marketing_opt_out)
     VALUES ($1, 'Cliente Test', $2, $3)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET marketing_opt_out = $3 RETURNING id`,
    [barbershopId, "5511999990001", clientOptOut]
  );
  const clientId = client.rows[0].id;
  const clientPhone = "5511999990001";

  const barber = await pool.query<{ id: string }>(
    `INSERT INTO public.barbers (barbershop_id, name, status)
     VALUES ($1, 'Barbeiro Test', 'active')
     RETURNING id`,
    [barbershopId]
  );
  const barberId = barber.rows[0].id;

  const service = await pool.query<{ id: string }>(
    `INSERT INTO public.services (barbershop_id, name, price, duration_minutes, is_active)
     VALUES ($1, 'Corte Test', 35, 30, true)
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
     VALUES ($1, $2, 35, 30, 'Corte Test', 0)
     ON CONFLICT (appointment_id, position) DO NOTHING`,
    [appointmentId, serviceId]
  );

  return {
    barbershopId,
    aiSettingsTimezone: "America/Sao_Paulo",
    clientId,
    clientPhone,
    barberId,
    serviceId,
    appointmentId,
    publicToken,
    scheduledDate: dateStr,
    scheduledTime: appointmentTime,
  };
}

/**
 * Deletes test barbershops created with createScheduledMessagesFixtures (CASCADE removes related rows).
 */
export async function deleteScheduledMessagesFixtures(barbershopIds: string[]): Promise<void> {
  if (barbershopIds.length === 0) return;
  await pool.query(
    `DELETE FROM public.barbershops WHERE id = ANY($1::uuid[]) AND slug LIKE $2`,
    [barbershopIds, `${SLUG_PREFIX}%`]
  );
}

export async function countScheduledMessagesByDedupe(dedupeKey: string): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT count(*)::text FROM public.scheduled_messages WHERE dedupe_key = $1`,
    [dedupeKey]
  );
  return parseInt(r.rows[0]?.count ?? "0", 10);
}

export async function getScheduledMessageRow(dedupeKey: string): Promise<{ status: string; payload_json: unknown } | null> {
  const r = await pool.query<{ status: string; payload_json: unknown }>(
    `SELECT status, payload_json FROM public.scheduled_messages WHERE dedupe_key = $1 LIMIT 1`,
    [dedupeKey]
  );
  return r.rows[0] ?? null;
}
