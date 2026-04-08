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

export function buildReminder2h(v: ReminderVars): string {
  const first = firstName(v.clientName);
  const greeting = first ? `Oi, ${first}!` : "Oi!";
  const dateBr = formatDateBr(v.date);
  const lines: string[] = [
    `${greeting} Passando pra lembrar que seu horário é em breve:`,
    "",
    v.serviceNames ? `- Serviços: ${v.serviceNames}` : null,
    `- Data: ${dateBr} às ${v.time}`,
    v.barberName ? `- Barbeiro: ${v.barberName}` : null,
  ].filter((line): line is string => line !== null);

  let msg = lines.join("\n").trim();
  if (v.rescheduleLink || v.cancelLink) {
    msg += "\n\nSe precisar reagendar ou cancelar:\n";
    if (v.rescheduleLink) msg += `Reagendar: ${v.rescheduleLink}\n`;
    if (v.cancelLink) msg += `Cancelar: ${v.cancelLink}`;
  }
  msg += "\n\nA gente te espera. Ate ja!";
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

export function buildFollowUpFirstVisit(v: FollowUp30dVars): string {
  const name = v.clientName ? ` ${v.clientName},` : "";
  return `Oi${name} faz um tempo que conversamos por aqui. Bora marcar seu primeiro horario? Agenda aqui: ${v.bookingLink} 🙂`.trim();
}

export type PaymentReminderVars = {
  barbershopName: string;
  portalLink: string;
};

export function buildPaymentReminder(v: PaymentReminderVars): string {
  return (
    `Oi! Identificamos uma pendencia no pagamento da sua assinatura da ${v.barbershopName}. ` +
    `Para regularizar e continuar usando sem interrupcao, acesse: ${v.portalLink}`
  ).trim();
}

export type OpeningSummaryVars = {
  barbershopName: string;
  date: string;
  appointments: Array<{ time: string; clientName: string; serviceName: string }>;
};

export function buildOpeningSummary(v: OpeningSummaryVars): string {
  const dateBr = formatDateBr(v.date);
  const header = `Bom dia! Resumo da abertura da ${v.barbershopName} para ${dateBr}:`;
  const body = v.appointments
    .slice(0, 20)
    .map((a, idx) => `${idx + 1}. ${a.time} - ${a.clientName} (${a.serviceName})`)
    .join("\n");
  return `${header}\n\n${body}`.trim();
}

export type BirthdayMessageVars = {
  clientName?: string;
  bookingLink: string;
  discountText?: string;
};

export function buildBirthdayMessage(v: BirthdayMessageVars): string {
  const first = firstName(v.clientName);
  const name = first ? `, ${first}` : "";
  const offer = v.discountText ? ` ${v.discountText}` : "";
  return `Parabens${name}! 🎉 Desejamos um dia incrivel!${offer} Se quiser, ja garante seu horario aqui: ${v.bookingLink}`.trim();
}

export type PlanPaymentMessageVars = {
  clientName?: string;
  planName: string;
  amount: number;
  dueDate: string;
  billingDay: number;
};

/** Mensagem enviada antes do botão PIX na cobrança recorrente de plano. */
export function buildPlanPaymentMessage(v: PlanPaymentMessageVars): string {
  const first = firstName(v.clientName);
  const greeting = first ? `Oi, ${first}!` : "Oi!";
  const dateBr = formatDateBr(v.dueDate);
  const amountStr = v.amount.toFixed(2).replace(".", ",");
  return (
    `${greeting} Chegou o dia da renovacao do seu plano *${v.planName}*.\n\n` +
    `- Valor: *R$ ${amountStr}*\n` +
    `- Vencimento: ${dateBr}\n\n` +
    `Segue o codigo PIX abaixo. Apos o pagamento, seus servicos continuam garantidos! ` +
    `Proxima cobranca: dia ${v.billingDay} do mes que vem.`
  ).trim();
}
