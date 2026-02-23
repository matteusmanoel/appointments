/**
 * Deterministic templates for reminders and follow-ups (no LLM).
 * Variables: clientName, date, time, serviceNames, barberName, bookingLink, rescheduleLink, cancelLink.
 */

export type ReminderVars = {
  clientName?: string;
  date: string;
  time: string;
  serviceNames?: string;
  barberName?: string;
  bookingLink?: string;
  rescheduleLink?: string;
  cancelLink?: string;
};

export function buildReminder24h(v: ReminderVars): string {
  const name = v.clientName ? ` ${v.clientName},` : "";
  const service = v.serviceNames ? ` (${v.serviceNames})` : "";
  const barber = v.barberName ? ` com ${v.barberName}` : "";
  let msg = `Oi${name} lembrete: você tem agendamento${service} no dia ${v.date} às ${v.time}${barber}.`;
  if (v.rescheduleLink || v.cancelLink) {
    msg += " Precisa reagendar ou cancelar? ";
    if (v.rescheduleLink) msg += `Reagendar: ${v.rescheduleLink}. `;
    if (v.cancelLink) msg += `Cancelar: ${v.cancelLink}.`;
  } else if (v.bookingLink) {
    msg += ` Reagendar pelo link: ${v.bookingLink}`;
  }
  msg += " Até lá!";
  return msg.trim();
}

export type FollowUp30dVars = {
  clientName?: string;
  bookingLink: string;
};

export function buildFollowUp30d(v: FollowUp30dVars): string {
  const name = v.clientName ? ` ${v.clientName},` : "";
  return `Oi${name} faz um tempo que a gente não se vê! Que tal marcar um horário? Agenda aqui: ${v.bookingLink} 🙂`.trim();
}
