import { pool } from "../db.js";
import { barbershopTimezone } from "./dispatch-gate.js";
import { buildBirthdayMessage, buildFollowUp30d, withOptOutLine } from "./templates.js";

export const REACTIVATION_VISIT_MILESTONES = [15, 30, 45, 60] as const;
export const REACTIVATION_REMOVED_REASON = "Reativação retirada pelo operador";

export type ReactivationReason =
  | "waitlist_missed"
  | "no_visit"
  | "birthday"
  | "talked_without_booking";

export type ReactivationSuggestion = {
  clientId: string;
  name: string | null;
  phone: string;
  reason: ReactivationReason;
  detail: string;
};

export type QueuedReactivation = {
  id: string;
  clientId: string | null;
  name: string | null;
  phone: string | null;
  reason: string;
  runAfter: Date;
};

const REASONS = new Set<string>(["waitlist_missed", "no_visit", "birthday", "talked_without_booking"]);

function asReason(value: string): ReactivationReason {
  return REASONS.has(value) ? (value as ReactivationReason) : "talked_without_booking";
}

/**
 * One row per client. First reason that fits wins:
 * waitlist clock already past, visit milestone, birthday today, conversation without a booking.
 * Opt-out and anyone with a reactivation row this month stay out.
 */
export async function listReactivationSuggestions(
  barbershopId: string,
  windowDays?: number | null,
): Promise<ReactivationSuggestion[]> {
  const tz = await barbershopTimezone(barbershopId);
  const visitDays =
    windowDays != null && Number.isInteger(windowDays) ? [windowDays] : [...REACTIVATION_VISIT_MILESTONES];
  const r = await pool.query<{
    id: string;
    name: string | null;
    phone: string;
    reason: string;
    detail: string;
  }>(
    `WITH today AS (
       SELECT (now() AT TIME ZONE $2)::date AS d
     ),
     base AS (
       SELECT c.id, c.name, c.phone, c.birth_date,
              regexp_replace(c.phone, '[^0-9]', '', 'g') AS digits
       FROM public.clients c
       CROSS JOIN today t
       WHERE c.barbershop_id = $1
         AND c.marketing_opt_out = false
         AND NOT EXISTS (
           SELECT 1 FROM public.scheduled_messages m
           WHERE m.barbershop_id = c.barbershop_id
             AND m.dedupe_key = 'reactivation:' || c.id::text || ':' || to_char(t.d, 'YYYY-MM')
         )
     ),
     last_visit AS (
       SELECT a.client_id, max(a.scheduled_date) AS d
       FROM public.appointments a
       WHERE a.barbershop_id = $1 AND a.status <> 'cancelled'
       GROUP BY a.client_id
     ),
     last_talk AS (
       SELECT ac.external_thread_id AS digits, max(ac.last_message_at) AS at
       FROM public.ai_conversations ac
       WHERE ac.barbershop_id = $1 AND ac.last_message_at IS NOT NULL
       GROUP BY ac.external_thread_id
     ),
     candidates AS (
       SELECT b.id, b.name, b.phone, 'waitlist_missed'::text AS reason, ''::text AS detail, 1 AS prio
       FROM base b
       CROSS JOIN today t
       WHERE EXISTS (
         SELECT 1 FROM public.appointment_waitlist w
         WHERE w.barbershop_id = $1
           AND w.status IN ('active', 'notified')
           AND w.desired_time IS NOT NULL
           AND regexp_replace(w.client_phone, '[^0-9]', '', 'g') = b.digits
           AND ((w.desired_date + w.desired_time) AT TIME ZONE $2) < now()
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.appointments a
         WHERE a.barbershop_id = $1
           AND a.client_id = b.id
           AND a.status <> 'cancelled'
           AND ((a.scheduled_date + a.scheduled_time) AT TIME ZONE $2) > now() - interval '48 hours'
       )

       UNION ALL

       SELECT b.id, b.name, b.phone, 'no_visit', v.days::text, 2
       FROM base b
       CROSS JOIN today t
       JOIN last_visit lv ON lv.client_id = b.id
       JOIN unnest($3::int[]) AS v(days) ON lv.d = t.d - v.days

       UNION ALL

       SELECT b.id, b.name, b.phone, 'birthday', '', 3
       FROM base b
       CROSS JOIN today t
       WHERE b.birth_date IS NOT NULL
         AND EXTRACT(MONTH FROM b.birth_date) = EXTRACT(MONTH FROM t.d)
         AND EXTRACT(DAY FROM b.birth_date) = EXTRACT(DAY FROM t.d)

       UNION ALL

       SELECT b.id, b.name, b.phone, 'talked_without_booking', '', 4
       FROM base b
       CROSS JOIN today t
       JOIN last_talk lt ON lt.digits = b.digits
       WHERE (lt.at AT TIME ZONE $2)::date <= t.d - 30
         AND NOT EXISTS (
           SELECT 1 FROM public.appointments a
           WHERE a.barbershop_id = $1
             AND a.client_id = b.id
             AND a.status <> 'cancelled'
             AND a.scheduled_date >= (lt.at AT TIME ZONE $2)::date
         )
     )
     SELECT DISTINCT ON (id) id, name, phone, reason, detail
     FROM candidates
     ORDER BY id, prio`,
    [barbershopId, tz, visitDays],
  );
  return r.rows
    .map((row) => ({
      clientId: row.id,
      name: row.name,
      phone: row.phone,
      reason: asReason(row.reason),
      detail: row.detail ?? "",
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "pt-BR"));
}

/** Queues the chosen clients for 09:00 tomorrow in the shop timezone. One send per person per month.
 *  `bodyOverride` is stored in the payload and used instead of the standard birthday text
 *  when the operator enqueues a birthday batch with a custom message. */
export async function enqueueReactivation(
  barbershopId: string,
  clientIds: string[],
  bodyOverride?: string,
): Promise<{ queued: number; runAfter: Date | null }> {
  const tz = await barbershopTimezone(barbershopId);
  const clock = await pool.query<{ run_after: Date }>(
    `SELECT (((now() AT TIME ZONE $1)::date + 1) + time '09:00') AT TIME ZONE $1 AS run_after`,
    [tz],
  );
  const runAfter = clock.rows[0]?.run_after ?? null;
  const unique = [...new Set(clientIds)];
  if (unique.length === 0) return { queued: 0, runAfter };

  const suggestions = await listReactivationSuggestions(barbershopId);
  const allowed = new Map(suggestions.map((s) => [s.clientId, s.reason]));
  const picked = unique.filter((id) => allowed.has(id));
  if (picked.length === 0) return { queued: 0, runAfter };

  const trimmedOverride = (bodyOverride ?? "").trim() || null;

  const inserted = await pool.query(
    `WITH clock AS (
       SELECT
         (((now() AT TIME ZONE $2)::date + 1) + time '09:00') AT TIME ZONE $2 AS run_after,
         to_char((now() AT TIME ZONE $2)::date, 'YYYY-MM') AS month
     )
     INSERT INTO public.scheduled_messages
       (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key)
     SELECT $1, 'reactivation', c.phone,
            jsonb_build_object('client_id', c.id, 'reason', p.reason, 'body_override', $5::text),
            'queued', clock.run_after,
            'reactivation:' || c.id::text || ':' || clock.month
     FROM unnest($3::uuid[], $4::text[]) AS p(id, reason)
     JOIN public.clients c ON c.id = p.id AND c.barbershop_id = $1
     CROSS JOIN clock
     WHERE NOT EXISTS (
       SELECT 1 FROM public.scheduled_messages m
       WHERE m.dedupe_key = 'reactivation:' || c.id::text || ':' || clock.month
     )
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'queued' DO NOTHING
     RETURNING id`,
    [barbershopId, tz, picked, picked.map((id) => allowed.get(id)!), trimmedOverride],
  );
  return { queued: inserted.rowCount ?? 0, runAfter };
}

export async function listQueuedReactivation(barbershopId: string): Promise<QueuedReactivation[]> {
  const r = await pool.query<{
    id: string;
    client_id: string | null;
    name: string | null;
    phone: string | null;
    reason: string | null;
    run_after: Date;
  }>(
    `SELECT m.id,
            m.payload_json->>'client_id' AS client_id,
            c.name,
            COALESCE(c.phone, m.to_phone) AS phone,
            m.payload_json->>'reason' AS reason,
            m.run_after
     FROM public.scheduled_messages m
     LEFT JOIN public.clients c
       ON c.id = NULLIF(m.payload_json->>'client_id', '')::uuid
      AND c.barbershop_id = m.barbershop_id
     WHERE m.barbershop_id = $1 AND m.type = 'reactivation' AND m.status = 'queued'
     ORDER BY m.run_after, c.name`,
    [barbershopId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    phone: row.phone,
    reason: row.reason ?? "",
    runAfter: row.run_after,
  }));
}

export async function cancelQueuedReactivation(barbershopId: string, messageId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE public.scheduled_messages
     SET status = 'skipped', last_error = $3, updated_at = now()
     WHERE id = $1 AND barbershop_id = $2 AND type = 'reactivation' AND status = 'queued'`,
    [messageId, barbershopId, REACTIVATION_REMOVED_REASON],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Birthday uses the birthday text (or bodyOverride when the operator provided a custom text).
 *  The other reasons keep the follow-up text. */
export function reactivationMessage(v: {
  reason: string;
  clientName: string | null;
  bookingLink: string;
  bodyOverride?: string | null;
}): string {
  if (v.reason === "birthday") {
    const custom = (v.bodyOverride ?? "").trim();
    // Texto próprio do dono não passa por template: a instrução PARAR é acrescentada no envio (lp-correcoes §16.6, N-02).
    if (custom) return withOptOutLine(custom);
    return buildBirthdayMessage({ clientName: v.clientName ?? undefined, bookingLink: v.bookingLink });
  }
  return buildFollowUp30d({ clientName: v.clientName ?? undefined, bookingLink: v.bookingLink });
}
