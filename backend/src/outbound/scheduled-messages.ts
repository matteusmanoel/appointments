import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { config } from "../config.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";
import { setPaymentPendingFlag } from "../ai/memory/client-memory.js";
import {
  buildBirthdayMessage,
  buildFollowUp30d,
  buildFollowUpFirstVisit,
  buildOpeningSummary,
  buildPaymentReminder,
  buildPlanPaymentMessage,
  buildReminder24h,
  buildReminder2h,
} from "./templates.js";

const REMINDER_HOURS_BEFORE = 24;
const REMINDER_2H_HOURS_BEFORE = 2;

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
      `SELECT (make_timestamptz($1::int, $2::int, $3::int, $4::int, $5::int, 0, $6::text) - ($7::int || ' hours')::interval) AS run_after`,
      [year, month, day, h, m, tz, REMINDER_HOURS_BEFORE]
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

export async function scheduleReminder2hForAppointment(params: ScheduleReminderParams): Promise<void> {
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
      `SELECT (make_timestamptz($1::int, $2::int, $3::int, $4::int, $5::int, 0, $6::text) - ($7::int || ' hours')::interval) AS run_after`,
      [year, month, day, h, m, tz, REMINDER_2H_HOURS_BEFORE]
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

  const body = buildReminder2h({
    clientName: clientName ?? undefined,
    date: scheduledDate,
    time: scheduledTime.slice(0, 5),
    serviceNames: serviceNames.join(", "),
    barberName,
  });

  const toPhone = clientPhone.replace(/\D/g, "");
  if (!toPhone) return;

  const dedupeKey = `reminder_2h:${appointmentId}`;

  try {
    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
       VALUES ($1, 'reminder_2h', $2, $3, 'queued', $4, $5, now())`,
      [
        barbershopId,
        toPhone,
        JSON.stringify({ ...payload, body }),
        runAfter,
        dedupeKey,
      ]
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] insert reminder_2h:", e);
  }
}

/**
 * Marks any queued reminder_24h job for this appointment as skipped (cancel/reschedule).
 */
export async function cancelReminderForAppointment(appointmentId: string): Promise<void> {
  const dedupe24h = `reminder_24h:${appointmentId}`;
  const dedupe2h = `reminder_2h:${appointmentId}`;
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'skipped', last_error = 'Agendamento cancelado ou reagendado', updated_at = now()
     WHERE dedupe_key IN ($1, $2) AND status = 'queued'`,
    [dedupe24h, dedupe2h]
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
const FOLLOWUP_NO_APPOINTMENT_SWEEP_ADVISORY_LOCK_ID = 20260401121000;
const BIRTHDAY_SWEEP_ADVISORY_LOCK_ID = 20260401122000;
const OPENING_SUMMARY_SWEEP_ADVISORY_LOCK_ID = 20260401123000;
const PLAN_BILLING_SWEEP_ADVISORY_LOCK_ID = 20260406160001;
const NO_SHOW_SWEEP_ADVISORY_LOCK_ID = 20260919120000;

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

export async function runDailyFollowUpNoAppointmentSweep(client?: PoolClient): Promise<void> {
  const q = client ?? pool;
  const r = await q.query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM public.barbershops WHERE billing_plan IN ('pro', 'premium')`
  );
  const appUrl = (config.appUrl || "").replace(/\/$/, "");
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  for (const row of r.rows) {
    const barbershopId = row.id;
    const candidates = await q.query<{ to_phone: string; name: string | null }>(
      `SELECT ac.external_thread_id AS to_phone,
              MAX(c.name) AS name
       FROM public.ai_conversations ac
       LEFT JOIN public.clients c
         ON c.barbershop_id = ac.barbershop_id
        AND regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(ac.external_thread_id, '[^0-9]', '', 'g')
       WHERE ac.barbershop_id = $1
         AND ac.channel = 'whatsapp'
         AND ac.last_message_at <= (now() - interval '30 days')
         AND NOT EXISTS (
           SELECT 1
           FROM public.appointments a
           JOIN public.clients cx ON cx.id = a.client_id
           WHERE a.barbershop_id = $1
             AND a.status != 'cancelled'
             AND a.scheduled_date > (CURRENT_DATE - INTERVAL '30 days')
             AND regexp_replace(cx.phone, '[^0-9]', '', 'g') = regexp_replace(ac.external_thread_id, '[^0-9]', '', 'g')
         )
       GROUP BY ac.external_thread_id`
      ,
      [barbershopId]
    );

    for (const c of candidates.rows) {
      const phoneNorm = c.to_phone.replace(/\D/g, "");
      if (!phoneNorm) continue;
      const bookingLink = row.slug ? `${appUrl}/b/${row.slug}` : appUrl || "";
      const body = buildFollowUpFirstVisit({
        clientName: c.name ?? undefined,
        bookingLink,
      });
      const dedupeKey = `followup_30d:first_visit:${barbershopId}:${phoneNorm}:${yearMonth}`;
      const exists = await q.query(
        `SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 LIMIT 1`,
        [dedupeKey]
      );
      if (exists.rows.length > 0) continue;
      try {
        await q.query(
          `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
           VALUES ($1, 'followup_30d', $2, $3, 'queued', now(), $4, now())`,
          [barbershopId, phoneNorm, JSON.stringify({ body }), dedupeKey]
        );
      } catch (e) {
        if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] followup_30d first_visit insert:", e);
      }
    }
  }
}

export async function runBirthdaySweep(client?: PoolClient): Promise<void> {
  const q = client ?? pool;
  const rows = await q.query<{
    barbershop_id: string;
    slug: string | null;
    client_id: string;
    client_name: string | null;
    client_phone: string;
    timezone: string | null;
  }>(
    `SELECT c.barbershop_id, bs.slug, c.id AS client_id, c.name AS client_name, c.phone AS client_phone, ais.timezone
     FROM public.clients c
     JOIN public.barbershops bs ON bs.id = c.barbershop_id
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = c.barbershop_id
     WHERE c.birth_date IS NOT NULL
       AND c.marketing_opt_out = false
       AND EXTRACT(MONTH FROM c.birth_date) = EXTRACT(MONTH FROM (now() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo')))
       AND EXTRACT(DAY FROM c.birth_date) = EXTRACT(DAY FROM (now() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo')))
       AND EXISTS (
         SELECT 1 FROM public.barbershops bx
         WHERE bx.id = c.barbershop_id
           AND bx.billing_plan IN ('pro', 'premium')
       )`
  );
  const appUrl = (config.appUrl || "").replace(/\/$/, "");
  const now = new Date();
  const year = String(now.getUTCFullYear());

  for (const row of rows.rows) {
    const toPhone = row.client_phone.replace(/\D/g, "");
    if (!toPhone) continue;
    const bookingLink = row.slug ? `${appUrl}/b/${row.slug}` : appUrl || "";
    const body = buildBirthdayMessage({
      clientName: row.client_name ?? undefined,
      bookingLink,
    });
    const dedupeKey = `birthday:${row.barbershop_id}:${row.client_id}:${year}`;
    const exists = await q.query(`SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 LIMIT 1`, [dedupeKey]);
    if (exists.rows.length > 0) continue;
    try {
      await q.query(
        `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
         VALUES ($1, 'birthday', $2, $3, 'queued', now(), $4, now())`,
        [row.barbershop_id, toPhone, JSON.stringify({ body }), dedupeKey]
      );
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] birthday insert:", e);
    }
  }
}

export async function runDailyOpeningSummarySweep(client?: PoolClient): Promise<void> {
  const q = client ?? pool;
  const shops = await q.query<{
    barbershop_id: string;
    barbershop_name: string;
    timezone: string | null;
    admin_phone: string | null;
  }>(
    `SELECT b.id AS barbershop_id,
            b.name AS barbershop_name,
            ais.timezone,
            p.phone AS admin_phone
     FROM public.barbershops b
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = b.id
     LEFT JOIN LATERAL (
       SELECT p2.phone
       FROM public.profiles p2
       WHERE p2.barbershop_id = b.id AND p2.role = 'admin' AND p2.phone IS NOT NULL
       ORDER BY p2.created_at ASC
       LIMIT 1
     ) p ON true
     WHERE b.billing_plan IN ('pro', 'premium')`
  );

  for (const shop of shops.rows) {
    const toPhone = (shop.admin_phone ?? "").replace(/\D/g, "");
    if (!toPhone) continue;
    const tz = shop.timezone && shop.timezone.includes("/") ? shop.timezone : "America/Sao_Paulo";
    const dateRow = await q.query<{ today_str: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS today_str`,
      [tz]
    );
    const todayStr = dateRow.rows[0]?.today_str;
    if (!todayStr) continue;

    const appointments = await q.query<{ time: string; client_name: string; service_name: string }>(
      `SELECT to_char(a.scheduled_time, 'HH24:MI') AS time,
              COALESCE(c.name, 'Cliente') AS client_name,
              COALESCE(
                (SELECT string_agg(COALESCE(aps.service_name, s.name), ', ' ORDER BY aps.position)
                 FROM public.appointment_services aps
                 LEFT JOIN public.services s ON s.id = aps.service_id
                 WHERE aps.appointment_id = a.id),
                s0.name,
                'Servico'
              ) AS service_name
       FROM public.appointments a
       JOIN public.clients c ON c.id = a.client_id
       LEFT JOIN public.services s0 ON s0.id = a.service_id
       WHERE a.barbershop_id = $1
         AND a.scheduled_date = $2::date
         AND a.status NOT IN ('cancelled', 'no_show')
       ORDER BY a.scheduled_time`,
      [shop.barbershop_id, todayStr]
    );
    if (appointments.rows.length === 0) continue;
    const body = buildOpeningSummary({
      barbershopName: shop.barbershop_name,
      date: todayStr,
      appointments: appointments.rows.map((a) => ({
        time: a.time,
        clientName: a.client_name,
        serviceName: a.service_name,
      })),
    });
    const dedupeKey = `opening_summary:${shop.barbershop_id}:${todayStr}`;
    const exists = await q.query(`SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 LIMIT 1`, [dedupeKey]);
    if (exists.rows.length > 0) continue;
    const runAfterRow = await q.query<{ run_after: Date }>(
      `SELECT (
        make_timestamptz(
          EXTRACT(year FROM (now() AT TIME ZONE $1))::int,
          EXTRACT(month FROM (now() AT TIME ZONE $1))::int,
          EXTRACT(day FROM (now() AT TIME ZONE $1))::int,
          8, 30, 0, $1
        )
      ) AS run_after`,
      [tz]
    );
    const runAfter = runAfterRow.rows[0]?.run_after ?? new Date();
    try {
      await q.query(
        `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
         VALUES ($1, 'opening_summary', $2, $3, 'queued', $4, $5, now())`,
        [shop.barbershop_id, toPhone, JSON.stringify({ body }), runAfter, dedupeKey]
      );
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] opening_summary insert:", e);
    }
  }
}

export async function schedulePaymentReminder(params: {
  barbershopId: string;
  toPhone: string;
  barbershopName: string;
  portalLink: string;
}): Promise<void> {
  const toPhone = params.toPhone.replace(/\D/g, "");
  if (!toPhone) return;
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const dedupeKey = `payment_reminder:${params.barbershopId}:${yearMonth}`;
  const body = buildPaymentReminder({ barbershopName: params.barbershopName, portalLink: params.portalLink });
  try {
    await pool.query(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
       VALUES ($1, 'payment_reminder', $2, $3, 'queued', (now() + interval '3 days'), $4, now())`,
      [params.barbershopId, toPhone, JSON.stringify({ body }), dedupeKey]
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") console.error("[scheduled-messages] payment_reminder insert:", e);
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

export async function runDailyFollowUpNoAppointmentSweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [FOLLOWUP_NO_APPOINTMENT_SWEEP_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runDailyFollowUpNoAppointmentSweep(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [FOLLOWUP_NO_APPOINTMENT_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}

export async function runBirthdaySweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [BIRTHDAY_SWEEP_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runBirthdaySweep(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [BIRTHDAY_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}

export async function runDailyOpeningSummarySweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [OPENING_SUMMARY_SWEEP_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runDailyOpeningSummarySweep(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [OPENING_SUMMARY_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}

// ─── Plan billing sweep ───────────────────────────────────────────────────────

export async function runDailyPlanBillingSweep(): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  let subs: Array<{
    id: string;
    barbershop_id: string;
    client_name: string | null;
    client_phone: string;
    plan_name: string;
    price: string;
    billing_cycle: string;
    billing_day: number;
    next_billing_date: string;
    pix_key: string | null;
    barbershop_name: string;
    barbershop_address: string | null;
    timezone: string;
  }>;

  try {
    const r = await pool.query(
      `SELECT s.id, s.barbershop_id, s.billing_day, s.next_billing_date,
              c.name AS client_name, c.phone AS client_phone,
              p.name AS plan_name, p.price, p.billing_cycle,
              b.pix_key, b.name AS barbershop_name, b.address AS barbershop_address,
              COALESCE(ais.timezone, 'America/Sao_Paulo') AS timezone
       FROM public.client_plan_subscriptions s
       JOIN public.clients c ON c.id = s.client_id
       JOIN public.barbershop_plans p ON p.id = s.plan_id
       JOIN public.barbershops b ON b.id = s.barbershop_id
       LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = s.barbershop_id
       WHERE s.status = 'active' AND s.next_billing_date = $1::date`,
      [todayStr]
    );
    subs = r.rows;
  } catch (e) {
    console.error("[plan-billing-sweep] query error:", e);
    return;
  }

  for (const sub of subs) {
    try {
      const amount = Number(sub.price);
      const city = (sub.barbershop_address ?? "").split(",").pop()?.trim() || "Brasil";

      if (!sub.pix_key) {
        console.warn("[plan-billing-sweep] barbershop %s has no pix_key — skipping sub %s", sub.barbershop_id, sub.id);
        continue;
      }

      const session = await getWhatsAppOrNull(sub.barbershop_id);
      if (!session) {
        console.warn("[plan-billing-sweep] no whatsapp session for barbershop %s — skipping sub %s", sub.barbershop_id, sub.id);
        continue;
      }

      const clientPhone = sub.client_phone.replace(/\D/g, "");

      const textMsg = buildPlanPaymentMessage({
        clientName: sub.client_name ?? undefined,
        planName: sub.plan_name,
        amount,
        dueDate: sub.next_billing_date,
        billingDay: sub.billing_day,
      });

      await session.sendText(clientPhone, textMsg);
      await session.sendPixRequest?.({
        to: clientPhone,
        amount,
        description: `Plano ${sub.plan_name} — NavalhIA`,
        pixKey: sub.pix_key,
        name: sub.barbershop_name,
        city,
      });

      const chargeInsert = await pool.query<{ id: string }>(
        `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status, sent_at)
         VALUES ($1, $2, $3::numeric, $4::date, 'sent', now())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [sub.id, sub.barbershop_id, sub.price, sub.next_billing_date]
      );

      let nextDate: Date;
      const [y, m, d] = sub.next_billing_date.split("-").map(Number);
      nextDate = new Date(y!, m! - 1, d!);
      if (sub.billing_cycle === "monthly") {
        nextDate.setMonth(nextDate.getMonth() + 1);
      } else if (sub.billing_cycle === "quarterly") {
        nextDate.setMonth(nextDate.getMonth() + 3);
      } else {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      }
      const nextStr = nextDate.toISOString().slice(0, 10);

      await pool.query(
        `UPDATE public.client_plan_subscriptions SET next_billing_date = $1, updated_at = now() WHERE id = $2`,
        [nextStr, sub.id]
      );

      console.info(
        "[plan-billing-sweep] sent sub=%s barbershop=%s amount=%.2f charge=%s next=%s",
        sub.id, sub.barbershop_id, amount, chargeInsert.rows[0]?.id ?? "dup", nextStr
      );
      void setPaymentPendingFlag(sub.barbershop_id, sub.client_phone, amount).catch(() => {});
    } catch (e) {
      console.error("[plan-billing-sweep] error sub=%s:", sub.id, e);
    }
  }
}

export async function runDailyPlanBillingSweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [PLAN_BILLING_SWEEP_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runDailyPlanBillingSweep();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PLAN_BILLING_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}

// ─── Overdue plan billing reminders (day +5 and +10) ─────────────────────────

const OVERDUE_BILLING_REMINDER_ADVISORY_LOCK_ID = 20260923120001;

/**
 * Sends a reminder message on day +5 and day +10 after the original charge due_date
 * for subscriptions that still haven't paid (charge status = 'sent').
 * Records the reminder with status 'overdue_1' or 'overdue_2' to avoid duplicates.
 */
export async function runOverduePlanBillingReminderSweep(): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);

  type OverdueRow = {
    charge_id: string;
    subscription_id: string;
    barbershop_id: string;
    client_name: string | null;
    client_phone: string;
    plan_name: string;
    amount: string;
    due_date: string;
    pix_key: string | null;
    barbershop_name: string;
    barbershop_address: string | null;
    overdue_day: number;
  };

  let rows: OverdueRow[];
  try {
    const r = await pool.query<OverdueRow>(
      `SELECT
         ch.id           AS charge_id,
         ch.subscription_id,
         ch.barbershop_id,
         c.name          AS client_name,
         c.phone         AS client_phone,
         p.name          AS plan_name,
         ch.amount::text AS amount,
         ch.due_date::text AS due_date,
         b.pix_key,
         b.name          AS barbershop_name,
         b.address       AS barbershop_address,
         (current_date - ch.due_date::date) AS overdue_day
       FROM public.plan_pix_charges ch
       JOIN public.client_plan_subscriptions s ON s.id = ch.subscription_id
       JOIN public.clients c ON c.id = s.client_id
       JOIN public.barbershop_plans p ON p.id = s.plan_id
       JOIN public.barbershops b ON b.id = ch.barbershop_id
       WHERE ch.status = 'sent'
         AND (current_date - ch.due_date::date) IN (5, 10)
         AND NOT EXISTS (
           SELECT 1 FROM public.plan_pix_charges dup
           WHERE dup.subscription_id = ch.subscription_id
             AND dup.due_date = ch.due_date
             AND dup.status = CASE
               WHEN (current_date - ch.due_date::date) = 5 THEN 'overdue_1'
               ELSE 'overdue_2'
             END
         )`,
      []
    );
    rows = r.rows;
  } catch (e) {
    console.error("[overdue-billing-sweep] query error:", e);
    return;
  }

  for (const row of rows) {
    try {
      const overdueStatus = row.overdue_day === 5 ? "overdue_1" : "overdue_2";
      const amount = Number(row.amount);
      const city = (row.barbershop_address ?? "").split(",").pop()?.trim() || "Brasil";

      if (!row.pix_key) {
        console.warn("[overdue-billing-sweep] barbershop %s has no pix_key — skipping charge %s", row.barbershop_id, row.charge_id);
        continue;
      }

      const session = await getWhatsAppOrNull(row.barbershop_id);
      if (!session) {
        console.warn("[overdue-billing-sweep] no whatsapp session for barbershop %s — skipping charge %s", row.barbershop_id, row.charge_id);
        continue;
      }

      const clientPhone = row.client_phone.replace(/\D/g, "");

      const textMsg = buildPlanPaymentMessage({
        clientName: row.client_name ?? undefined,
        planName: row.plan_name,
        amount,
        dueDate: row.due_date,
        billingDay: new Date(row.due_date + "T00:00:00").getDate(),
        overdueDays: row.overdue_day,
      });

      await session.sendText(clientPhone, textMsg);
      await session.sendPixRequest?.({
        to: clientPhone,
        amount,
        description: `Plano ${row.plan_name} — NavalhIA (atraso)`,
        pixKey: row.pix_key,
        name: row.barbershop_name,
        city,
      });

      await pool.query(
        `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status, sent_at)
         VALUES ($1, $2, $3::numeric, $4::date, $5, now())
         ON CONFLICT DO NOTHING`,
        [row.subscription_id, row.barbershop_id, row.amount, row.due_date, overdueStatus]
      );

      console.info(
        "[overdue-billing-sweep] sent %s sub=%s barbershop=%s amount=%.2f",
        overdueStatus, row.subscription_id, row.barbershop_id, amount
      );
      void setPaymentPendingFlag(row.barbershop_id, row.client_phone, amount).catch(() => {});
    } catch (e) {
      console.error("[overdue-billing-sweep] error charge=%s:", row.charge_id, e);
    }
  }
}

export async function runOverduePlanBillingReminderSweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [OVERDUE_BILLING_REMINDER_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runOverduePlanBillingReminderSweep();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [OVERDUE_BILLING_REMINDER_ADVISORY_LOCK_ID]);
    client.release();
  }
}

/**
 * After the scheduled time, pending/confirmed appointments that were not completed
 * become no_show. The slot is already past — occupancyOpened notifies waitlist.
 */
export async function runNoShowSweep(): Promise<void> {
  const { recordAgendaChangeFromAppointment } = await import("../agenda/record-agenda-change.js");
  const due = await pool.query<{ id: string; barbershop_id: string }>(
    `SELECT a.id, a.barbershop_id
     FROM public.appointments a
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = a.barbershop_id
     WHERE a.status IN ('pending', 'confirmed')
       AND ((a.scheduled_date::date + a.scheduled_time::time)
            AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))
           < now() - interval '15 minutes'`
  );
  for (const row of due.rows) {
    const upd = await pool.query(
      `UPDATE public.appointments SET status = 'no_show', updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'confirmed')
       RETURNING id`,
      [row.id]
    );
    if ((upd.rowCount ?? 0) === 0) continue;
    await recordAgendaChangeFromAppointment({
      barbershopId: row.barbershop_id,
      appointmentId: row.id,
      type: "no_show",
      actor: "system",
    });
  }
}

export async function runNoShowSweepWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [NO_SHOW_SWEEP_ADVISORY_LOCK_ID]
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runNoShowSweep();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [NO_SHOW_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}
