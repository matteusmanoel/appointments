/** Intents determinísticos de conversa (consulta, confirmação, local, cancelar, reagendar). */

import {
  formatTimePt,
  parseClientTime,
  resolveClientDateFromText,
  type ClientDateSource,
} from "./date-calendar.js";
import {
  resolveBarberFromText,
  resolveServiceFromText,
  type BookingDraft,
  type CatalogBarber,
  type CatalogService,
} from "./booking-draft.js";

function fold(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Sim, por gentileza" / "Pode confirmar" / "Perfeito, pode agendar" — escolha de horário novo não é confirmação. */
export function isClientConfirmation(text: string): boolean {
  const t = fold(text);
  if (!t || t.length > 80) return false;
  if (parseClientTime(text)) return false;
  if (
    /\b(terca|segunda|quarta|quinta|sexta|sabado|domingo|reagendar|reagenda|cancelar|horario|corte|barba|amanha|hoje)\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (/^(perfeito|otimo|claro|excelente)([,!.\s]|$)/.test(t)) return true;
  if (/\b(pode|podes)\s+(agendar|marcar|confirmar)\b/.test(t)) return true;
  if (
    /^(sim|s|pode|ok|okay|beleza|confirmo|isso|fechado|combinado|manda ver|top|show|claro|excelente)([,!.\s]|$)/.test(
      t,
    )
  ) {
    return true;
  }
  return /^(sim|pode|ok).{0,40}(confirmar|gentileza|favor|obrigad)/.test(t);
}

export function looksLikeConsultIntent(text: string): boolean {
  const t = fold(text);
  if (!t) return false;
  if (looksLikeRescheduleIntent(t) || looksLikeCancelIntent(t)) return false;
  if (isShopHoursQuestion(text)) return false;
  return (
    /\b(consultar|consulta)\b/.test(t) ||
    /pra quando (ficou|e|eh)\b/.test(t) ||
    /quando (ficou|e|eh) (o|meu)\b/.test(t) ||
    /meu agendamento/.test(t) ||
    /\bque horas\b/.test(t) ||
    /\ba que horas\b/.test(t) ||
    /qual (e|eh) (o )?meu horario/.test(t)
  );
}

export function looksLikeLocationIntent(text: string): boolean {
  const t = fold(text);
  return (
    /\bonde fica\b/.test(t) ||
    /\blocalizacao\b/.test(t) ||
    /\bendereco\b/.test(t) ||
    /\bcomo chego\b/.test(t) ||
    /\bmanda (o )?pin\b/.test(t) ||
    /\bmapa\b/.test(t)
  );
}

export function looksLikeCancelIntent(text: string): boolean {
  const t = fold(text);
  return (
    /\bcancel(ar|e|o)\b/.test(t) ||
    /\bdesmarcar\b/.test(t) ||
    /nao (vou|consigo) (poder )?ir/.test(t) ||
    /n[aã]o vou poder ir/.test(t) ||
    /\bimprevisto\b/.test(t) ||
    /nao vai dar/.test(t)
  );
}

export function looksLikeRescheduleIntent(text: string): boolean {
  const t = fold(text);
  return (
    /\breagenda/.test(t) ||
    /\bremarcar\b/.test(t) ||
    /\bmudar\b.{0,24}\bhorario\b/.test(t) ||
    /\btrocar\b.{0,24}\bhorario\b/.test(t) ||
    /\boutro (dia|horario)\b/.test(t)
  );
}

/** Marcadores de formalidade na mensagem atual do cliente (independe de memória). */
export function looksLikeFormalMessage(text: string): boolean {
  const t = fold(text);
  if (!t) return false;
  return /\b(gostaria|poderia|poderias|se possivel|por favor|poderia me|gostaria de)\b/.test(t);
}

/** "Olá tudo bem?" — cumprimento social, não abertura seca. */
export function looksLikeSocialGreeting(text: string): boolean {
  const t = fold(text);
  if (!t || t.length > 60) return false;
  return /^(oi|ola|opa|salve|bom dia|boa tarde|boa noite)\b/.test(t) && /\btudo bem\b/.test(t);
}

/** Pedido explícito de pessoa. Não depende da lista de keywords da loja. */
export function looksLikeHumanHandoff(text: string): boolean {
  const t = fold(text);
  return (
    /\batendente\b/.test(t) ||
    /\bhumano\b/.test(t) ||
    /\bpessoa real\b/.test(t) ||
    /\bfalar com (alguem|uma pessoa|gente)\b/.test(t)
  );
}

export function looksLikePlanIntent(text: string): boolean {
  const t = fold(text);
  return /\b(plano|assinatura|mensalidade)\b/.test(t);
}

export function looksLikeWaitlistIntent(text: string): boolean {
  const t = fold(text);
  return /lista de espera/.test(t) || /nenhum horario/.test(t) || /de jeito nenhum/.test(t);
}

export function looksLikeTestWipeCommand(text: string): boolean {
  const t = fold(text);
  return /^\/?deletar$/.test(t);
}

export function isShopHoursQuestion(text: string): boolean {
  const t = fold(text);
  if (!t) return false;
  if (/\b(agendar|marcar|disponib|quero corte|quero barba)\b/.test(t)) return false;
  return (
    /\b(abert[oa]s?|funcionam|funcionamento|expediente)\b/.test(t) ||
    /\b(que horas|ate que horas)\s+(fecha|fecham|abre|abrem)\b/.test(t) ||
    /\besta(o|ao)?\s+abert/.test(t)
  );
}

/** Shop-hours “hoje?” is not a booking date. Booking “quero marcar hoje” still resolves. */
export function bookingDateFromUserTurn(
  text: string,
  todayIso: string,
): { date: string; source: ClientDateSource } | null {
  if (isShopHoursQuestion(text)) return null;
  return resolveClientDateFromText(text, todayIso);
}

export function acceptsOfferedDay(text: string): boolean {
  const t = fold(text)
    .replace(/[!?.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return (
    /^(pode ser|pode|sim|ok|beleza|vamos|fechado|claro|excelente|perfeito|otimo|show|top)\b/.test(t) ||
    /\bpode ser\b/.test(t)
  );
}

/** Consecutive assistant bubbles of the last turn (WhatsApp [[MSG]] split). */
export function lastAssistantTurnText(
  messages: Array<{ role?: string; content?: string | null }>,
): string {
  let i = messages.length - 1;
  while (i >= 0 && String(messages[i]?.role ?? "") !== "assistant") i--;
  const chunks: string[] = [];
  while (i >= 0 && String(messages[i]?.role ?? "") === "assistant") {
    chunks.push(String(messages[i]?.content ?? ""));
    i--;
  }
  return chunks.reverse().join("[[MSG]]");
}

/** Consecutive trailing user bubbles (WhatsApp split) — one turn, not one job per bubble. */
export function lastUserTurnText(
  messages: Array<{ role?: string; content?: string | null }>,
): string {
  let i = messages.length - 1;
  while (i >= 0 && String(messages[i]?.role ?? "") !== "user") i--;
  const chunks: string[] = [];
  while (i >= 0 && String(messages[i]?.role ?? "") === "user") {
    chunks.push(String(messages[i]?.content ?? ""));
    i--;
  }
  return chunks.reverse().join("\n").trim();
}

/** Last assistant offered a single clock ("Posso te encaixar … às 18h. Fica bom?"). */
export function assistantOfferedFitSlot(text: string): boolean {
  const t = fold(text.replace(/\[\[MSG\]\]/g, " "));
  if (!/\bfica bom\b/.test(t)) return false;
  if (/\bqual prefere\b/.test(t)) return false;
  // Occupied-slot with alt-barber has the same "fica bom" pattern — but is a different contract.
  // Discriminate via the tail phrase generated by composeOccupiedSlot with sameTimeOthers.
  if (/\bou seria so com\b/.test(t)) return false;
  if (!parseClientTime(text)) return false;
  const clockMentions = text.match(/\b(?:às|as|à)\s*\d{1,2}(?:\s*[:hH]\s*\d{2})?h?\b/gi) ?? [];
  if (clockMentions.length > 1) return false;
  return /\bencaixar\b/.test(t) || /\btenho\b/.test(t);
}

/**
 * Last assistant offered a DIFFERENT barber at the same clock (composeOccupiedSlot with sameTimeOthers).
 * Format: "Posso te encaixar com o Eduardo às 18h. Fica bom? Ou seria só com o Lucas mesmo"
 */
export function assistantOfferedAltBarberSlot(text: string): boolean {
  const t = fold(text.replace(/\[\[MSG\]\]/g, " "));
  return /\bou seria so com\b/.test(t) && /\bencaixar\b/.test(t) && !!parseClientTime(text);
}

/**
 * Extract the alt-barber offered in a composeOccupiedSlot message.
 * Returns undefined when the message is not an alt-barber offer or the name can't be resolved.
 */
export function offeredAltBarberFromText(
  text: string,
  barbers: CatalogBarber[],
): CatalogBarber | undefined {
  if (!assistantOfferedAltBarberSlot(text)) return undefined;
  // Match "Posso te encaixar com o NOME às" — capture NOME (1–2 words)
  const m = text.match(
    /encaixar\s+com\s+o?\s*([A-Za-zÀ-ÖØ-öø-ÿ']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ']+)?)\s+(?:às|as)\s/i,
  );
  const candidate = (m?.[1] ?? "").trim();
  if (!candidate) return undefined;
  return resolveBarberFromText(candidate, barbers);
}

/** Affirmative without a new clock — binds the offered last_fit / alt, not the refused request. */
export function acceptsOfferedFit(text: string): boolean {
  if (parseClientTime(text)) return false;
  if (looksLikeRescheduleIntent(text) || looksLikeCancelIntent(text)) return false;
  const t = fold(text)
    .replace(/[!?.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 80) return false;
  if (/\bnao\b/.test(t) && !/\b(claro|sim)\b/.test(t)) return false;
  return isClientConfirmation(text) || acceptsOfferedDay(text);
}

export function offeredFitClockIfAccepted(params: {
  lastAssistant: string;
  lastUser: string;
}): string | null {
  if (!assistantOfferedFitSlot(params.lastAssistant)) return null;
  if (!acceptsOfferedFit(params.lastUser)) return null;
  return parseClientTime(params.lastAssistant);
}

export function assistantOfferedNextOpenDay(text: string): boolean {
  const t = fold(text);
  return /\bamanha\b/.test(t);
}

export function prefersNamedBarberOverTime(text: string): boolean {
  const t = fold(text);
  return /\bso (com |o )/.test(t) || /\bseria so com\b/.test(t);
}

export function acceptsAnyBarber(text: string): boolean {
  const t = fold(text);
  return /\bqualquer (um|barbeiro)\b/.test(t) || /\btanto faz\b/.test(t);
}

export function assistantAskedBarberPreference(text: string): boolean {
  const t = fold(text);
  return /\bou seria so com\b/.test(t);
}

export function assistantAskedReminderRsvp(text: string): boolean {
  const t = fold(text);
  return (
    /\bcancela ou remarca\b/.test(t) ||
    /\bresponde \*confirmo\*/.test(t) ||
    /\bainda nao tivemos sua confirmacao\b/.test(t) ||
    /\bso lembrando do seu horario\b/.test(t)
  );
}

/**
 * User means "from X onwards / after X" — not an exact clock.
 * e.g. "apos as 18", "depois das 18h", "a partir das 18", "18h ou depois"
 */
/**
 * Facts this turn states. Omission is not a clear: the caller merges onto the previous draft.
 * "após as 18" sets after_time and does not set time. "Ou após" without a clock sets floorWithoutClock.
 */
export function draftPatchFromTurn(params: {
  text: string;
  todayIso: string;
  services: CatalogService[];
  barbers: CatalogBarber[];
}): { patch: Partial<BookingDraft>; afterIntent: boolean; floorWithoutClock: boolean } {
  const text = params.text ?? "";
  const patch: Partial<BookingDraft> = {};
  const barber = resolveBarberFromText(text, params.barbers);
  if (barber) {
    patch.barber_id = barber.id;
    patch.barber_name = barber.name;
  }
  const service = resolveServiceFromText(text, params.services);
  if (service.match) {
    patch.service_ids = [service.match.id];
    patch.service_name = service.match.name;
    if (typeof service.match.price === "number" && Number.isFinite(service.match.price)) {
      patch.total_price = service.match.price;
    }
  }
  const dated = bookingDateFromUserTurn(text, params.todayIso);
  if (dated) patch.date = dated.date;
  const afterIntent = looksLikeAfterTimeIntent(text);
  const clock = isShopHoursQuestion(text) ? null : parseClientTime(text);
  if (afterIntent) {
    if (clock) patch.after_time = clock;
  } else if (clock) {
    patch.time = clock;
  }
  return { patch, afterIntent, floorWithoutClock: afterIntent && !clock };
}

export function looksLikeAfterTimeIntent(text: string): boolean {
  const t = fold(text);
  return (
    /\bapos\s+as?\b/.test(t) ||
    /\bdepois\s+das?\b/.test(t) ||
    /\ba\s+partir\s+das?\b/.test(t) ||
    /\bou\s+(mais\s+tarde|depois|apos)\b/.test(t)
  );
}

export function composeHumanConsult(params: {
  firstName?: string;
  serviceName: string;
  weekdayShort: string;
  barberName: string;
  timeHHmm?: string;
}): string {
  const hi = params.firstName ? `Olá, ${params.firstName}! ` : "Olá! ";
  const service = params.serviceName.trim() || "seu horário";
  const prep = /^(s[áa]bado|domingo)$/i.test(params.weekdayShort) ? "no" : "na";
  const timeBit = params.timeHHmm ? ` às ${formatTimePt(params.timeHHmm)}` : "";
  return (
    `${hi}Tudo certo com seu horário para ${service} ${prep} ${params.weekdayShort}${timeBit} com o ${params.barberName}? ` +
    `Se preferir reagendar, me diz o novo dia/horário.`
  );
}
