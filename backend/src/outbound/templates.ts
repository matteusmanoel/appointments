/**
 * Deterministic templates for reminders and follow-ups (no LLM).
 * WhatsApp bold is a single pair of asterisks.
 */

import { addDaysIso, formatDateBr, formatTimePt, weekdayShortPtFromIso } from "../ai/date-calendar.js";

export type ReminderVars = {
  clientName?: string;
  /** yyyy-MM-dd of the appointment. */
  date: string;
  /** HH:mm. */
  time: string;
  serviceNames?: string;
  barberName?: string;
  totalPrice?: number;
  /** yyyy-MM-dd of "today" in the shop timezone, so hoje/amanhã stay correct at send time. */
  todayIso?: string;
  /** When the 24h window fires and presence is already confirmed, don't ask again. */
  alreadyConfirmed?: boolean;
};

function moneyBr(amount: number): string {
  return amount.toFixed(2).replace(".", ",");
}

/** "Amanhã, terça, 22/09 às 18h" */
export function formatReminderWhen(dateIso: string, timeHHmm: string, todayIso?: string): string {
  const short = weekdayShortPtFromIso(dateIso);
  const br = formatDateBr(dateIso);
  const ddmm = br.length >= 5 ? br.slice(0, 5) : br;
  const timePt = formatTimePt(timeHHmm);
  if (todayIso && dateIso === todayIso) return `Hoje, ${short}, ${ddmm} às ${timePt}`;
  if (todayIso && dateIso === addDaysIso(todayIso, 1)) return `Amanhã, ${short}, ${ddmm} às ${timePt}`;
  const cap = short ? short.charAt(0).toUpperCase() + short.slice(1) : dateIso;
  return `${cap}, ${ddmm} às ${timePt}`;
}

/** "hoje" | "amanhã" | "terça, 22/09" — used in the 2h window, which is usually same-day. */
function relativeDay(dateIso: string, todayIso?: string): string {
  if (todayIso && dateIso === todayIso) return "hoje";
  if (todayIso && dateIso === addDaysIso(todayIso, 1)) return "amanhã";
  const short = weekdayShortPtFromIso(dateIso);
  const br = formatDateBr(dateIso);
  const ddmm = br.length >= 5 ? br.slice(0, 5) : br;
  return short ? `${short}, ${ddmm}` : ddmm;
}

/** Primeiro nome para saudação (ex.: "Mateus Ferreira" → "Mateus"). */
function firstName(fullName: string | undefined): string {
  if (!fullName?.trim()) return "";
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export function buildReminder24h(v: ReminderVars): string {
  const first = firstName(v.clientName);
  const greeting = first ? `Fala, ${first}!` : "Fala!";
  const when = formatReminderWhen(v.date, v.time, v.todayIso);
  const lines: Array<string | null> = [
    `${greeting} Passando para confirmar seu agendamento:`,
    "",
    v.serviceNames?.trim() ? `✂️ *${v.serviceNames.trim()}*` : null,
    v.barberName?.trim() ? `💈 *${v.barberName.trim()}*` : null,
    `📅 ${when}`,
    typeof v.totalPrice === "number" && Number.isFinite(v.totalPrice) ? `💰 R$ ${moneyBr(v.totalPrice)}` : null,
    "",
    v.alreadyConfirmed
      ? "Seu horário está confirmado. Esperamos por você!"
      : "Seu horário está reservado. *Você confirma sua presença ou prefere reagendar?*",
  ];
  return lines.filter((line): line is string => line !== null).join("\n").trim();
}

export function buildReminder2h(v: ReminderVars): string {
  return v.alreadyConfirmed ? buildReminder2hConfirmed(v) : buildReminder2hPending(v);
}

export function buildReminder2hPending(v: ReminderVars): string {
  const first = firstName(v.clientName);
  const day = relativeDay(v.date, v.todayIso);
  const clock = formatTimePt(v.time);
  const lead = first
    ? `${first}, ainda não recebemos sua confirmação.`
    : "Ainda não recebemos sua confirmação.";
  return (
    `${lead}\n\n` +
    `*Você vem ${day} às ${clock}?* Confirme agora para mantermos seu horário reservado. Caso não haja confirmação, precisaremos liberá-lo.`
  );
}

export function buildReminder2hConfirmed(v: ReminderVars): string {
  const first = firstName(v.clientName);
  const day = relativeDay(v.date, v.todayIso);
  const clock = formatTimePt(v.time);
  const hi = first ? `Tudo certo, ${first}!` : "Tudo certo!";
  return `${hi} *Seu horário está confirmado.* 💈\n\nNos vemos ${day}, às ${clock}.\nEsperamos por você!`;
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
  overdueDays?: number;
};

/** Mensagem enviada antes do botão PIX na cobrança recorrente de plano. */
export function buildPlanPaymentMessage(v: PlanPaymentMessageVars): string {
  const first = firstName(v.clientName);
  const greeting = first ? `Oi, ${first}!` : "Oi!";
  const dateBr = formatDateBr(v.dueDate);
  const amountStr = v.amount.toFixed(2).replace(".", ",");
  if (v.overdueDays) {
    return (
      `${greeting} Seu plano *${v.planName}* venceu ha ${v.overdueDays} dias (${dateBr}) e o pagamento ainda nao foi identificado.\n\n` +
      `- Valor: *R$ ${amountStr}*\n\n` +
      `Para evitar a suspensao, use o PIX abaixo. Qualquer duvida, estamos aqui!`
    ).trim();
  }
  return (
    `${greeting} Chegou o dia da renovacao do seu plano *${v.planName}*.\n\n` +
    `- Valor: *R$ ${amountStr}*\n` +
    `- Vencimento: ${dateBr}\n\n` +
    `Segue o codigo PIX abaixo. Apos o pagamento, seus servicos continuam garantidos! ` +
    `Proxima cobranca: dia ${v.billingDay} do mes que vem.`
  ).trim();
}
