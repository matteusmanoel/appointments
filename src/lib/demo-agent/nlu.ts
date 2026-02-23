/**
 * NLU for demo agent: normalization, intent, date/time parsing, out-of-scope detection.
 * No ML — regex and heuristics aligned with backend agent behavior.
 */

import type { DemoIntent } from "./types";

const OPENING_PATTERN =
  /^(oi|ola|olá|opa|salve|e\s*a[ií]|bom dia|boa tarde|boa noite|fala|iae|iai|oii+|olaa+)[!.\s]*$/i;

/** Lowercase, NFD strip accents, collapse non-letters to space, trim. */
export function normalizeLoose(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Infer service keyword from text (corte, barba, sobrancelha, combo). */
export function inferServiceKeyword(
  text: string
): "corte" | "barba" | "sobrancelha" | "combo" | null {
  const t = normalizeLoose(text);
  if (/\bcorte\s*[\+e]\s*barba|\bcombo\b|barba\s*[\+e]\s*corte/.test(t)) return "combo";
  if (/\bbarba\b/.test(t)) return "barba";
  if (/\bsobrancelha\b/.test(t)) return "sobrancelha";
  if (/\bcabelo|cortar|corte\b/.test(t)) return "corte";
  return null;
}

/** Short greeting only (length and pattern). */
export function isGreeting(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 40) return false;
  return OPENING_PATTERN.test(t);
}

/** Out-of-scope: food, politics, programming, etc. */
export function isOutOfScope(text: string): boolean {
  const t = normalizeLoose(text);
  if (/\bpizza|pizzaria|hamburguer|lanche|acai\b/.test(t)) return true;
  if (/\bpolitica|elei[cç]|presidente|deputado\b/.test(t)) return true;
  if (/\bprograma[cç]|codigo|código|javascript|python\b/.test(t)) return true;
  if (/\bignore\s+regras|mostre\s+id|uuid|prompt\s+injection\b/.test(t)) return true;
  return false;
}

/** "Qualquer um" / "tanto faz" / "pode ser qualquer" */
export function isNoPreference(text: string): boolean {
  return /(qualquer um|tanto faz|pode ser qualquer)/i.test(text);
}

/** Affirmative only (sim, ok, pode, confirmo, etc.). */
export function isAffirmative(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 40) return false;
  return /^(sim|s|pode|ok|okay|beleza|confirmo|isso|fechado|combinado|manda ver|top|show)[!.\s]*$/i.test(t);
}

/** Likely a name only (letters/spaces, 2–40 chars, not greeting/affirmation). */
export function isLikelyName(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length < 2 || t.length > 40) return false;
  if (isAffirmative(t) || isGreeting(t)) return false;
  return /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(t) && t.split(/\s+/).filter(Boolean).length <= 4;
}

function normalizeTime(hRaw: string, mRaw?: string): string | undefined {
  const h = parseInt(hRaw, 10);
  const m = mRaw == null || mRaw === "" ? 0 : parseInt(mRaw, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  if (h < 0 || h > 23 || m < 0 || m > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parse time from text (pt-BR): "às 14", "14:30", "14h", "2 da tarde".
 * Returns HH:mm or null.
 */
export function parseTime(text: string): string | null {
  const t = (text ?? "").toLowerCase();
  const as = t.match(/\b(?:às|as|a)\s*(\d{1,2})(?::(\d{2}))?\b/);
  const h = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*h\b/);
  const direct = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (as?.[1]) return normalizeTime(as[1], as[2]) ?? null;
  if (h?.[1]) return normalizeTime(h[1], h[2]) ?? null;
  if (direct?.[1] && direct?.[2]) return normalizeTime(direct[1], direct[2]) ?? null;
  const onlyHour = t.match(/\b(\d{1,2})\b/);
  if (onlyHour?.[1]) return normalizeTime(onlyHour[1], "0") ?? null;
  return null;
}

/**
 * Parse date from text. Uses refDate for "hoje"/"amanhã" and relative weekdays.
 * Returns yyyy-MM-dd.
 */
export function parseDate(
  text: string,
  refDate: Date = new Date()
): string | null {
  const raw = (text ?? "").toLowerCase();
  const t = normalizeLoose(text ?? "").toLowerCase() || raw;
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const day = refDate.getDate();

  if (/\bhoje\b/.test(t) || /\bagora\b/.test(raw)) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (/\bamanh[aãa]\b/.test(raw) || /\bamanha\b/.test(t)) {
    const d = new Date(refDate);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const iso = (text ?? "").match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = (text ?? "").match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (br) {
    const d = parseInt(br[1], 10);
    const m = parseInt(br[2], 10);
    const y = br[3] != null ? parseInt(br[3], 10) : year;
    const fullYear = y < 100 ? 2000 + y : y;
    return `${fullYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const weekdays: Record<string, number> = {
    domingo: 0,
    segunda: 1,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
  };
  for (const [name, targetDow] of Object.entries(weekdays)) {
    if (t.includes(name)) {
      const curr = new Date(refDate);
      const currDow = curr.getDay();
      let diff = targetDow - currDow;
      if (diff <= 0) diff += 7;
      curr.setDate(curr.getDate() + diff);
      return `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}-${String(curr.getDate()).padStart(2, "0")}`;
    }
  }

  return null;
}

/** Detect high-level intent from user message (no state). */
export function detectIntent(text: string): DemoIntent {
  const t = normalizeLoose(text);
  if (isGreeting(text)) return "greeting";
  if (/\bcancelar|desmarcar|cancelar agendamento\b/.test(t)) return "cancel";
  if (/\breagendar|remarcar|trocar (o )?horario|mudar (a )?data\b/.test(t)) return "reschedule";
  if (/\b(servi[cç]os|pre[cç]os|quanto custa|lista)\b/.test(t) && !/\bagendar|marcar\b/.test(t))
    return "list_services";
  if (/\bagendar|marcar|marcar horario|agendamento|corte|barba|combo|sobrancelha\b/.test(t) || inferServiceKeyword(text))
    return "book";
  return "unknown";
}

/** Check if message has any booking-related intent (service, date, time, confirm, name). */
export function hasBookingIntent(text: string): boolean {
  if (isGreeting(text) || isAffirmative(text) || isLikelyName(text)) return true;
  if (inferServiceKeyword(text)) return true;
  if (parseDate(text) || parseTime(text)) return true;
  if (/(agendar|marcar|horario|servico)\b/i.test(normalizeLoose(text))) return true;
  return false;
}

/**
 * Unclear: intent unknown and no booking-related content (for layer-1 "não entendi" vs layer-2 reset).
 * Used when we could not extract service, date, time, or confirmation from the message.
 */
export function isUnclear(text: string): boolean {
  if (!text || text.length > 300) return false;
  if (isOutOfScope(text)) return false;
  if (detectIntent(text) !== "unknown") return false;
  if (hasBookingIntent(text)) return false;
  return true;
}
