/** Disparo ao cliente: teto diário, intervalo e prioridade (ADR 0003 + ADR 0004). */
export const DAILY_DISPATCH_CAP = 50;
export const DISPATCH_SPACING_MINUTES = 3;

export const DAILY_CAP_REACHED_MESSAGE =
  "Limite de 50 disparos do dia atingido. Fale com o cliente pelo WhatsApp e registre no sistema depois.";

/** Reminder lead time minimum: if less than this many minutes remain before the
 *  appointment when the send window opens, the 2h reminder is suppressed. */
export const REMINDER_2H_MIN_LEAD_MINUTES = 20;

export type DispatchPurpose =
  | "reminder"
  | "waitlist"
  | "plan_billing"
  | "reactivation"
  | "manual"
  | "campaign";

/** Lower value leaves first. */
export const DISPATCH_PRIORITY: Record<DispatchPurpose, number> = {
  reminder: 0,
  waitlist: 1,
  plan_billing: 2,
  reactivation: 3,
  manual: 4,
  campaign: 5,
};

/**
 * scheduled_messages types that count toward the daily cap and wait for the
 * spacing interval. Automatic waitlist notice (record-agenda-change) is NOT
 * here — it bypasses cap and interval (ADR 0004) and is counted separately
 * via agenda_activity type = 'waitlist_offered'.
 */
export const GATED_SCHEDULED_TYPES = [
  "reminder_24h",
  "reminder_2h",
  "plan_billing",
  "reactivation",
  "manual",
  "campaign",
] as const;

export function scheduledTypePurpose(type: string): DispatchPurpose | null {
  if (type === "reminder_24h" || type === "reminder_2h") return "reminder";
  if (type === "plan_billing") return "plan_billing";
  if (type === "reactivation") return "reactivation";
  if (type === "manual") return "manual";
  if (type === "campaign") return "campaign";
  return null;
}

/** Queued types from sweeps that no longer message clients on their own. */
export const RETIRED_AUTOMATIC_TYPES = ["followup_30d", "birthday", "opening_summary", "payment_reminder"] as const;

export function isRetiredAutomaticType(type: string): boolean {
  return (RETIRED_AUTOMATIC_TYPES as readonly string[]).includes(type);
}

export type DispatchUsage = { sentToday: number; lastSentAt: Date | null };

export type DispatchDecision =
  | { kind: "send" }
  | { kind: "wait"; until: Date }
  | { kind: "cap_reached" };

export function decideDispatch(usage: DispatchUsage, now: Date = new Date()): DispatchDecision {
  if (usage.sentToday >= DAILY_DISPATCH_CAP) return { kind: "cap_reached" };
  if (usage.lastSentAt) {
    const until = new Date(usage.lastSentAt.getTime() + DISPATCH_SPACING_MINUTES * 60_000);
    if (until.getTime() > now.getTime()) return { kind: "wait", until };
  }
  return { kind: "send" };
}

export function dispatchWaitMessage(until: Date, timezone: string): string {
  const hm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(until);
  return `Intervalo de ${DISPATCH_SPACING_MINUTES} minutos entre disparos. Próximo envio liberado às ${hm}.`;
}

export type ReminderAppointmentClock = { status: string; date: string; time: string };

export function reminderDedupeKey(type: string, appointmentId: string): string {
  return `${type}:${appointmentId}`;
}

/**
 * Lembrete vigente: the appointment exists, is still active, the reminder carries its current
 * clock, and the row is the one reminder of that type for that appointment.
 * Returns the skip reason, or null when the reminder may go out.
 */
export function reminderNotVigenteReason(params: {
  type: string;
  appointmentId: string | null;
  dedupeKey: string | null;
  payload: { date?: unknown; time?: unknown };
  appointment: ReminderAppointmentClock | null;
}): string | null {
  const { type, appointmentId, dedupeKey, payload, appointment } = params;
  if (!appointmentId) return "Lembrete sem agendamento";
  if (dedupeKey !== reminderDedupeKey(type, appointmentId)) return "Lembrete duplicado para o agendamento";
  if (!appointment) return "Agendamento não existe mais";
  if (appointment.status === "cancelled") return "Agendamento cancelado";
  if (appointment.status !== "pending" && appointment.status !== "confirmed") return "Agendamento não está ativo";
  const payloadDate = typeof payload.date === "string" ? payload.date.slice(0, 10) : "";
  const payloadTime = typeof payload.time === "string" ? payload.time.slice(0, 5) : "";
  if (payloadDate !== appointment.date || payloadTime !== appointment.time) {
    return "Relógio do lembrete não é o do agendamento";
  }
  return null;
}

export type PlanBillingKind = "due" | "day10" | "manual";

export const PLAN_BILLING_OVERDUE_DAYS = 10;

export function isPlanBillingKind(v: unknown): v is PlanBillingKind {
  return v === "due" || v === "day10" || v === "manual";
}

export function planBillingDedupeKey(chargeId: string, kind: PlanBillingKind): string {
  return `plan_billing:${chargeId}:${kind}`;
}

export type PlanBillingChargeState = {
  status: string;
  subscriptionStatus: string;
  autoBilling: boolean;
};

/**
 * Cobrança de plano still due: the month is open, the subscription is active and, for automatic
 * sends, the operator kept the automatic switch on. Returns the skip reason, or null.
 */
export function planBillingNotVigenteReason(params: {
  kind: unknown;
  charge: PlanBillingChargeState | null;
}): string | null {
  const { kind, charge } = params;
  if (!isPlanBillingKind(kind)) return "Cobrança sem tipo de envio";
  if (!charge) return "Cobrança não existe mais";
  if (charge.status === "paid") return "Cobrança já paga";
  if (charge.status !== "pending" && charge.status !== "sent") return "Cobrança cancelada";
  if (charge.subscriptionStatus !== "active") return "Assinatura não está ativa";
  if (kind !== "manual" && !charge.autoBilling) return "Cobrança automática desligada";
  return null;
}
