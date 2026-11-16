/**
 * Relógio simulado visível para tools (get_next_slots, check_availability)
 * via AsyncLocalStorage, sem mudar a assinatura de cada tool.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<Date>();

export function parseSimulatedNow(value: string | Date | undefined | null): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // "2026-11-14 18:08" ou "2026-11-14T18:08" sem fuso: assume America/Sao_Paulo (UTC-3, sem DST).
  const naive = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/,
  );
  if (naive) {
    const iso = `${naive[1]}T${naive[2]}:${naive[3] ?? "00"}-03:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function getSimulatedNow(): Date | undefined {
  return store.getStore();
}

export function runWithSimulatedNow<T>(now: string | Date | undefined | null, fn: () => T): T {
  const parsed = parseSimulatedNow(now ?? undefined);
  if (!parsed) return fn();
  return store.run(parsed, fn);
}

/** today (yyyy-MM-dd) e minutos desde meia-noite no fuso da barbearia. */
export function wallClockFrom(now: Date, timeZone = "America/Sao_Paulo"): { todayStr: string; nowMins: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const todayStr = `${parts.year}-${parts.month}-${parts.day}`;
  const nowMins = Number(parts.hour) * 60 + Number(parts.minute);
  return { todayStr, nowMins: Number.isFinite(nowMins) ? nowMins : 0 };
}
