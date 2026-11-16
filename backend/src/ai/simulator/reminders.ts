/**
 * Roda o envio de lembrete 24h no simulador, com o mesmo texto do job real,
 * pelo provider noop. Não enfileira scheduled_messages nem envia WhatsApp.
 */
import { pool } from "../../db.js";
import { assertLocalDatabaseUrl } from "../../db/local-database-url.js";
import { brPhoneMatchKeys, canonicalizeBrPhoneDigits } from "../../lib/phone-match.js";
import {
  createNoopWhatsAppSession,
  useNoopWhatsAppOutbound,
} from "../../integrations/whatsapp/noop-outbound.js";
import { recordAgendaChange } from "../../agenda/record-agenda-change.js";
import { loadReminderAppointment } from "../../outbound/scheduled-messages.js";
import { resolveReminderSendBody } from "../../outbound/templates.js";
import { wallClockFrom, parseSimulatedNow } from "./clock.js";

export type SimulatorReminderDelivery = {
  appointmentId: string;
  body: string;
  type: "reminder_24h";
};

const DEFAULT_TZ = "America/Sao_Paulo";

async function shopTimezone(barbershopId: string): Promise<string> {
  const r = await pool.query<{ timezone: string | null }>(
    `SELECT timezone FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
    [barbershopId],
  );
  const tz = r.rows[0]?.timezone?.trim();
  return tz && tz.includes("/") ? tz : DEFAULT_TZ;
}

/**
 * Agendamentos deste cliente sandbox cujo lembrete 24h já venceu no relógio
 * informado e ainda não foi registrado em agenda_activity.
 */
export async function listDueSimulatorReminders(params: {
  barbershopId: string;
  phone: string;
  now: Date;
}): Promise<Array<{ id: string; scheduledDate: string; scheduledTime: string; clientName: string | null; clientPhone: string | null }>> {
  const digits = canonicalizeBrPhoneDigits(params.phone) ?? params.phone.replace(/\D/g, "");
  const keys = brPhoneMatchKeys(digits);
  const tz = await shopTimezone(params.barbershopId);
  const r = await pool.query<{
    id: string;
    scheduled_date: string;
    scheduled_time: string;
    client_name: string | null;
    client_phone: string | null;
  }>(
    `SELECT a.id,
            a.scheduled_date::text AS scheduled_date,
            a.scheduled_time::text AS scheduled_time,
            c.name AS client_name,
            c.phone AS client_phone
     FROM public.appointments a
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1
       AND a.status IN ('pending', 'confirmed')
       AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY($2::text[])
       AND ((a.scheduled_date::text || ' ' || substring(a.scheduled_time::text, 1, 5))::timestamp AT TIME ZONE $3) > $4::timestamptz
       AND ((a.scheduled_date::text || ' ' || substring(a.scheduled_time::text, 1, 5))::timestamp AT TIME ZONE $3 - interval '24 hours') <= $4::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM public.agenda_activity act
         WHERE act.appointment_id = a.id AND act.type = 'reminder_sent'
       )
     ORDER BY a.scheduled_date, a.scheduled_time`,
    [params.barbershopId, keys, tz, params.now],
  );
  return r.rows.map((row) => ({
    id: row.id,
    scheduledDate: String(row.scheduled_date ?? "").slice(0, 10),
    scheduledTime: String(row.scheduled_time ?? "").slice(0, 5),
    clientName: row.client_name,
    clientPhone: row.client_phone,
  }));
}

export async function runSimulatorReminders(params: {
  barbershopId: string;
  conversationId: string;
  phone: string;
  now?: string | Date | null;
}): Promise<SimulatorReminderDelivery[]> {
  assertLocalDatabaseUrl();
  useNoopWhatsAppOutbound();
  const now = parseSimulatedNow(params.now ?? undefined) ?? new Date();
  const due = await listDueSimulatorReminders({
    barbershopId: params.barbershopId,
    phone: params.phone,
    now,
  });
  const tz = await shopTimezone(params.barbershopId);
  const todayIso = wallClockFrom(now, tz).todayStr;
  const session = createNoopWhatsAppSession();
  const delivered: SimulatorReminderDelivery[] = [];

  for (const row of due) {
    const appt = await loadReminderAppointment(row.id);
    if (!appt || appt.status === "cancelled") continue;
    const body = resolveReminderSendBody({
      type: "reminder_24h",
      storedBody: "",
      todayIso,
      appointment: appt,
    });
    if (!body) continue;
    await session.sendText(params.phone, body);
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [params.conversationId, body],
    );
    await recordAgendaChange({
      barbershopId: params.barbershopId,
      appointmentId: row.id,
      conversationId: params.conversationId,
      type: "reminder_sent",
      actor: "system",
      clientPhone: row.clientPhone ?? params.phone,
      clientName: row.clientName,
      scheduledDate: row.scheduledDate,
      scheduledTime: row.scheduledTime,
      summary: "reminder_24h",
    });
    delivered.push({ appointmentId: row.id, body, type: "reminder_24h" });
  }

  return delivered;
}

export const NO_DUE_REMINDER_NOTICE =
  "Nenhum lembrete 24h devido neste relógio para o cliente do simulador.";
