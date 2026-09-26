import { weekdayKeyFromIso, type WeekdayKey } from "../ai/date-calendar.js";

type DayWindow = { start?: string; end?: string } | null;

function timeToMinutes(raw: string | null | undefined): number | null {
  const t = String(raw ?? "").slice(0, 5);
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayWindow(source: unknown, weekday: WeekdayKey): DayWindow {
  if (!source || typeof source !== "object") return null;
  const day = (source as Record<string, unknown>)[weekday];
  if (!day || typeof day !== "object") return null;
  return day as DayWindow;
}

/** Fechamento do dia: expediente do barbeiro, senão o da loja. */
export function closingMinutesForDay(params: {
  dateIso: string;
  businessHours: unknown;
  barberSchedule: unknown;
}): number | null {
  const weekday = weekdayKeyFromIso(params.dateIso);
  const barberEnd = timeToMinutes(dayWindow(params.barberSchedule, weekday)?.end);
  if (barberEnd != null) return barberEnd;
  return timeToMinutes(dayWindow(params.businessHours, weekday)?.end);
}

/**
 * Prazo da mensagem de encaixe manual.
 * Próximo horário do barbeiro menos a duração. Se esse horário é o próprio cliente, sem prazo.
 * Sem próximo horário, o prazo é o fechamento do dia.
 */
export function computeDispatchDeadline(params: {
  nowMins: number;
  durationMinutes: number;
  nextAppointmentMins: number | null;
  nextAppointmentIsWaitlistedClient: boolean;
  closingMins: number | null;
}): string | null {
  if (params.nextAppointmentIsWaitlistedClient) return null;
  if (params.nextAppointmentMins != null && params.durationMinutes > 0) {
    const deadline = params.nextAppointmentMins - params.durationMinutes;
    if (deadline > params.nowMins) return minutesToHm(deadline);
    return null;
  }
  if (params.closingMins != null && params.closingMins > params.nowMins) {
    return minutesToHm(params.closingMins);
  }
  return null;
}

export function formatClockPt(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  if (!h || m == null) return hhmm;
  if (m === "00") return `${Number(h)}h`;
  return `${Number(h)}h${m}`;
}

export function composeManualWaitlistMessage(params: {
  clientName: string | null;
  barberName: string;
  deadlineHm: string | null;
}): string {
  const first = (params.clientName ?? "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `${first}, ` : "";
  const offer = `o barbeiro ${params.barberName} está disponível para te atender agora`;
  if (params.deadlineHm) {
    return `${greeting}${offer}, consegue vir até as ${formatClockPt(params.deadlineHm)}?`;
  }
  return `${greeting}${offer}, consegue vir?`;
}
