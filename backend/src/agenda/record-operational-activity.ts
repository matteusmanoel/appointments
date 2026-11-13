import { pool } from "../db.js";
import { recordAgendaChange } from "./record-agenda-change.js";
import type { AgendaActivityType } from "./ping-policy.js";

export type OperationalActivityType = Extract<
  AgendaActivityType,
  "send_failure" | "agent_silenced" | "agent_stuck" | "tool_error_escalated" | "payment_sent" | "payment_failed" | "plan_requested"
>;

/**
 * Operational events (failures, silences, charges) for the owner's agenda feed.
 * Deduped per type + conversation/appointment/phone so sweeps that retry every cycle
 * and looping conversations do not flood the feed. Never throws.
 */
export async function recordOperationalActivity(params: {
  barbershopId: string;
  type: OperationalActivityType;
  summary: string;
  conversationId?: string | null;
  appointmentId?: string | null;
  clientPhone?: string | null;
  clientName?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  dedupeMinutes?: number;
}): Promise<void> {
  try {
    const dedupeMinutes = params.dedupeMinutes ?? 30;
    const phoneDigits = (params.clientPhone ?? "").replace(/\D/g, "") || null;
    const recent = await pool.query(
      `SELECT 1 FROM public.agenda_activity
       WHERE barbershop_id = $1
         AND type = $2
         AND created_at > now() - make_interval(mins => $3::int)
         AND (
           ($4::uuid IS NOT NULL AND conversation_id = $4::uuid)
           OR ($5::uuid IS NOT NULL AND appointment_id = $5::uuid)
           OR ($4::uuid IS NULL AND $5::uuid IS NULL AND $6::text IS NOT NULL
               AND regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g') = $6::text)
         )
       LIMIT 1`,
      [
        params.barbershopId,
        params.type,
        dedupeMinutes,
        params.conversationId ?? null,
        params.appointmentId ?? null,
        phoneDigits,
      ],
    );
    if (recent.rows.length) return;
    await recordAgendaChange({
      barbershopId: params.barbershopId,
      appointmentId: params.appointmentId ?? null,
      conversationId: params.conversationId ?? null,
      type: params.type,
      actor: "system",
      clientPhone: params.clientPhone ?? null,
      clientName: params.clientName ?? null,
      scheduledDate: params.scheduledDate ?? null,
      scheduledTime: params.scheduledTime ?? null,
      summary: params.summary,
    });
  } catch (e) {
    console.warn("[recordOperationalActivity] failed:", e instanceof Error ? e.message : e);
  }
}
