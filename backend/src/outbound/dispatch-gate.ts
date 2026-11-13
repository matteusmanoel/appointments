import { pool } from "../db.js";
import {
  GATED_SCHEDULED_TYPES,
  decideDispatch,
  type DispatchDecision,
  type DispatchUsage,
} from "./dispatch-policy.js";

export async function barbershopTimezone(barbershopId: string): Promise<string> {
  const r = await pool.query<{ timezone: string | null }>(
    `SELECT timezone FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
    [barbershopId],
  );
  const tz = r.rows[0]?.timezone?.trim();
  return tz && tz.includes("/") ? tz : "America/Sao_Paulo";
}

/** Client dispatches already sent today (barbershop timezone): reminders, plan charges, reactivation,
 *  manual/campaign and automatic waitlist notices. */
export async function loadDispatchUsage(barbershopId: string, timezone: string): Promise<DispatchUsage> {
  const r = await pool.query<{ sent_today: number; last_sent_at: Date | null }>(
    `WITH day AS (
       SELECT (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2) AS start
     ),
     sent AS (
       SELECT m.updated_at AS at
       FROM public.scheduled_messages m, day
       WHERE m.barbershop_id = $1
         AND m.status = 'sent'
         AND m.type = ANY($3::text[])
         AND m.updated_at >= day.start
       UNION ALL
       SELECT a.created_at AS at
       FROM public.agenda_activity a, day
       WHERE a.barbershop_id = $1
         AND a.type = 'waitlist_offered'
         AND a.created_at >= day.start
     )
     SELECT count(*)::int AS sent_today, max(at) AS last_sent_at FROM sent`,
    [barbershopId, timezone, [...GATED_SCHEDULED_TYPES]],
  );
  const row = r.rows[0];
  return {
    sentToday: Number(row?.sent_today ?? 0),
    lastSentAt: row?.last_sent_at ? new Date(row.last_sent_at) : null,
  };
}

export async function checkDispatchGate(barbershopId: string, timezone?: string): Promise<DispatchDecision> {
  const tz = timezone ?? (await barbershopTimezone(barbershopId));
  return decideDispatch(await loadDispatchUsage(barbershopId, tz));
}

/**
 * Namespace for per-barbershop session-level advisory locks.
 * Prevents two concurrent workers from both passing the gate for the same barbershop.
 * Lock is held for the duration of: gate check → WhatsApp send → markSent.
 */
const DISPATCH_LOCK_NS = 20260930;

/** Serializes cap-and-spacing gate decisions per barbershop across multiple workers.
 *  Uses a PostgreSQL session-level advisory lock on a dedicated pool connection. */
export async function withDispatchLock<T>(
  barbershopId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    const hashResult = await client.query<{ h: number }>(
      `SELECT ('x' || substr(md5($1), 1, 8))::bit(32)::int AS h`,
      [barbershopId],
    );
    const h = hashResult.rows[0]?.h ?? 0;
    await client.query("SELECT pg_advisory_lock($1, $2)", [DISPATCH_LOCK_NS, h]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [DISPATCH_LOCK_NS, h]);
    }
  } finally {
    client.release();
  }
}
