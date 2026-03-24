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

/** Formata YYYY-MM-DD para DD/MM/YYYY. */
function formatDateBr(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return d && m && y ? `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}` : isoDate;
}

/** Primeiro nome para saudação (ex.: "Mateus Ferreira" → "Mateus"). */
function firstName(fullName: string | undefined): string {
  if (!fullName?.trim()) return "";
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export function buildReminder24h(v: ReminderVars): string {
  const first = firstName(v.clientName);
  const greeting = first ? `Fala, ${first}!` : "Fala!";
  const dateBr = formatDateBr(v.date);

  const lines: string[] = [
    `${greeting} Só passando pra lembrar do seu agendamento:`,
    "",
    v.serviceNames ? `- Serviços: ${v.serviceNames}` : null,
    `- Data: ${dateBr} às ${v.time}`,
    v.barberName ? `- Barbeiro: ${v.barberName}` : null,
  ].filter((line): line is string => line !== null);

  let msg = lines.join("\n").trim();

  if (v.rescheduleLink || v.cancelLink) {
    msg += "\n\nPrecisa reagendar ou cancelar?\n";
    if (v.rescheduleLink) msg += `Reagendar: ${v.rescheduleLink}\n`;
    if (v.cancelLink) msg += `Cancelar: ${v.cancelLink}`;
  } else if (v.bookingLink) {
    msg += `\n\nReagendar pelo link: ${v.bookingLink}`;
  }

  msg += "\n\nEsperamos por você. Até lá!";
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
