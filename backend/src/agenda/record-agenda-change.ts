import { pool } from "../db.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";
import {
  occupancyOpened,
  shouldPingOwner,
  formatOwnerPing,
  type AgendaChangeEvent,
} from "./ping-policy.js";

async function adminPhone(barbershopId: string): Promise<string | null> {
  const r = await pool.query<{ phone: string | null }>(
    `SELECT COALESCE(p.phone, b.phone) AS phone
     FROM public.barbershops b
     LEFT JOIN LATERAL (
       SELECT p2.phone
       FROM public.profiles p2
       WHERE p2.barbershop_id = b.id AND p2.role = 'admin' AND p2.phone IS NOT NULL
       ORDER BY p2.created_at ASC
       LIMIT 1
     ) p ON true
     WHERE b.id = $1`,
    [barbershopId],
  );
  const digits = (r.rows[0]?.phone ?? "").replace(/\D/g, "");
  return digits || null;
}

type WaitlistHit = {
  id: string;
  client_name: string | null;
  client_phone: string;
  desired_date: string;
  desired_time: string;
  notified: boolean;
};

async function notifyWaitlist(event: AgendaChangeEvent): Promise<WaitlistHit | null> {
  if (!event.appointmentId || !occupancyOpened(event.type)) return null;
  const meta = await pool.query<{
    scheduled_date: string;
    scheduled_time: string;
    barber_id: string;
    service_id: string | null;
  }>(
    `SELECT scheduled_date::text, scheduled_time::text, barber_id, service_id
     FROM public.appointments WHERE id = $1 AND barbershop_id = $2`,
    [event.appointmentId, event.barbershopId],
  );
  const rowMeta = meta.rows[0];
  const date = rowMeta?.scheduled_date ?? event.scheduledDate ?? null;
  const time = (rowMeta?.scheduled_time ?? event.scheduledTime ?? "").slice(0, 5);
  const barberId = rowMeta?.barber_id ?? null;
  const serviceId = rowMeta?.service_id ?? null;
  if (!date || !/^\d{2}:\d{2}$/.test(time) || !serviceId) return null;

  const tzRow = await pool.query<{ timezone: string }>(
    `SELECT COALESCE(timezone, 'America/Sao_Paulo') AS timezone
     FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
    [event.barbershopId],
  );
  const tz = tzRow.rows[0]?.timezone || "America/Sao_Paulo";

  const candidate = await pool.query<{
    id: string;
    client_name: string | null;
    client_phone: string;
    desired_time: string;
  }>(
    `UPDATE public.appointment_waitlist
     SET status = 'notified', updated_at = now()
     WHERE id = (
       SELECT w.id
       FROM public.appointment_waitlist w
       WHERE w.barbershop_id = $1
         AND w.status = 'active'
         AND w.desired_date = $2::date
         AND w.desired_time IS NOT NULL
         AND w.desired_time = $3::time
         AND w.service_id = $4::uuid
         AND (w.barber_id IS NULL OR w.barber_id = $5::uuid)
         AND (
           (w.desired_date + w.desired_time) AT TIME ZONE $6
         ) >= (NOW() + interval '20 minutes')
       ORDER BY w.created_at ASC
       LIMIT 1
     )
     RETURNING id, client_name, client_phone, desired_time::text AS desired_time`,
    [event.barbershopId, date, time, serviceId, barberId, tz],
  );
  const row = candidate.rows[0];
  if (!row?.client_phone) return null;
  const session = await getWhatsAppOrNull(event.barbershopId);
  const hhmm = String(row.desired_time ?? time).slice(0, 5);
  const dateIso = String(date).slice(0, 10);
  const dateBr = dateIso.split("-").reverse().join("/");
  const hit: WaitlistHit = {
    id: row.id,
    client_name: row.client_name,
    client_phone: row.client_phone,
    desired_date: dateIso,
    desired_time: hhmm,
    notified: false,
  };
  if (!session) return hit;
  const first = (row.client_name ?? "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `${first}, ` : "";
  try {
    await session.sendText(
      row.client_phone,
      `${greeting}abriu ${hhmm} no dia ${dateBr}. Posso te encaixar? Responde aqui se quiser.`,
    );
    hit.notified = true;
  } catch (e) {
    console.warn("[recordAgendaChange] waitlist notify failed:", e instanceof Error ? e.message : e);
  }
  return hit;
}

async function pingOwnerIfNeeded(event: AgendaChangeEvent): Promise<void> {
  if (!shouldPingOwner(event)) return;
  const to = await adminPhone(event.barbershopId);
  if (!to) return;
  const session = await getWhatsAppOrNull(event.barbershopId);
  if (!session) return;
  try {
    await session.sendText(to, formatOwnerPing(event));
  } catch (e) {
    console.warn("[recordAgendaChange] owner ping failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Single writer for agenda mutations (tools, owner CRUD, public links, system sweeps).
 * Always inserts agenda_activity; waitlist + owner ping follow policy.
 */
export async function recordAgendaChangeFromAppointment(params: {
  barbershopId: string;
  appointmentId: string;
  type: AgendaChangeEvent["type"];
  actor: AgendaChangeEvent["actor"];
  conversationId?: string | null;
  summary?: string | null;
}): Promise<{ waitlistCandidate: WaitlistHit | null }> {
  const r = await pool.query<{
    client_name: string | null;
    client_phone: string | null;
    scheduled_date: string;
    scheduled_time: string;
  }>(
    `SELECT c.name AS client_name, c.phone AS client_phone,
            a.scheduled_date::text, a.scheduled_time::text
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.id = $1 AND a.barbershop_id = $2`,
    [params.appointmentId, params.barbershopId],
  );
  const row = r.rows[0];
  return recordAgendaChange({
    barbershopId: params.barbershopId,
    appointmentId: params.appointmentId,
    conversationId: params.conversationId,
    type: params.type,
    actor: params.actor,
    clientName: row?.client_name,
    clientPhone: row?.client_phone,
    scheduledDate: row?.scheduled_date,
    scheduledTime: row?.scheduled_time,
    summary: params.summary,
  });
}

export async function recordAgendaChange(
  event: AgendaChangeEvent,
): Promise<{ waitlistCandidate: WaitlistHit | null }> {
  try {
    await pool.query(
      `INSERT INTO public.agenda_activity
         (barbershop_id, appointment_id, conversation_id, type, actor, client_name, client_phone, scheduled_date, scheduled_time, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::time, $10)`,
      [
        event.barbershopId,
        event.appointmentId,
        event.conversationId ?? null,
        event.type,
        event.actor,
        event.clientName ?? null,
        event.clientPhone ?? null,
        event.scheduledDate ?? null,
        event.scheduledTime ? String(event.scheduledTime).slice(0, 8) : null,
        event.summary ?? null,
      ],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01") {
      console.warn("[recordAgendaChange] agenda_activity table missing");
      return { waitlistCandidate: null };
    }
    console.warn("[recordAgendaChange] insert failed:", e instanceof Error ? e.message : e);
    return { waitlistCandidate: null };
  }

  let waitlistCandidate: WaitlistHit | null = null;
  try {
    waitlistCandidate = await notifyWaitlist(event);
    if (waitlistCandidate?.notified) {
      await pool.query(
        `INSERT INTO public.agenda_activity
           (barbershop_id, appointment_id, type, actor, client_name, client_phone, scheduled_date, scheduled_time, summary)
         VALUES ($1, $2, 'waitlist_offered', 'system', $3, $4, $5::date, $6::time, 'waitlist_offered')`,
        [
          event.barbershopId,
          event.appointmentId,
          waitlistCandidate.client_name,
          waitlistCandidate.client_phone,
          waitlistCandidate.desired_date,
          waitlistCandidate.desired_time,
        ],
      );
    }
  } catch (err) {
    console.warn("[recordAgendaChange] waitlist:", err instanceof Error ? err.message : err);
  }
  void pingOwnerIfNeeded(event).catch((err) =>
    console.warn("[recordAgendaChange] ping:", err instanceof Error ? err.message : err),
  );
  return { waitlistCandidate };
}

export { shouldPingOwner, formatOwnerPing, occupancyOpened } from "./ping-policy.js";
export type { AgendaChangeEvent, AgendaActivityType, AgendaActor } from "./ping-policy.js";
