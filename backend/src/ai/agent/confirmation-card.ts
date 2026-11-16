/**
 * Cards de confirmação (agendar, remarcar, cancelar, lembrete) com TTL.
 * Um «sim» atrasado ou ambíguo não fecha o horário.
 * O cancelamento só acontece depois do card explícito e de um «sim».
 */
import { formatResumoWhen } from "../date-calendar.js";

export const CONFIRM_CARD_TTL_MS = 30 * 60 * 1000;
export const REMINDER_CARD_TTL_MS = 26 * 60 * 60 * 1000;

export const CANCEL_FAILED_SAFE =
  "Não consegui cancelar agora. Pode tentar de novo, ou a gente vê um novo horário.";

export const CANCEL_NONE_SAFE = "Você não tem horário marcado agora.";

export type ConfirmCardKind = "create" | "reschedule" | "cancel" | "reminder";

export type ConfirmCard = {
  kind: ConfirmCardKind;
  appointmentId?: string;
  issuedAt: string;
};

export function isActiveAppointmentStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "pending").toLowerCase();
  return s === "pending" || s === "confirmed";
}

export function isLiveConfirmCard(
  card: ConfirmCard | null | undefined,
  now: Date,
  kinds?: ConfirmCardKind[],
): boolean {
  if (!card?.issuedAt) return false;
  if (kinds?.length && !kinds.includes(card.kind)) return false;
  const issued = Date.parse(card.issuedAt);
  if (!Number.isFinite(issued)) return false;
  const ttl = card.kind === "reminder" ? REMINDER_CARD_TTL_MS : CONFIRM_CARD_TTL_MS;
  return now.getTime() - issued <= ttl;
}

export function assistantMessageIsCancelCard(text: string): boolean {
  return /posso cancelar seu hor[aá]rio/i.test(text ?? "");
}

export function assistantMessageIsBookingConfirmCard(text: string): boolean {
  const t = String(text ?? "");
  if (assistantMessageIsCancelCard(t)) return false;
  return /posso confirmar\?/i.test(t) || /quer que eu mude para/i.test(t);
}

export function composeCancelConfirmAsk(params: {
  serviceName?: string;
  when: string;
  barberName?: string;
}): string {
  const service = params.serviceName?.trim() || "seu horário";
  const who = params.barberName ? ` com o ${params.barberName}` : "";
  return `Posso cancelar seu horário de ${service} ${params.when}${who}? Se preferir, posso remarcar.`;
}

export const RESCHEDULE_NONE_SAFE =
  "Não encontrei um horário ativo pra remarcar. Se quiser, posso agendar um novo.";

export function composeWhichAppointmentAsk(
  appointments: Array<{ serviceName?: string; date: string; time: string }>,
  todayIso: string,
  verb: "cancelar" | "remarcar" = "cancelar",
): string {
  const items = appointments
    .map((a) => {
      const service = a.serviceName?.trim() || "horário";
      const when = formatResumoWhen(String(a.date).slice(0, 10), String(a.time).slice(0, 5), todayIso);
      return `${service} ${when}`;
    })
    .filter(Boolean);
  if (items.length < 2) {
    return `Você tem mais de um horário marcado. Qual você quer ${verb}?`;
  }
  const last = items[items.length - 1];
  const head = items.slice(0, -1).join(", ");
  return `Você tem mais de um horário marcado. Qual você quer ${verb}: ${head} ou ${last}?`;
}

export function composeWhichAppointmentCancel(
  appointments: Array<{ serviceName?: string; date: string; time: string }>,
  todayIso: string,
): string {
  return composeWhichAppointmentAsk(appointments, todayIso, "cancelar");
}

export function composeWhichAppointmentReschedule(
  appointments: Array<{ serviceName?: string; date: string; time: string }>,
  todayIso: string,
): string {
  return composeWhichAppointmentAsk(appointments, todayIso, "remarcar");
}

export function parseConfirmCard(raw: unknown): ConfirmCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== "create" && kind !== "reschedule" && kind !== "cancel" && kind !== "reminder") {
    return undefined;
  }
  const issuedAt = typeof r.issuedAt === "string" ? r.issuedAt : "";
  if (!issuedAt || !Number.isFinite(Date.parse(issuedAt))) return undefined;
  const appointmentId =
    typeof r.appointmentId === "string" && r.appointmentId.trim() ? r.appointmentId.trim() : undefined;
  return { kind, issuedAt, ...(appointmentId ? { appointmentId } : {}) };
}
