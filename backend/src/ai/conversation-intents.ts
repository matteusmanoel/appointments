/** Intents determinísticos de conversa (consulta, confirmação, local, cancelar, reagendar). */

import {
  formatTimePt,
  parseClientTime,
  resolveClientDateFromText,
  type ClientDateSource,
} from "./date-calendar.js";
import {
  inferServiceKeyword,
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

const CONFIRMATION_TOKEN =
  /^(sim|s|pode|podes|ok|okay|beleza|boa|bom|confirmo|isso|mesmo|fechado|combinado|manda|ver|top|show|claro|excelente|perfeito|otimo|fica|ta|entao|por|gentileza|favor|obrigado|obrigada|agendar|marcar|confirmar|ser|contar|comigo|estarei|ai|la|presente|vou|compareco|comparecerei|irei|ate)$/;

const CONFIRMATION_CLAIM =
  /^(sim|s|pode|podes|ok|okay|beleza|confirmo|isso|fechado|combinado|top|show|claro|excelente|perfeito|otimo|fica|estarei|compareco|comparecerei|vou|obrigado|obrigada|gentileza|favor)$/;

/**
 * The whole message is a short yes: affirmative words and courtesy only.
 * A leading "beleza" followed by another subject is not a confirmation.
 */
function isShortConfirmation(text: string): boolean {
  if (/\bnao\b/.test(text)) return false;
  const words = text.replace(/[,!.]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) return false;
  if (!words.some((word) => CONFIRMATION_CLAIM.test(word))) return false;
  return words.every((word) => CONFIRMATION_TOKEN.test(word));
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
  if (/^estarei\s+(ai|la|presente)$/.test(t)) return true;
  if (/^vou\s+sim$/.test(t)) return true;
  if (/^(compareco|comparecerei)$/.test(t)) return true;
  if (/^irei\s+sim$/.test(t)) return true;
  if (/^ate\s+la$/.test(t)) return true;
  if (/^pode\s+contar\s+comigo$/.test(t)) return true;
  return isShortConfirmation(t);
}

/**
 * Recusa curta ("não", "dessa vez não", "quero outro"): a pessoa não aceitou o que foi sugerido.
 * "Não" seguido de um horário ou de um serviço nomeado não é só recusa: o fato novo vale mais.
 */
export function isClientRefusal(text: string): boolean {
  const t = fold(text).replace(/[,!.?]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return false;
  if (parseClientTime(text)) return false;
  return /^(nao|n|nope|negativo|dessa vez nao|desta vez nao|hoje nao|nao obrigado|nao quero|nao e esse|nao e o de sempre|quero outro|quero outra coisa|outro|outra|outro servico|diferente)$/.test(t);
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

export function looksLikePixIntent(text: string): boolean {
  const t = fold(text);
  return /\bpix\b/.test(t);
}

/** The outbound plan-charge template, not a client phrase. */
export function assistantMessageIsPlanCharge(text: string): boolean {
  const t = fold(text);
  return /\bplano\b/.test(t) && /\bpix\b/.test(t) && (/\brenovacao\b/.test(t) || /\bvenceu\b/.test(t) || /\bvencimento\b/.test(t));
}

export function looksLikeLocationIntent(text: string): boolean {
  const t = fold(text);
  return (
    /\bonde fica\b/.test(t) ||
    /\blocalizacao\b/.test(t) ||
    /\bendereco\b/.test(t) ||
    /\bcomo chego\b/.test(t) ||
    /\bmanda (a |o )?(pin|loc\b|localizacao|mapa|endereco)/.test(t) ||
    /\bmapa\b/.test(t)
  );
}

export function looksLikeCancelIntent(text: string): boolean {
  const t = fold(text);
  return (
    /\bcancela(r|m|s)?\b/.test(t) ||
    /\bcancele(m)?\b/.test(t) ||
    /\bcancelo(u)?\b/.test(t) ||
    /\bdesmarca(r|m|s)?\b/.test(t) ||
    /\bnao\b.{0,40}\b(vou|consigo|poderei|posso|irei)\b.{0,24}\b(ir|comparecer)\b/.test(t) ||
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

/**
 * Pedido de agendamento novo. Reagendar, cancelar, consultar e correção de serviço
 * já marcado não entram aqui.
 */
export function looksLikeNewBookingIntent(text: string): boolean {
  const t = fold(text);
  if (!t) return false;
  if (looksLikeCancelIntent(text) || looksLikeRescheduleIntent(text) || looksLikeConsultIntent(text)) return false;
  if (/\b(alterar|corrigir|na verdade|trocar o servico|nao so)\b/.test(t)) return false;
  return /\b(agendar|marcar|agenda)\b/.test(t) || /\bquero\b/.test(t) || /\bgostaria de\b/.test(t);
}

/**
 * Mensagem sem nenhum sinal de intenção: sem verbo de agendamento, serviço, data,
 * horário, saudação, plano ou pergunta de FAQ. "pode ser" solto cai aqui.
 */

/**
 * Cliente pede o próximo horário livre, sem dizer o relógio:
 * "pode ser o próximo", "o mais cedo", "qualquer horário", "o primeiro que tiver".
 * Não cobre consulta ("meus próximos horários") nem um horário explícito ("às 18h").
 */
export function looksLikeNextAvailableIntent(text: string): boolean {
  const t = fold(text);
  if (!t) return false;
  if (parseClientTime(text)) return false;
  if (looksLikeCancelIntent(text) || looksLikeRescheduleIntent(text) || looksLikeConsultIntent(text)) {
    return false;
  }
  if (/\b(meus?|quais?)\s+proximos?\b/.test(t)) return false;
  if (/\bqual\s+(e|eh|e o|o)?\s*meu\s+proximo\b/.test(t)) return false;
  return (
    /\b(o|a)\s+proxim[oa](\s+horario)?\b/.test(t) ||
    /\bproxim[oa]\s+horario\b/.test(t) ||
    /^(o\s+)?proxim[oa]\??$/.test(t) ||
    /\bmais cedo\b/.test(t) ||
    /\bmais breve\b/.test(t) ||
    /\bqualquer horario\b/.test(t) ||
    /\b(o\s+)?primeiro (horario|que tiver|disponivel)\b/.test(t) ||
    /\bo que tiver\b/.test(t) ||
    /\bpode ser agora\b/.test(t) ||
    /\bquanto antes\b/.test(t)
  );
}

export function looksLikeZeroIntentUnknown(text: string): boolean {
  const t = fold(text);
  if (!t) return true;
  if (
    looksLikeCancelIntent(text) ||
    looksLikeRescheduleIntent(text) ||
    looksLikeConsultIntent(text) ||
    looksLikeLocationIntent(text) ||
    looksLikePixIntent(text) ||
    looksLikePlanIntent(text) ||
    looksLikeWaitlistIntent(text) ||
    looksLikeHumanHandoff(text) ||
    looksLikeSocialGreeting(text) ||
    isShopHoursQuestion(text)
  ) {
    return false;
  }
  if (/^(oi|ola|opa|salve|bom dia|boa tarde|boa noite|fala|iae|e ai)\b/.test(t)) return false;
  if (/\b(agendar|marcar|quero|gostaria|remarcar|cancelar|desmarcar|reagendar)\b/.test(t)) return false;
  if (parseClientTime(text)) return false;
  if (looksLikeNextAvailableIntent(text)) return false;
  if (/\b(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(t)) return false;
  if (/\b\d{1,2}\/\d{1,2}\b/.test(t)) return false;
  if (inferServiceKeyword(text)) return false;
  if (acceptsAnyBarber(text) || /\bbarbeiro\b/.test(t)) return false;
  if (/\b(pix|preco|valor|quanto|endereco|localizacao|expediente|funcionamento|aberto|aberta|abertos)\b/.test(t)) {
    return false;
  }
  return true;
}

export function looksLikePlanIntent(text: string): boolean {
  const t = fold(text);
  return /\b(planos?|assinaturas?|assinar|mensalidades?)\b/.test(t);
}

export function looksLikeWaitlistIntent(text: string): boolean {
  const t = fold(text);
  return (
    /lista de espera/.test(t) ||
    /nenhum horario/.test(t) ||
    /de jeito nenhum/.test(t) ||
    // "se o Lucas liberar me avise" / "me avisa quando abrir" — same request as
    // "lista de espera" in different words: notify me when a specific slot frees up.
    /\bme avis[ae]\b.{0,30}\b(liberar|abrir|desocupar|vagar|sobrar)\b/.test(t) ||
    /\bse\b.{0,20}\b(liberar|abrir|desocupar|vagar)\b.{0,20}\bavis/.test(t)
  );
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

/** One clock the client can accept with a short yes. "Fica bom?" and "Quer esse?" are the same offer. */
export function assistantOfferedSingleHour(text: string): boolean {
  const t = fold(text.replace(/\[\[MSG\]\]/g, " "));
  if (/\bqual prefere\b/.test(t)) return false;
  if (/\bou seria so com\b/.test(t)) return false;
  if (!/\bfica bom\b/.test(t) && !/\bquer esse\b/.test(t)) return false;
  if (!parseClientTime(text)) return false;
  const marked = text.match(/\b(?:às|as|à)\s*\d{1,2}(?:\s*[:hH]\s*\d{2})?h?\b/gi) ?? [];
  const bare = text.match(/\b\d{1,2}\s*h(?:\d{2})?\b/gi) ?? [];
  const clocks = marked.length > 0 ? marked.length : bare.length;
  return clocks === 1;
}

/** Last assistant offered a single clock ("Posso te encaixar … às 18h. Fica bom?"). */
export function assistantOfferedFitSlot(text: string): boolean {
  const t = fold(text.replace(/\[\[MSG\]\]/g, " "));
  if (!/\bfica bom\b/.test(t)) return false;
  return assistantOfferedSingleHour(text) && (/\bencaixar\b/.test(t) || /\btenho\b/.test(t));
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

/** A barber named now is checked at the hour the client already asked, not at our alternative. */
export function clockForNamedBarber(previousUser: string, draftTime: string): string {
  return (parseClientTime(previousUser) || draftTime || "").slice(0, 5);
}

export function offeredFitClockIfAccepted(params: {
  lastAssistant: string;
  lastUser: string;
}): string | null {
  if (!assistantOfferedSingleHour(params.lastAssistant)) return null;
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

/** Barber + clock + day in the same message. That pin does not swap barbers. */
export function clientPinnedBarberClockAndDay(
  text: string,
  barbers: CatalogBarber[],
  todayIso: string,
): boolean {
  if (!resolveBarberFromText(text, barbers)) return false;
  if (!parseClientTime(text)) return false;
  return Boolean(bookingDateFromUserTurn(text, todayIso));
}

export function acceptsAnyBarber(text: string): boolean {
  const t = fold(text);
  return /\bqualquer (um|barbeiro)\b/.test(t) || /\btanto faz\b/.test(t);
}

export function assistantAskedBarberPreference(text: string): boolean {
  const t = fold(text);
  return /\bou seria so com\b/.test(t);
}

/**
 * Detects when the assistant's last message was a reminder asking for an RSVP
 * (presence confirmation), so a bare "sim"/"estarei aí" reply resolves to
 * confirm_appointment instead of falling through to a generic guard.
 *
 * Must stay in sync with the real templates in outbound/templates.ts
 * (buildReminder24h / buildReminder2h) — the earlier pattern list only matched
 * an imagined copy that was never actually sent, so live RSVP replies never
 * matched here and fell through to unrelated deterministic branches.
 */
export function assistantAskedReminderRsvp(text: string): boolean {
  const t = fold(text);
  return (
    // buildReminder24h (pending)
    /\bvoce confirma sua presenca\b/.test(t) ||
    // buildReminder2h (pending)
    /\bainda nao recebemos sua confirmacao\b/.test(t) ||
    /\bconfirme agora para mantermos seu horario reservado\b/.test(t) ||
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
  /** "hoje" | "amanhã" | "terça" | "sábado" etc. */
  weekdayShort: string;
  barberName: string;
  timeHHmm?: string;
}): string {
  const hi = params.firstName ? `Olá, ${params.firstName}! ` : "Olá! ";
  const service = params.serviceName.trim() || "seu horário";
  const wd = params.weekdayShort;
  const isRelative = /^(hoje|amanhã|amanha)$/.test(wd);
  // "hoje"/"amanhã" don't need a preposition; "sábado/domingo" use "no", others use "na"
  const prep = isRelative ? "" : /^(s[áa]bado|domingo)$/i.test(wd) ? "no " : "na ";
  const timeBit = params.timeHHmm ? ` às ${formatTimePt(params.timeHHmm)}` : "";
  return (
    `${hi}Tudo certo com seu horário para ${service} ${prep}${wd} com o ${params.barberName}${timeBit}? ` +
    `Se quiser cancelar ou reagendar é só me dizer o novo dia e horário.`
  );
}
