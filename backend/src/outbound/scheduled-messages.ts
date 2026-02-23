import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { config } from "../config.js";
import { buildReminder24h, buildFollowUp30d } from "./templates.js";

const REMINDER_HOURS_BEFORE = 24;

export type ScheduleReminderParams = {
  barbershopId: string;
  appointmentId: string;
  publicToken: string;
  clientPhone: string;
  clientName: string | null;
  barberName: string;
  serviceNames: string[];
  scheduledDate: string;
  scheduledTime: string;
  slug: string | null;
  timezone: string;
};

/**
 * Schedules a reminder_24h job for the given appointment.
 * run_after = scheduled moment - 24h (in barbershop timezone), stored as UTC.
 * Dedupe by appointment_id so we don't double-enqueue.
 */
export async function scheduleReminderForAppointment(params: ScheduleReminderParams): Promise<void> {
  const {
    barbershopId,
    appointmentId,
    publicToken,
    clientPhone,
    clientName,
    barberName,
    serviceNames,
    scheduledDate,
    scheduledTime,
    slug,
    timezone,
  } = params;

  const appUrl = (config.appUrl || "").replace(/\/$/, "");
  const bookingLink = slug ? `${appUrl}/b/${slug}` : appUrl || "";
  const rescheduleLink = `${appUrl}/reagendar/${publicToken}`;
  const cancelLink = `${appUrl}/cancelar/${publicToken}`;
  const [year, month, day] = scheduledDate.split("-").map(Number);
  const [h, m] = scheduledTime.slice(0, 5).split(":").map(Number);
  const tz = (timezone && timezone.includes("/")) ? timezone : "America/Sao_Paulo";

  let runAfter: Date;
  try {
    const r = await pool.query<{ run_after: Date }>(
      `SELECT (make_timestamptz($1::int, $2::int, $3::int, $4::int, $5::int, 0, $6::text) - interval '24 hours') AS run_after`,
      [year, month, day, h, m, tz]
    );
    if (!r.rows[0]?.run_after) return;
    runAfter = r.rows[0].run_after;
  } catch {
    return;
  }

  if (runAfter.getTime() <= Date.now()) return;

  const payload = {
    appointment_id: appointmentId,
    client_name: clientName ?? undefined,
    date: scheduledDate,
    time: scheduledTime.slice(0, 5),
    service_names: serviceNames.join(", "),
    barber_name: barberName,
    booking_link: bookingLink,
    reschedule_link: rescheduleLink,
    cancel_link: cancelLink,
  };

  const body = buildReminder24h({
    clientName: clientName ?? undefined,
    date: scheduledDate,
    time: scheduledTime.slice(0, 5),
    serviceNames: serviceNames.join(", "),
    barberName,
    bookingLink: bookingLink || undefined,
    rescheduleLink,
    cancelLink,
  });

  const toPhone = clientPhone.replace(/\D/g, "");
  if (!toPhone) return;

  const dedupeKey = `reminder_24h:${appointmentId}`;

  try {
    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
       VALUES ($1, 'reminder_24h', $2, $3, 'queued', $4, $5, now())`,
      [
        barbershopId,
        toPhone,
        JSON.stringify({ ...payload, body }),
        runAfter,
        dedupeKey,
      ]
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] insert reminder:", e);
  }
}

/**
 * Marks any queued reminder_24h job for this appointment as skipped (cancel/reschedule).
 */
export async function cancelReminderForAppointment(appointmentId: string): Promise<void> {
  const dedupeKey = `reminder_24h:${appointmentId}`;
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'skipped', last_error = 'Agendamento cancelado ou reagendado', updated_at = now()
     WHERE dedupe_key = $1 AND status = 'queued'`,
    [dedupeKey]
  );
}

/**
 * Check if barbershop has Pro or Premium (for reminders/follow-ups).
 */
export async function barbershopHasAutomation(barbershopId: string): Promise<boolean> {
  const r = await pool.query<{ billing_plan: string | null }>(
    `SELECT billing_plan FROM public.barbershops WHERE id = $1`,
    [barbershopId]
  );
  const plan = r.rows[0]?.billing_plan ?? "pro";
  return plan === "pro" || plan === "premium";
}

const FOLLOWUP_30D_SWEEP_ADVISORY_LOCK_ID = 20260222140000;

/**
 * Daily sweep: enqueue followup_30d for clients whose last appointment was 30+ days ago.
 * Dedupe: one per client per month (dedupe_key followup_30d:barbershopId:clientId:YYYY-MM).
 * When client is provided, all queries use it (for use with advisory lock in multi-worker setups).
 */
export async function runDailyFollowUp30dSweep(client?: PoolClient): Promise<void> {
  const q = client ?? pool;
  const r = await q.query<{ id: string }>(
    `SELECT id FROM public.barbershops WHERE billing_plan IN ('pro', 'premium')`
  );
  const appUrl = (config.appUrl || "").replace(/\/$/, "");
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  for (const row of r.rows) {
    const barbershopId = row.id;
    const clients = await q.query<{ client_id: string; phone: string; name: string | null; slug: string | null }>(
      `WITH last_visit AS (
         SELECT a.client_id, MAX(a.scheduled_date) AS last_date
         FROM public.appointments a
         WHERE a.barbershop_id = $1 AND a.status != 'cancelled'
         GROUP BY a.client_id
       )
       SELECT c.id AS client_id, c.phone, c.name, bs.slug
       FROM public.clients c
       JOIN last_visit lv ON lv.client_id = c.id
       JOIN public.barbershops bs ON bs.id = c.barbershop_id
       WHERE c.barbershop_id = $1 AND c.marketing_opt_out = false
         AND lv.last_date <= (CURRENT_DATE - INTERVAL '30 days')`,
      [barbershopId]
    );
    for (const c of clients.rows) {
      const phoneNorm = c.phone.replace(/\D/g, "");
      if (!phoneNorm) continue;
      const bookingLink = c.slug ? `${appUrl}/b/${c.slug}` : appUrl || "";
      const body = buildFollowUp30d({
        clientName: c.name ?? undefined,
        bookingLink,
      });
      const dedupeKey = `followup_30d:${barbershopId}:${c.client_id}:${yearMonth}`;
      const exists = await q.query(
        `SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 LIMIT 1`,
        [dedupeKey]
      );
      if (exists.rows.length > 0) continue;
      try {
        await q.query(
          `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
           VALUES ($1, 'followup_30d', $2, $3, 'queued', now(), $4, now())`,
          [barbershopId, phoneNorm, JSON.stringify({ body, client_id: c.client_id }), dedupeKey]
        );
      } catch (e) {
        if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] followup_30d insert:", e);
      }
    }
  }
}

/** Run the daily follow-up sweep with an advisory lock so only one worker runs it. */
export async function runDailyFollowUp30dSweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [FOLLOWUP_30D_SWEEP_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) {
      return;
    }
    await runDailyFollowUp30dSweep(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [FOLLOWUP_30D_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}
