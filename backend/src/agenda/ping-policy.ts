export type AgendaActivityType =
  | "appointment_created"
  | "rescheduled"
  | "cancelled"
  | "confirmed"
  | "reminder_sent"
  | "waitlist_offered"
  | "no_show"
  | "payment_recognized"
  | "conversation_started";

export type AgendaActor = "ai" | "owner" | "client_link" | "system";

export type AgendaChangeEvent = {
  barbershopId: string;
  appointmentId: string | null;
  conversationId?: string | null;
  type: AgendaActivityType;
  actor: AgendaActor;
  clientName?: string | null;
  clientPhone?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  summary?: string | null;
};

/** Occupancy-changing events that are not the owner editing the panel. */
export function shouldPingOwner(event: Pick<AgendaChangeEvent, "type" | "actor">): boolean {
  if (event.actor === "owner") return false;
  if (event.type === "appointment_created" && event.actor === "ai") return true;
  if (
    (event.type === "cancelled" || event.type === "rescheduled") &&
    (event.actor === "ai" || event.actor === "client_link")
  ) {
    return true;
  }
  return false;
}

export function occupancyOpened(type: AgendaActivityType): boolean {
  return type === "cancelled" || type === "rescheduled" || type === "no_show";
}

export function formatOwnerPing(event: AgendaChangeEvent): string {
  const who = event.clientName?.trim() || "Cliente";
  const time = event.scheduledTime ? String(event.scheduledTime).slice(0, 5) : "";
  const date = event.scheduledDate ? String(event.scheduledDate).slice(0, 10) : "";
  const when = [date, time].filter(Boolean).join(" ");
  if (event.type === "appointment_created") {
    return `Agenda: ${who} agendou${when ? ` ${when}` : ""}.`;
  }
  if (event.type === "cancelled") {
    return `Agenda: ${who} cancelou${when ? ` ${when}` : ""} — slot livre.`;
  }
  if (event.type === "rescheduled") {
    return `Agenda: ${who} reagendou${when ? ` para ${when}` : ""}.`;
  }
  return event.summary?.trim() || `Agenda: ${who} — ${event.type}.`;
}
