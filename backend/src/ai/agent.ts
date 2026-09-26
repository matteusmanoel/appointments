import OpenAI from "openai";
import { pool } from "../db.js";
import * as aiTools from "./tools.js";
import { buildSystemPrompt, normalizeProfile } from "./prompt-builder.js";
import { retrieveKnowledge, buildKnowledgeBlock } from "./rag.js";
import { setConversationPaused } from "./runtime-pause.js";
import {
  getClientMemory,
  buildClientMemoryPromptBlock,
  updateClientMemoryFromAppointmentEvent,
  updateClientMemoryFromConversation,
  clientMemoryTableExists,
  setExplicitPreferredBarberByPhone,
} from "./memory/client-memory.js";
import type { ClientMemoryRow } from "./memory/client-memory.js";
import { sendBarbershopLocationToClient } from "../lib/send-barbershop-location.js";
import { sendStickerToClient } from "../lib/send-sticker-to-client.js";
import { isValidUuid } from "../lib/uuid.js";
import { addDaysIso, alignSpokenHour, formatResumoWhen, formatTimePt, formatWeekCalendarForTools, parseClientTime, pickExecutedToolDate, pickExecutedToolTime, shopOpenStatusNow, shopWindowOnIso, weekdayShortPtFromIso } from "./date-calendar.js";
import type { ClientDateSource } from "./date-calendar.js";
import {
  acceptsAnyBarber,
  acceptsOfferedDay,
  assistantAskedBarberPreference,
  assistantAskedReminderRsvp,
  assistantOfferedNextOpenDay,
  assistantOfferedAltBarberSlot,
  bookingDateFromUserTurn,
  composeHumanConsult,
  draftPatchFromTurn,
  isClientConfirmation,
  isShopHoursQuestion,
  lastAssistantTurnText,
  lastUserTurnText,
  looksLikeAfterTimeIntent,
  looksLikeCancelIntent,
  looksLikeConsultIntent,
  looksLikeHumanHandoff,
  looksLikeFormalMessage,
  looksLikeLocationIntent,
  looksLikePixIntent,
  looksLikePlanIntent,
  looksLikeRescheduleIntent,
  looksLikeSocialGreeting,
  looksLikeWaitlistIntent,
  looksLikeNewBookingIntent,
  looksLikeZeroIntentUnknown,
  offeredAltBarberFromText,
  offeredFitClockIfAccepted,
  prefersNamedBarberOverTime,
  clientPinnedBarberClockAndDay,
} from "./conversation-intents.js";
import {
  applyTurnToDraft,
  composeUnavailableReply,
  composeAskService,
  composeAmbiguousCorte,
  draftIsCloseable,
  emptyBookingDraft,
  inferServiceKeyword,
  loadBookingDraft,
  lockOfferedSlot,
  mergeBookingDraft,
  offeredClockFromUnavailable,
  pickRequestedBarber,
  pickServiceFromCatalog,
  resolveBarberFromText,
  resolveMultipleServicesFromText,
  resolveServiceFromText,
  unknownNamedBarberFromText,
  saveBookingDraft,
  type BookingDraft,
  type CatalogBarber,
  type CatalogService,
} from "./booking-draft.js";
import type { UnavailableReason } from "./slot-fit.js";

type ClientFavoritesResult = Awaited<ReturnType<typeof aiTools.getClientFavoriteServices>>;

function buildOpeningMessage(barbershopName: string): string {
  const n = (barbershopName ?? "").trim() || "barbearia";
  const variants = [
    `Olá! Bem-vindo à ${n}! 😊[[MSG]]Quer ver os serviços disponíveis ou já prefere agendar um horário?`,
    `Oi, tudo bem? Seja bem-vindo à ${n}![[MSG]]Posso ajudar com algum serviço ou prefere já marcar um horário?`,
    `Olá! Seja bem-vindo à ${n}![[MSG]]Gostaria de consultar nossos serviços ou já agendar um horário?`,
  ];
  return variants[Math.floor(Date.now() / 10000) % variants.length]!;
}

type UpcomingApptRow = {
  id: string;
  date: string;
  time: string;
  service_names: string;
  barber_name: string;
  barber_id?: string;
  service_ids?: string[];
  status?: string;
};

function filterUpcomingFromNow(rows: UpcomingApptRow[], dateOnlyStr: string, currentTimeHHmm: string): UpcomingApptRow[] {
  return rows.filter((a) => {
    const d = String(a.date).slice(0, 10);
    if (d > dateOnlyStr) return true;
    if (d < dateOnlyStr) return false;
    const t = String(a.time).slice(0, 5);
    return t >= currentTimeHHmm;
  });
}

function firstNameFromClientName(fullName: string): string {
  const w = fullName.trim().split(/\s+/)[0] ?? "";
  return w || fullName.trim();
}

function parseLocalHourFromSvDateTime(dateTimeStr: string): number {
  const tail = dateTimeStr.includes(" ") ? dateTimeStr.split(" ")[1] ?? "" : dateTimeStr;
  const h = parseInt(tail.slice(0, 2), 10);
  return Number.isFinite(h) ? h : 12;
}

/** Período do dia no fuso da barbearia (para alinhar linguagem ao momento real). */
function describeDayPeriodPt(hour: number): string {
  if (hour >= 5 && hour < 12) return "manhã";
  if (hour >= 12 && hour < 18) return "tarde";
  if (hour >= 18 && hour < 22) return "noite";
  return "madrugada/noite";
}

function formatBusinessHoursSummary(bhRaw: unknown): string {
  const keys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  const labels: Record<(typeof keys)[number], string> = {
    monday: "Segunda",
    tuesday: "Terça",
    wednesday: "Quarta",
    thursday: "Quinta",
    friday: "Sexta",
    saturday: "Sábado",
    sunday: "Domingo",
  };
  const bh = (bhRaw ?? {}) as Record<string, { start?: string; end?: string } | null | undefined>;
  const lines: string[] = [];
  for (const k of keys) {
    const day = bh[k];
    const label = labels[k];
    if (!day || typeof day !== "object") {
      lines.push(`- ${label}: (não configurado no sistema)`);
      continue;
    }
    const s = String(day.start ?? "").slice(0, 5);
    const e = String(day.end ?? "").slice(0, 5);
    if (!s && !e) lines.push(`- ${label}: fechado ou sem expediente`);
    else lines.push(`- ${label}: ${s || "?"}–${e || "?"}`);
  }
  return lines.join("\n");
}

function buildConsumptionSummaryLines(clientMemory: ClientMemoryRow | null, favorites: ClientFavoritesResult | null): string {
  const lines: string[] = [];
  if (favorites?.last?.service_names?.trim()) {
    lines.push(`Último serviço/combo em agendamento passado: *${favorites.last.service_names.trim()}*.`);
  }
  if (favorites?.frequent?.length) {
    const fr = favorites.frequent
      .slice(0, 2)
      .map((f) => `${f.service_names} (${f.count}×)`)
      .join("; ");
    lines.push(`Combinações frequentes (histórico): ${fr}.`);
  }
  if (
    clientMemory &&
    clientMemory.preferred_services?.length &&
    clientMemory.preferred_services_conf >= 0.35
  ) {
    lines.push(`Memória: costuma *${clientMemory.preferred_services.join(" + ")}*.`);
  }
  if (
    clientMemory &&
    clientMemory.preferred_barber_name &&
    clientMemory.preferred_barber_conf >= 0.35
  ) {
    lines.push(
      clientMemory.preferred_barber_conf >= 0.99
        ? `Memória: barbeiro de preferência (explícito): *${clientMemory.preferred_barber_name}*. Ofereça só horários desse barbeiro.`
        : `Memória: barbeiro de preferência (inferido): *${clientMemory.preferred_barber_name}*.`,
    );
  }
  if (
    clientMemory?.last_completed_services?.length &&
    clientMemory.last_completed_at
  ) {
    const days = Math.floor(
      (Date.now() - new Date(clientMemory.last_completed_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days <= 180) {
      lines.push(`Último atendimento concluído: *${clientMemory.last_completed_services.join(" + ")}* (há ~${days} dias).`);
    }
  }
  if (lines.length === 0) {
    return "- Sem histórico suficiente ainda; descubra o serviço com naturalidade se o cliente não disser.";
  }
  return lines.map((l) => `- ${l}`).join("\n");
}

function buildOperationalContextBlock(params: {
  barbershopName: string;
  timeZone: string;
  dateTimeStr: string;
  dateOnlyStr: string;
  clientName: string;
  businessHoursRaw: unknown;
  clientMemory: ClientMemoryRow | null;
  favorites: ClientFavoritesResult | null;
  address?: string | null;
  hasGeoLocation?: boolean;
}): string {
  const hour = parseLocalHourFromSvDateTime(params.dateTimeStr);
  const period = describeDayPeriodPt(hour);
  const hoursBlock = formatBusinessHoursSummary(params.businessHoursRaw);
  const openStatus = shopOpenStatusNow({
    todayIso: params.dateOnlyStr,
    nowHHmm: params.dateTimeStr.slice(-5),
    businessHours: (params.businessHoursRaw ?? null) as Parameters<typeof shopOpenStatusNow>[0]["businessHours"],
  });
  const statusLine = openStatus.open
    ? `Status agora: ABERTO (fecha às ${openStatus.closesAt}).`
    : `Status agora: FECHADO${openStatus.closedAt ? ` (encerrou às ${openStatus.closedAt})` : ""}${
        openStatus.nextOpenWeekdayPt
          ? `; abre de novo ${openStatus.nextOpenWeekdayPt}${openStatus.nextOpensAt ? ` às ${openStatus.nextOpensAt}` : ""}`
          : ""
      }.`;
  const consumption = buildConsumptionSummaryLines(params.clientMemory, params.favorites);
  const nameLine = params.clientName.trim()
    ? `Nome no cadastro: *${params.clientName.trim()}* (use o primeiro nome no tratamento).`
    : `Nome no cadastro: ainda não informado — peça só quando for salvar o agendamento.`;
  const addrLine =
    params.address != null && String(params.address).trim()
      ? `Endereço cadastrado: ${String(params.address).trim()}`
      : `Endereço cadastrado: (não informado — cadastre em Configurações)`;
  const geoLine = params.hasGeoLocation
    ? `Pin de mapa (WhatsApp): disponível — use send_barbershop_location quando o cliente pedir localização ou após confirmar agendamento.`
    : `Pin de mapa (WhatsApp): cadastre latitude e longitude em Configurações para enviar o pin.`;

  return (
    `\n\n--- Contexto operacional (base obrigatória; evite contradições e alucinações) ---\n` +
    `Unidade: *${params.barbershopName}* | Fuso: ${params.timeZone}\n` +
    `Momento da conversa (local): ${params.dateTimeStr} | Data (exibição ao cliente): ${formatDateShortPt(params.dateOnlyStr)} | Período do dia: *${period}*\n` +
    `Calendário (yyyy-MM-dd só nas tools; ao cliente use dd/MM/yyyy ou extenso):\n` +
    `${formatWeekCalendarForTools(params.dateOnlyStr)}\n` +
    `Cliente: ${nameLine} Contato identificado pelo WhatsApp desta conversa (não peça telefone).\n` +
    `${addrLine}\n` +
    `${geoLine}\n\n` +
    `Expediente de referência (configuração da unidade — feriados, folgas e exceções vêm das *tools*; não invente):\n` +
    `${hoursBlock}\n` +
    `${statusLine}\n` +
    `Ao responder sobre horário de funcionamento, use SEMPRE essa linha "Status agora". Nunca recalcule se está aberto a partir da tabela. ` +
    `Se estiver FECHADO, diga que já encerrou e quando reabre. Se a pessoa perguntou quais são os horários, inclua também a tabela de expediente da semana (o bloco acima). ` +
    `Em seguida pergunte qual serviço ela quer para adiantar o agendamento do próximo dia.\n\n` +
    `Histórico / preferências (pistas; se o cliente pedir outra coisa, siga o cliente):\n` +
    `${consumption}\n` +
    `Se usar essas pistas numa mensagem ambígua (ex.: "pode ser" sem contexto), formule sempre como pergunta aberta ` +
    `(ex.: "Notei que você costuma vir à tarde com o Eduardo, quer manter esse padrão ou prefere outro dia e horário?"), ` +
    `nunca como fato encerrado com "certo?"/"não é?". São pistas, não confirmações do cliente nesta conversa.\n` +
    `Ao reengajar um cliente com preferência conhecida, seja direto: afirme o padrão e pergunte só dia e horário, ` +
    `em vez de duas perguntas encadeadas. Evite: "Você gostaria de manter o *Corte masculino* com o *Eduardo*? Se sim, tem alguma data em mente?". ` +
    `Prefira: "Vamos agendar seu horário sim. *Corte masculino* com o *Eduardo*, correto? Qual dia e horário fica bom?".\n` +
    `Depois que confirm_appointment retornar sucesso: responda de forma quente e direta com o nome do cliente, ` +
    `confirmando a presença no formato curto (ex.: "Presença confirmada, Marcelo! Te esperamos quarta, 24/09 às 14h com o Eduardo."). ` +
    `Não use frases genéricas como "Se precisar de mais alguma coisa".\n` +
    `--- fim contexto operacional ---`
  );
}

function stripIdsAndUuids(text: string): string {
  const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  return (text ?? "")
    .replace(/\s*\(ID:\s*[0-9a-f-]{36}\s*\)/gi, "")
    .replace(/\bID:\s*[0-9a-f-]{36}\b/gi, "")
    .replace(uuidRegex, "")
    .trim();
}

/** Remove placeholders internos e vazamentos meta-técnicos antes de exibir ao cliente (WhatsApp). */
export function sanitizeClientFacingReply(text: string): string {
  let t = stripIdsAndUuids(text);
  // Remove qualquer [texto com ferramenta/tool/placeholder]
  t = t.replace(/\[[^\]]*(?:ferramenta|tool|placeholder|informar\s+na\s+ferramenta)[^\]]*\]/gi, "");
  // Remove linha "*Total:* R$ ..." quando contém placeholder ou colchete
  t = t.replace(/\*Total:\*\s*R\$\s*[^\n]*(?:ferramenta|placeholder|\[)/gi, "");
  // Remove R$ [qualquer coisa entre colchetes]
  t = t.replace(/R\$\s*\[[^\]]*\]/gi, "");
  // Remove (valor a ser informado ...) em qualquer forma
  t = t.replace(/\(valor\s+a\s+ser\s+informado[^\)]*\)/gi, "");
  // Remove linha *Total:* vazia (sem valor após sanitização)
  t = t.replace(/^\*Total:\*\s*$/gm, "");
  // Remove linha *Total:* R$ imediatamente seguida de quebra sem valor
  t = t.replace(/\*Total:\*\s*R\$\s*\n/gi, "");
  // Remove URLs de mapas coladas no texto (devem ser enviadas via send_barbershop_location)
  t = t.replace(/https?:\/\/(?:maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps)[^\s]*/gi, "");
  t = t.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "");
  t = t.replace(/^\s*[-*•]\s+/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  // Em dash reads as machine-written; a person would use a comma. Applied last so it also
  // covers text the model wrote despite the prompt rule against it.
  t = t.replace(/\s*—\s*/g, ", ");
  return t;
}

function normalizeLoose(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Normalize connectives and special chars: "e", "+", "&" → all become single space
    // This lets "Corte e Barba", "Corte + Barba", "Corte & Barba" all match each other
    .replace(/\s*[+&]\s*/g, " ")
    .replace(/\s+e\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePhoneRequest(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return /(me passa|pode me passar|manda|informa).{0,30}(telefone|celular|whats)/i.test(t) || /\bseu telefone\b/i.test(t);
}

const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const MAX_EMOJIS_FOR_VIOLATION = 4;

const AI_EXPOSURE_PATTERNS = [
  /pelo que vi[,\s]/i,
  /não\s+consegui\s+(checar|verificar|encontrar|acessar|obter)/i,
  /como\s+(ia|robô|bot|inteligência\s+artificial)\b/i,
  /\bmeu\s+sistema\b/i,
  /\bfui\s+programad[oa]\b/i,
  /\bsou\s+um?\s+(bot|robô|assistente\s+virtual|ia)\b/i,
  /\bnão\s+tenho\s+acesso\s+(a|ao|aos|às)\b/i,
  /\bminhas\s+informações\s+(estão|são)\s+limitadas\b/i,
  // Phrases seen in real-world failure (April 3rd test): error-exposing recovery language
  /houve\s+um\s+problema\s+ao/i,
  /vou\s+verificar\s+novamente/i,
  // Maps URL pasted in text instead of using send_barbershop_location
  /https?:\/\/(?:maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)/i,
  /vou\s+tentar\s+mais\s+uma\s+abordagem/i,
  /parece\s+que\s+tá\s+rolando\s+um\s+bug/i,
  /tô\s+com\s+os\s+horários\s+disponíveis\s+de\s+novo/i,
  // Technical difficulty / failure exposure patterns
  /estou\s+enfrentando\s+dificuldades/i,
  /dificuldades\s+t[eé]cnicas/i,
  /problema\s+t[eé]cnico/i,
  /instabilidade\s+t[eé]cnica/i,
  /n[aã]o\s+consigo\s+finalizar/i,
  /n[aã]o\s+estou\s+conseguindo\s+(finalizar|completar|concluir|agendar)/i,
  /n[aã]o\s+foi\s+poss[ií]vel\s+(completar|finalizar|concluir|agendar)/i,
  /n[aã]o\s+conseguimos\s+agendar/i,
  /n[aã]o\s+consegui\s+validar/i,
  /atendente\s+confere/i,
  /parece\s+que\s+n[aã]o\s+h[aá]\s+agendamentos\s+ativos/i,
  /parece\s+que\s+houve\s+um\s+erro/i,
  /houve\s+um\s+erro\b/i,
  /n[aã]o\s+est[aá]\s+dispon[ií]vel\s+para\s+agendamento/i,
  /n[aã]o\s+consegui\s+processar/i,
  /posso\s+n[aã]o\s+ter\s+entendido/i,
  /um\s+momento,?\s+por\s+favor/i,
  /vou\s+verificar\s+(a\s+disponibilidade|seus\s+agendamentos)/i,
];

/** Returns true if the reply contains phrases that expose the automated nature of the system. */
export function containsAiExposure(reply: string): boolean {
  const t = (reply ?? "").trim();
  return AI_EXPOSURE_PATTERNS.some((re) => re.test(t));
}

function normalizeReplyForCompare(text: string): string {
  return (text ?? "")
    .replace(/\[\[MSG\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Same client-facing text already sent on the previous assistant turn. */
export function replyRepeatsPrevious(reply: string, previous: string): boolean {
  const next = normalizeReplyForCompare(reply);
  const prior = normalizeReplyForCompare(previous);
  return next.length > 0 && next === prior;
}

/** Clocks written as "às 6", "6h" or "06:00". */
export function citedClockHHmm(text: string): string[] {
  const found: string[] = [];
  const re = /(?:às|as)\s+(\d{1,2})(?::(\d{2}))?\s*h?\b|\b(\d{1,2})\s*h\b|\b(\d{2}):(\d{2})\b/gi;
  for (const m of text.matchAll(re)) {
    const hour = Number(m[1] ?? m[3] ?? m[4]);
    const minute = m[2] ?? m[5] ?? "00";
    if (!Number.isFinite(hour) || hour > 23) continue;
    found.push(`${String(hour).padStart(2, "0")}:${minute.padStart(2, "0")}`);
  }
  return found;
}

/** Reply names an hour that the shop window would shift (6h before open → 18h). */
export function replyCitesUnalignedHour(
  userText: string,
  reply: string,
  opensAt: string | null,
  closesAt: string | null,
): boolean {
  return citedClockHHmm(reply).some(
    (hhmm) => alignSpokenHour(userText, hhmm, opensAt, closesAt) !== hhmm,
  );
}

export function composePresenceConfirmed(params: {
  firstName?: string;
  when: string;
  barberName?: string;
}): string {
  const who = params.barberName ? ` com o ${params.barberName}` : "";
  return params.firstName
    ? `Presença confirmada, ${params.firstName}! Te esperamos ${params.when}${who}.`
    : `Presença confirmada! Te esperamos ${params.when}${who}.`;
}

export function composeCancellationReply(params: {
  serviceName?: string;
  when: string;
  barberName?: string;
}): string {
  const service = params.serviceName?.trim() || "Horário";
  const who = params.barberName ? ` com o ${params.barberName}` : "";
  return `${service} de ${params.when}${who} cancelado. Quando quiser remarcar, é só chamar!`;
}

/**
 * Silence beats an error leak or a repeated bubble.
 * Deterministic slot/presence/cancel copy is passed with composed=true so it is not wiped for exposure.
 */
export function guardClientReply(input: {
  reply: string;
  previousAssistant: string;
  userText: string;
  opensAt: string | null;
  closesAt: string | null;
  composed: boolean;
}): string {
  let reply = (input.reply ?? "").trim();
  if (!reply) return "";
  if (!input.composed && containsAiExposure(reply)) return "";
  if (!input.composed && replyCitesUnalignedHour(input.userText, reply, input.opensAt, input.closesAt)) {
    return "";
  }
  if (replyRepeatsPrevious(reply, input.previousAssistant)) return "";
  return reply;
}

/** Text names a service first. If it doesn't, bind the habitual combo/service from memory. */
export function resolveServiceForTurn(
  userText: string,
  memoryNames: string[],
  catalog: CatalogService[],
): { match?: CatalogService; ambiguous?: { simple: CatalogService; combo: CatalogService } } {
  const named = resolveServiceFromText(userText, catalog);
  if (named.match || named.ambiguous) return named;
  const memoryText = memoryNames.map((n) => n.trim()).filter(Boolean).join(" ");
  const fromMemory = memoryText ? resolveServiceFromText(memoryText, catalog) : {};
  return fromMemory.match ? { match: fromMemory.match } : named;
}

/** Returns list of violation codes for simulation/quality checks. */
export function detectViolations(reply: string): string[] {
  const out: string[] = [];
  const t = (reply ?? "").trim();
  if (looksLikePhoneRequest(t)) out.push("phone_ask");
  if (UUID_REGEX.test(t)) out.push("uuid_leak");
  const emojis = t.match(EMOJI_REGEX);
  if (emojis != null && emojis.length > MAX_EMOJIS_FOR_VIOLATION) out.push("excessive_emojis");
  if (containsAiExposure(t)) out.push("ai_exposure");
  return out;
}

function isOutOfScopeFood(text: string): boolean {
  const t = normalizeLoose(text);
  return /\bpizza|pizzaria|hamburguer|lanche|acai\b/.test(t);
}

function extractAskedService(text: string): string | null {
  const t = normalizeLoose(text);
  const m =
    t.match(/\b(voce|voces)\s+tem\s+(.+?)\??$/) ||
    t.match(/\btem\s+(.+?)\??$/) ||
    t.match(/\bfaz(em)?\s+(.+?)\??$/);
  const raw = (m?.[2] ?? m?.[1] ?? "").trim();
  if (!raw) return null;
  return raw.length > 80 ? raw.slice(0, 80) : raw;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function extractTimeFromText(text: string): string | null {
  return parseClientTime(text);
}

/** Converte yyyy-MM-dd para dd/MM/yyyy (exibição ao cliente). */
export function formatDateShortPt(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0] ?? "", 10);
  const m = parseInt(parts[1] ?? "", 10);
  const d = parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr;
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

export type AvailableSlotSummary = {
  serviceName: string;
  barberName: string;
  dateIso: string;
  timeHHmm: string;
  totalPrice: number;
  timeZone?: string;
  firstName?: string;
  todayIso?: string;
};

/** Resumo + pedido de confirmação. Nunca cria o agendamento. */
export function composeAvailableSlotConfirm(slot: AvailableSlotSummary): string {
  const when = formatResumoWhen(slot.dateIso, slot.timeHHmm, slot.todayIso ?? "");
  const price = Number(slot.totalPrice).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const hi = slot.firstName ? `${slot.firstName}, fica assim, então:\n\n` : `Fica assim, então:\n\n`;
  return (
    `${hi}` +
    `✂️ *${slot.serviceName}*\n` +
    `💈 *${slot.barberName}*\n` +
    `📅 ${when}\n` +
    `💰 ${price}[[MSG]]` +
    `Posso confirmar?`
  );
}

/**
 * composeAvailableSlotConfirm() above is a deterministic template (never LLM-authored),
 * so a prompt-only instruction can't make it disclose a barber substitution. When the
 * client names a specific barber in this turn ("com o João") who isn't on the roster and
 * we silently offer someone else instead, every call site that builds a confirm card must
 * wrap its output with this so the swap is said first, as its own leading bubble — never
 * confirmed as if the client had asked for that barber.
 */
export function withBarberSubstitutionDisclosure(
  reply: string,
  rawUserText: string,
  barbers: CatalogBarber[],
  offeredBarberName: string,
): string {
  const unknownRequested = unknownNamedBarberFromText(rawUserText, barbers);
  if (!unknownRequested) return reply;
  if (normalizeLoose(offeredBarberName).includes(normalizeLoose(unknownRequested))) return reply;
  return `Não temos o ${unknownRequested} na equipe, mas o ${offeredBarberName} tem esse horário livre[[MSG]]${reply}`;
}

export function looksLikeBookingConfirmationAsk(reply: string): boolean {
  return /\bposso confirmar\b|\bconfirmo (pra|para) voc|\bposso marcar\b|\bfica assim\b/i.test(reply ?? "");
}

type CheckAvailabilitySnapshot = {
  available: boolean;
  date: string;
  time: string;
  barberName: string;
  barberId: string;
  serviceName: string;
  serviceIds: string[];
  totalPrice: number;
  whyUnavailable: string | null;
  unavailableReason: UnavailableReason | null;
  lastFit: { time: string; barber_id?: string; barber_name?: string } | null;
  sameTimeOthers: Array<{ barber_id?: string; barber_name?: string }>;
  weekdayPt: string | null;
  opensAt: string | null;
  nextOpenDate: string | null;
  nextOpenWeekdayPt: string | null;
  alternatives: Array<{ time: string; barber_id?: string; barber_name?: string }>;
};

function snapshotCheckAvailability(result: unknown, preferredBarberId?: string): CheckAvailabilitySnapshot | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const requested = (r.requested ?? null) as
    | { available?: boolean; barbers?: Array<{ barber_name?: string; barber_id?: string }> }
    | null;
  const services = Array.isArray(r.services)
    ? (r.services as Array<{ name?: string; service_id?: string }>)
    : [];
  const debug = (r.debug ?? null) as { evaluated_barbers?: Array<{ barber_name?: string; barber_id?: string }> } | null;
  const candidates = [
    ...(Array.isArray(requested?.barbers) ? requested.barbers : []),
    ...(Array.isArray(debug?.evaluated_barbers) ? debug.evaluated_barbers : []),
  ];
  const alternatives = Array.isArray(r.alternatives)
    ? (r.alternatives as Array<{ time?: string; barber_id?: string; barber_name?: string }>)
        .filter((a) => typeof a?.time === "string" && /^\d{2}:\d{2}/.test(a.time))
        .map((a) => ({
          time: String(a.time).slice(0, 5),
          ...(typeof a.barber_id === "string" ? { barber_id: a.barber_id } : {}),
          ...(typeof a.barber_name === "string" ? { barber_name: a.barber_name } : {}),
        }))
    : [];
  const sameTimeOthers = Array.isArray(r.same_time_other_barbers)
    ? (r.same_time_other_barbers as Array<{ barber_id?: string; barber_name?: string }>)
    : [];
  const lastFitRaw = r.last_fit && typeof r.last_fit === "object" ? (r.last_fit as Record<string, unknown>) : null;
  const lastFitTime = typeof lastFitRaw?.time === "string" ? String(lastFitRaw.time).slice(0, 5) : "";
  const lastFit =
    lastFitRaw && /^\d{2}:\d{2}$/.test(lastFitTime)
      ? {
          time: lastFitTime,
          ...(typeof lastFitRaw.barber_id === "string" ? { barber_id: lastFitRaw.barber_id } : {}),
          ...(typeof lastFitRaw.barber_name === "string" ? { barber_name: lastFitRaw.barber_name } : {}),
        }
      : null;
  const lastFitBarbers = lastFit
    ? [{ barber_id: lastFit.barber_id, barber_name: lastFit.barber_name }]
    : [];
  const picked = pickRequestedBarber(
    [
      ...candidates,
      ...lastFitBarbers,
      ...alternatives.map((a) => ({ barber_id: a.barber_id, barber_name: a.barber_name })),
    ],
    preferredBarberId,
  );
  const barberId = (
    (preferredBarberId && isValidUuid(preferredBarberId) ? preferredBarberId : picked?.barber_id) ?? ""
  ).trim();
  const barberName = (picked?.barber_name ?? "").trim();
  const preferredAvailable =
    preferredBarberId && isValidUuid(preferredBarberId)
      ? (requested?.barbers ?? []).some((b) => b.barber_id === preferredBarberId)
      : requested?.available === true && Array.isArray(requested?.barbers) && requested.barbers.length > 0;
  const available =
    preferredBarberId && isValidUuid(preferredBarberId)
      ? preferredAvailable
      : requested?.available === true && Array.isArray(requested?.barbers) && requested.barbers.length > 0;
  const serviceName = services.map((s) => String(s?.name ?? "").trim()).filter(Boolean).join(" + ");
  const serviceIds = services
    .map((s) => String(s?.service_id ?? "").trim())
    .filter((id) => isValidUuid(id));
  const date = String(r.date ?? "");
  const time = String(r.time ?? "").slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const reasonRaw = String(r.unavailable_reason ?? "");
  const unavailableReason: UnavailableReason | null =
    reasonRaw === "closed" || reasonRaw === "hours_overflow" || reasonRaw === "occupied" || reasonRaw === "past"
      ? reasonRaw
      : null;
  return {
    available,
    date,
    time,
    barberName,
    barberId,
    serviceName,
    serviceIds,
    totalPrice: Number(r.total_price ?? 0),
    whyUnavailable: typeof r.why_unavailable === "string" ? r.why_unavailable : null,
    unavailableReason,
    lastFit,
    sameTimeOthers,
    weekdayPt: typeof r.weekday_pt === "string" ? r.weekday_pt : null,
    opensAt: /^\d{2}:\d{2}/.test(String(r.shop_open ?? "")) ? String(r.shop_open).slice(0, 5) : null,
    nextOpenDate: typeof r.next_open_date === "string" ? r.next_open_date : null,
    nextOpenWeekdayPt: typeof r.next_open_weekday_pt === "string" ? r.next_open_weekday_pt : null,
    alternatives,
  };
}

function catalogFromUnknown(raw: unknown): CatalogService[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const s = row as Record<string, unknown>;
      return {
        id: String(s.id ?? ""),
        name: String(s.name ?? ""),
        category: typeof s.category === "string" ? s.category : undefined,
        price: Number(s.price ?? 0),
      };
    })
    .filter((s) => isValidUuid(s.id) && s.name.trim());
}

function catalogBarbersFromUnknown(raw: unknown): CatalogBarber[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const b = row as Record<string, unknown>;
      return { id: String(b.id ?? ""), name: String(b.name ?? "") };
    })
    .filter((b) => isValidUuid(b.id) && b.name.trim());
}

function idsKnownToCatalog(ids: unknown, catalog: Array<{ id: string }>): string[] {
  if (!Array.isArray(ids)) return [];
  const known = new Set(catalog.map((item) => item.id));
  return ids.map((id) => String(id)).filter((id) => known.has(id));
}

function idKnownToCatalog(id: unknown, catalog: Array<{ id: string }>): string | undefined {
  const value = typeof id === "string" ? id : "";
  return catalog.some((item) => item.id === value) ? value : undefined;
}

function draftPatchFromSnap(snap: CheckAvailabilitySnapshot): Partial<BookingDraft> {
  const overflowFit =
    (snap.unavailableReason === "hours_overflow" || snap.unavailableReason === "past") && snap.lastFit
      ? snap.lastFit
      : null;
  return {
    date: snap.date,
    time: offeredClockFromUnavailable({
      requestedTime: snap.time,
      reason: snap.unavailableReason,
      lastFitTime: overflowFit?.time,
    }),
    barber_id: overflowFit?.barber_id || snap.barberId || undefined,
    barber_name: overflowFit?.barber_name || snap.barberName || undefined,
    service_ids: snap.serviceIds,
    service_name: snap.serviceName || undefined,
    total_price: snap.totalPrice,
  };
}

function occupiedCopyFromSnap(
  snap: CheckAvailabilitySnapshot,
  todayIso?: string,
  holdRequestedBarber?: boolean,
): string {
  const sameBarber = snap.alternatives.filter((a) => !a.barber_id || !snap.barberId || a.barber_id === snap.barberId);
  const alts = (sameBarber.length && !snap.sameTimeOthers.length ? sameBarber : snap.alternatives).slice(0, 2);
  const barberName =
    snap.barberName.trim() ||
    alts.find((a) => a.barber_name)?.barber_name ||
    "";
  return composeUnavailableReply({
    reason: snap.unavailableReason,
    barberName,
    timeHHmm: snap.time,
    alternatives: alts,
    sameTimeOthers: snap.sameTimeOthers,
    weekdayPt: snap.weekdayPt ?? undefined,
    nextOpenWeekdayPt: snap.nextOpenWeekdayPt,
    lastFitTime: snap.lastFit?.time,
    lastFitBarberName: snap.lastFit?.barber_name,
    isToday: Boolean(todayIso && snap.date === todayIso),
    opensAt: snap.opensAt,
    holdRequestedBarber,
  });
}

export function isUsableClientName(name: string | undefined): boolean {
  const t = (name ?? "").trim();
  if (t.length < 2) return false;
  const folded = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (folded === "cliente") return false;
  if (/^(undefined|null|nan|none|desconhecido)$/.test(folded)) return false;
  if (/^(por gentileza|gentileza|por favor|obrigado|obrigada|sim|ok|pode)$/.test(folded)) return false;
  // Reject barber-preference phrases that were mistakenly captured/stored as a
  // client name (e.g. a stale "Com Qualquer Barbeiro" row) — these are never
  // real names, whether they come from the current message or from the DB.
  if (/\bqualquer\b/.test(folded) || /\btanto faz\b/.test(folded)) return false;
  return true;
}

function foldName(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/** Tool args never choose another phone. "undefined" stays on the inbound number. */
export function resolveToolClientPhone(argsPhone: unknown, inboundPhone: string): string {
  const inbound = (inboundPhone ?? "").trim();
  const raw = typeof argsPhone === "string" ? argsPhone.trim() : "";
  if (!raw || /^(undefined|null|nan)$/i.test(raw)) return inbound;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return inbound;
  return inbound || raw;
}

function matchesUnconfirmedPush(name: string, pushName?: string | null): boolean {
  const push = (pushName ?? "").trim();
  if (!push) return false;
  const a = foldName(name);
  const b = foldName(push);
  if (!a || !b) return false;
  if (a === b) return true;
  const pushFirst = b.split(" ")[0] ?? "";
  return pushFirst.length > 2 && a === pushFirst;
}

/**
 * Name used to close a booking. A name the person just said wins.
 * A stored name only counts when name_confirmed is true and it is not the WhatsApp push label.
 */
export function confirmedPersonName(params: {
  statedThisTurn?: string;
  storedName?: string;
  nameConfirmed: boolean;
  pushName?: string | null;
}): string {
  const stated = (params.statedThisTurn ?? "").trim();
  if (isUsableClientName(stated)) return stated;
  if (!params.nameConfirmed) return "";
  const stored = (params.storedName ?? "").trim();
  if (!isUsableClientName(stored)) return "";
  if (matchesUnconfirmedPush(stored, params.pushName)) return "";
  return stored;
}

/** Open booking draft beats reminder RSVP. Presence is only the reminder reply. */
export function bookingDraftBlocksPresence(params: {
  draftStatus: string;
  lastAssistantWasReminder: boolean;
}): boolean {
  if (params.lastAssistantWasReminder) return false;
  return params.draftStatus === "offered" || params.draftStatus === "awaiting_name";
}

export function replyDeniesUpcoming(reply: string): boolean {
  const t = foldName(reply);
  return /nao ha agendamento|nao ha horario futuro|nenhum agendamento|nao encontrei agendamento/.test(t);
}

export function replyAsksForService(reply: string): boolean {
  const t = foldName(reply);
  return /qual servi[cç]o|que servi[cç]o|qual horario|em que dia/.test(t);
}

/** Native or text PIX already left the chat. The assistant bubble must not repeat the key. */
export function replyWithoutPixEcho(reply: string, pixKey: string): string {
  const key = (pixKey ?? "").trim();
  if (!key) return reply;
  const digits = key.replace(/\D/g, "");
  const hasKey = reply.includes(key) || (digits.length >= 8 && reply.includes(digits));
  if (!hasKey && !/chave pix/i.test(reply)) return reply;
  return "Te mandei a chave PIX aqui.";
}

export function composeBookingCreated(params: {
  firstName: string;
  serviceName: string;
  when: string;
  barberName?: string;
}): string {
  const barber = params.barberName?.trim();
  const waiting = barber ? ` ${barber.split(/\s+/)[0]} estará esperando você.` : "";
  return `Agendado, ${params.firstName}. ${params.serviceName}, ${params.when}.${waiting} Confirme quando receber o lembrete.`;
}

export function composeRescheduleAsk(params: {
  firstName?: string;
  serviceName: string;
  when: string;
  barberName?: string;
  nextWhen: string;
}): string {
  const hi = params.firstName ? `${params.firstName}, ` : "";
  const who = params.barberName ? ` com o ${params.barberName.split(/\s+/)[0]}` : "";
  return `${hi}você tem ${params.serviceName} ${params.when}${who}. Quer que eu mude para ${params.nextWhen}?`;
}

export function composeRemarcarFromLast(params: {
  firstName?: string;
  serviceName: string;
  barberName?: string;
  timeHHmm: string;
}): string {
  const hi = params.firstName ? `${params.firstName}, ` : "";
  const who = params.barberName ? ` com o ${params.barberName.split(/\s+/)[0]}` : "";
  return `${hi}o último foi ${params.serviceName}${who}, por volta das ${formatTimePt(params.timeHHmm)}. Quer remarcar nesse horário?`;
}

/** IDs the model may pass to confirm_appointment this turn. */
export function allowedConfirmAppointmentIds(
  upcoming: Array<{ id: string; status?: string | null }>,
  listedThisTurn: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const id of listedThisTurn) {
    if (isValidUuid(id)) ids.add(id);
  }
  for (const a of upcoming) {
    if ((a.status === "pending" || a.status === "confirmed") && isValidUuid(a.id)) ids.add(a.id);
  }
  return ids;
}

function askClientNameReply(): string {
  return "Para confirmar, qual seu nome?";
}

function extractNameFromText(text: string): string | null {
  const raw = (text ?? "").replace(/\p{Extended_Pictographic}/gu, " ").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const m = raw.match(
    /\b(meu\s+nome\s+(é|e)|sou\s+(o|a)?|aqui\s+é|me\s+chamo)\s+([A-Za-zÀ-ÖØ-öø-ÿ' ]{2,40})/i
  );
  const candidate = (m?.[4] ?? "").trim();
  if (!candidate) return null;
  const cleaned = candidate.replace(/\s{2,}/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(cleaned)) return null;
  if (cleaned.split(" ").filter(Boolean).length > 4) return null;
  return cleaned;
}

function formatTopServicesForWhatsapp(
  services: Array<{ name: string; price: number; duration_minutes: number }>,
  max = 4
): string {
  return services
    .slice(0, max)
    .map((s, i) => `${i + 1}. *${s.name}* - R$ ${Number(s.price).toFixed(2).replace(".", ",")} (${s.duration_minutes} min)`)
    .join("\n");
}

/** Detects if an assistant message asked the client for their name (deterministic + LLM). */
export function assistantMessageAskedForName(assistantContent: string): boolean {
  const t = (assistantContent ?? "").toLowerCase();
  return /(qual.{0,24}seu\s+nome|me\s+diz(e)?\s+seu\s+nome|seu\s+nome\s+pra\s+salvar|pra\s+salvar.*nome|como\s+[eé]\s+seu\s+nome|informe?\s+seu\s+nome)/i.test(
    t
  );
}

export const DEFAULT_SYSTEM_PROMPT = `Você é o atendente da "{{BARBERSHOP_NAME}}". Timezone: {{TIMEZONE}} | Agora: {{DATE_NOW}} | Hoje: {{TODAY_DATE_BR}} | Amanhã: {{TOMORROW_DATE_BR}}
Detalhes de tom e emoji vêm do bloco "Estilo (perfil do agente)" quando existir; senão, seja direto e humano no WhatsApp (mensagens curtas, máx. 1 emoji).
Sem dados reais das tools para responder: retorne string vazia (handoff).

Regra de contexto: use o bloco "Contexto operacional" e a linha "Estado desta conversa". Nunca invente horários de funcionamento, endereços ou disponibilidade — esses dados vêm sempre das tools.

Datas ao cliente: formato curto "dia dd/MM às HHh" (ex.: Quarta, 24/09 às 14h) ou "hoje/amanhã às HHh". Proibido data por extenso ou yyyy-MM-dd ao cliente. Datas relativas: use o calendário do contexto operacional; não some dias de cabeça. Tool disser fechado: cite o dia retornado (next_open_date), não o dia pedido.

Abertura (oi/olá/bom dia/boa tarde/boa noite)
Use exatamente: "{{OPENING_MESSAGE}}"
Proibido: "Como posso ajudar?" / "Estou aqui para ajudar" / qualquer outra variação.
Se "Próximos agendamentos deste contato" existir: cumprimente pelo nome e confirme/ofereça reagendar, não use a abertura genérica.

--- INTENTS → AÇÃO ---
Leia o último turno do cliente junto com o estado da conversa. Não invente intenção.

· reminder_rsvp_pending + afirmação de presença → confirm_appointment com appointment_id da lista (chame list_client_upcoming_appointments se ainda não tiver o id). Nunca create_appointment: o pending já ocupa o slot.
· offer_awaiting_confirm + afirmação ou cortesia → create_appointment. Cortesia não é nome. Sem nome de pessoa: pergunte "Para confirmar, qual seu nome?" e só então crie.
· awaiting_name → o próximo dado é o nome da pessoa. "Meu nome é X" corrige o cadastro; não reabre o fluxo nem diz que não entendeu.
· Consultar / meu horário → use o bloco de próximos agendamentos; se vazio (no_upcoming), diga que não há horário.
· Cancelar → list_client_upcoming_appointments se precisar do id → cancel_appointment. Sem horário ativo: informe isso; não chame cancel de novo.
· Reagendar → list_client_upcoming_appointments → check_availability do novo slot → resumo → após sim, reschedule_appointment (não troca serviço).
· PIX / pagar / débito / acerto → send_shop_pix. Cobrança mensal de plano → send_pix_plan_charge.
· Planos / assinatura / mensalidade → list_plans antes de responder; "quero pagar/assinar" também send_shop_pix, sem abrir corte.
· Fila / me avise se liberar → add_to_waitlist. Localização → send_barbershop_location (máx. 1). Expediente → contexto operacional, sem recalcular. Humano → string vazia (handoff).
· Serviço + data/hora → check_availability. Sem hora → get_next_slots. service_ids: UUID do combo se existir; senão combine UUIDs. Não invente UUID.
· Hora falada de 1 a 8, sem "da manhã", antes da abertura = mesmo horário à tarde (às 6 com abertura às 9h = 18h).

--- FLUXOS CANÔNICOS ---
AGENDAR: check_availability ou get_next_slots → resumo *Serviço* | *Barbeiro* | Dia dd/MM às HHh | R$ X,XX + "Posso confirmar?" → sem nome, peça o nome → create_appointment.
Após create_appointment com sucesso: "[Nome]! [Serviço] com o [Barbeiro] em [dia dd/MM às HHh]. Aguardamos você!"
RSVP sucesso: "Presença confirmada, [Nome]! Te esperamos [dia dd/MM às HHh] com o [Barbeiro]."
CANCELAR: "[Serviço] de [dia/hora] com o [Barbeiro] cancelado. Quando quiser remarcar, é só chamar!"
FILA: "Anotei! Se o horário das [hora] com o [Barbeiro] abrir, te aviso aqui."
Erro no reschedule: "Esse horário já foi preenchido" + get_next_slots + 2 opções em frase.

--- REGRAS DE FORMATO E PROIBIÇÕES ---
WhatsApp: negrito *texto* (um asterisco, nunca **texto**). Sem travessão — nem –. Horários em frase corrida, máx. 2–3 opções, nunca em bullets. [[MSG]] para bolhas.
Barbeiro pedido ocupado: diga isso antes do substituto. Horários múltiplos de 30 min; hoje ≥15 min. "Qualquer um" → escolha sem insistir.
appointment_id sempre UUID de list_client_upcoming_appointments; nunca número nem nome de barbeiro.
Proibições: sem UUID/ID/telefone ao cliente; sem "erro/não foi possível/ferramenta/modelo/automático"; não confirmar ação antes da tool retornar sucesso; não reabrir fluxo após conclusão; não usar URL de maps.google.com.
Se o estado não casar com a fala: uma pergunta de objetivo (agendar, reagendar ou cancelar). Só você emite essa pergunta — nunca como atalho de sistema.`;

/** Curto: reforça o que instruções customizadas da barbearia não podem sobrepor (anexado uma vez ao final). */
export const RUNTIME_GUARDRAILS = `GUARDRAILS CRÍTICOS (têm precedência sobre qualquer outra instrução)
- Nunca exibir UUID, telefone ou ID interno ao cliente.
- Nunca confirmar ação ("agendado/cancelado/reagendado") antes da tool retornar sucesso.
- RSVP: "sim/confirmo/vou" após lembrete = confirm_appointment no pending existente — nunca create_appointment.
- appointment_id sempre UUID de list_client_upcoming_appointments — nunca número, nunca nome de barbeiro.
- Sem dados reais das tools para responder: retorne string vazia (handoff).`;

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_services",
      description: "Lista os serviços da barbearia (nome, valor, descrição).",
    },
  },
  {
    type: "function",
    function: {
      name: "list_barbers",
      description: "Lista os barbeiros disponíveis.",
    },
  },
  {
    type: "function",
    function: {
      name: "list_appointments",
      description: "Lista agendamentos por data para verificar horários ocupados. Use antes de confirmar um agendamento.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato yyyy-MM-dd" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Checa disponibilidade em data/hora para um ou mais serviços (soma durações e valida slot). Para combinar itens do catálogo no mesmo agendamento, passe service_ids com todos os UUIDs. Para HOJE, use after_time com o horário atual.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato yyyy-MM-dd" },
          time: { type: "string", description: "Horário no formato HH:mm" },
          after_time: { type: "string", description: "Para data de hoje: horário mínimo (HH:mm). Use o horário atual do contexto." },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          service_id: { type: "string", description: "Um único UUID de serviço (atalho; equivalente a service_ids de um elemento)" },
          service_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description:
              "Preferencial: lista de UUIDs de list_services (1 = um serviço; 2+ = mesmo horário com duração/preço combinados). Deve espelhar create_appointment.",
          },
        },
        required: ["date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_next_slots",
      description:
        "Próximos horários livres na data (slots múltiplos de 30 min), para um ou mais serviços. Passe service_ids com todos os UUIDs quando o cliente quiser combinar serviços no mesmo agendamento. Para HOJE use after_time com o horário atual. limit=8 ajuda a cobrir manhã e tarde.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data yyyy-MM-dd" },
          service_id: { type: "string", description: "Um único UUID (atalho)" },
          service_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "UUIDs de list_services para o pacote desejado (um ou vários no mesmo slot)",
          },
          after_time: { type: "string", description: "Quando a data for hoje: horário mínimo HH:mm (use o horário atual do contexto)" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          limit: { type: "number", description: "Máximo de slots a retornar (padrão 10)" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_client",
      description: "Buscar ou criar cliente por telefone. Retorna id, name, phone.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Telefone do cliente" },
          name: { type: "string", description: "Nome do cliente" },
          notes: { type: "string", description: "Observações" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_appointment",
      description:
        "Cria um agendamento (um slot). Obrigatório informar serviço(s): use **service_ids** com um ou mais UUIDs de list_services — para combinar itens (ex.: corte + barba), inclua todos os IDs no array. Alternativa: **service_id** quando for apenas um serviço. Os mesmos IDs devem ter sido usados em check_availability/get_next_slots. Só chame após confirmação explícita do cliente.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do topo)" },
          client_name: { type: "string", description: "Nome do cliente (opcional)" },
          barber_id: { type: "string", description: "ID do barbeiro (UUID)" },
          service_id: { type: "string", description: "Um único serviço (UUID); omita se usar service_ids" },
          service_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description:
              "Lista de UUIDs: um elemento = um serviço; vários = mesmo horário com duração e preço combinados (ordem: lista de list_services)",
          },
          date: { type: "string", description: "Data yyyy-MM-dd" },
          time: { type: "string", description: "Horário HH:mm" },
          notes: { type: "string", description: "Observações" },
        },
        required: ["client_phone", "barber_id", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_upcoming_appointments",
      description: "Lista os próximos agendamentos do cliente (pelo telefone). Use quando o cliente quiser cancelar, reagendar ou confirmar presença. Inclui status pending/confirmed.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
        },
        required: ["client_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela um agendamento. Use o id retornado por list_client_upcoming_appointments e o telefone do cliente.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "UUID do agendamento" },
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
        },
        required: ["appointment_id", "client_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description:
        "Reagenda um agendamento existente (mesmo registro no sistema) para nova data/hora e opcionalmente outro barbeiro. O appointment_id deve vir de list_client_upcoming_appointments. Não altera serviços nem preço — só data/hora/barbeiro. Não use para criar agendamento novo. Use check_availability antes se precisar validar horário.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "UUID do agendamento" },
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
          date: { type: "string", description: "Nova data yyyy-MM-dd" },
          time: { type: "string", description: "Novo horário HH:mm" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
        },
        required: ["appointment_id", "client_phone", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_appointment",
      description:
        "Confirma presença (RSVP) de um agendamento pending. O horário já está reservado desde o create_appointment. Use após lembrete quando o cliente disser sim/confirmo. Não cria um agendamento novo.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "UUID do agendamento (list_client_upcoming_appointments)" },
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
        },
        required: ["appointment_id", "client_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_barbershop_location",
      description:
        "Envia pelo WhatsApp o pin de localização da barbearia (requer latitude/longitude cadastradas). CHAME NO MÁXIMO UMA VEZ por pedido/conversa — se already_sent=true na resposta, NÃO chame de novo. Não repita nem inclua link de mapa na mensagem em texto — o cliente recebe o pin pelo app.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
        },
        required: ["client_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_sticker",
      description:
        "Envia uma figurinha (sticker) humanizada pelo WhatsApp. Chame APENAS se stickers estiverem habilitados e NO MÁXIMO UMA VEZ por conversa — idealmente após confirmação de agendamento ou saudação calorosa. Não chame em respostas informativas simples.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_plans",
      description:
        "Lista os planos de assinatura disponíveis na barbearia (nome, serviços incluídos, preço, ciclo de cobrança). Chame quando o cliente perguntar sobre planos, assinaturas ou mensalidades.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "subscribe_client_to_plan",
      description:
        "Assina o cliente a um plano de serviços recorrentes. SOMENTE após confirmação explícita do cliente. Registra a assinatura e agenda a primeira cobrança PIX.",
      parameters: {
        type: "object",
        properties: {
          plan_id: { type: "string", description: "UUID do plano escolhido (obtido via list_plans)" },
          billing_day: { type: "number", description: "Dia do mês para cobrança recorrente (1-28, padrão: dia atual)" },
        },
        required: ["plan_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_pix_plan_charge",
      description:
        "Envia cobrança PIX de plano (assinatura). Não use para chave avulsa da loja — nesse caso use send_shop_pix.",
      parameters: {
        type: "object",
        properties: {
          subscription_id: { type: "string", description: "UUID da assinatura (obtido via subscribe_client_to_plan)" },
        },
        required: ["subscription_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_plan",
      description:
        "Assinatura ativa deste contato, com cobrança pendente se houver. Use antes de dizer que o plano não existe. Depois chame send_pix_plan_charge com o subscription_id.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "send_shop_pix",
      description:
        "Envia a chave PIX da loja (débito, plano ou acerto avulso). Independente de agendamento, serviço ou valor. Não chama confirm_appointment.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_client_notes",
      description:
        "Persiste uma observação sobre o cliente para uso futuro. Use quando o cliente revelar preferência, restrição, contexto pessoal ou qualquer informação útil para atendimentos futuros. Máximo 120 caracteres por chamada.",
      parameters: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Observação curta e factual em português (máx. 120 caracteres)",
          },
        },
        required: ["note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_waitlist",
      description:
        "Fila de um relógio (data + hora + serviço). Barbeiro opcional. Só quando o cliente insiste naquele horário ou o barbeiro preferido não tem outro slot.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
          client_name: { type: "string", description: "Nome do cliente (opcional)" },
          desired_date: { type: "string", description: "Data yyyy-MM-dd" },
          desired_time: { type: "string", description: "Hora HH:mm" },
          service_id: { type: "string", description: "UUID do serviço" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          notes: { type: "string", description: "Observacoes extras (opcional)" },
        },
        required: ["client_phone", "desired_date", "desired_time", "service_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_branch",
      description: "Quando há várias filiais e o cliente escolheu uma, registra a filial para esta conversa. Chame com o barbershop_id da filial escolhida (use a lista de filiais informada no contexto).",
      parameters: {
        type: "object",
        properties: {
          barbershop_id: { type: "string", description: "UUID da filial escolhida pelo cliente" },
        },
        required: ["barbershop_id"],
      },
    },
  },
];

const MAX_MEMORY_MESSAGES = 10;

/** Prefer a second slot with different barber or different time when possible. */
function pickPairPreferDistinctBarbers(
  candidates: Array<{ time: string; barber_name?: string }>,
  _allSlots: Array<{ time: string; barber_name?: string }>
): Array<{ time: string; barber_name?: string }> {
  if (candidates.length === 0) return [];
  const first = candidates[0]!;
  if (candidates.length === 1) return [first];
  const distinctBarber = candidates.find(
    (s) => s !== first && s.time !== first.time && (s.barber_name || "") !== (first.barber_name || "")
  );
  if (distinctBarber) return [first, distinctBarber];
  const otherTime = candidates.find((s) => s !== first && s.time !== first.time);
  if (otherTime) return [first, otherTime];
  return [first, candidates[1]!];
}

/** Pick up to 2 slots for conversational presentation: prefer one morning (< 12h) and one afternoon (>= 13h).
 *  Falls back to the first two available slots if no clear morning/afternoon split. */
function pickMorningAfternoon(
  slots: Array<{ time: string; barber_id?: string; barber_name?: string }>
): Array<{ time: string; barber_name?: string }> {
  const morning = slots.find((s) => {
    const h = parseInt(String(s.time ?? "00:00").split(":")[0], 10);
    return h < 12;
  });
  const afternoon = slots.find((s) => {
    const h = parseInt(String(s.time ?? "00:00").split(":")[0], 10);
    return h >= 13;
  });
  if (morning && afternoon) return [morning, afternoon];
  if (morning) {
    const rest = slots.filter((s) => s !== morning);
    const second = rest.find(
      (s) => (s.barber_name || "") !== (morning.barber_name || "") && s.time !== morning.time
    ) ?? rest.find((s) => s.time !== morning.time) ?? rest[0];
    return second ? [morning, second] : [morning];
  }
  if (afternoon) return [afternoon];
  return pickPairPreferDistinctBarbers(slots, slots).slice(0, 2);
}

function pickAfternoon(slots: Array<{ time: string; barber_name?: string }>): Array<{ time: string; barber_name?: string }> {
  const afternoon = slots.filter((s) => {
    const h = parseInt(String(s.time ?? "00:00").split(":")[0], 10);
    return h >= 12;
  });
  if (afternoon.length === 0) return slots.slice(0, 2);
  return pickPairPreferDistinctBarbers(afternoon, slots).slice(0, 2);
}

function pickMorning(slots: Array<{ time: string; barber_name?: string }>): Array<{ time: string; barber_name?: string }> {
  const morning = slots.filter((s) => {
    const h = parseInt(String(s.time ?? "00:00").split(":")[0], 10);
    return h < 12;
  });
  if (morning.length === 0) return slots.slice(0, 2);
  return pickPairPreferDistinctBarbers(morning, slots).slice(0, 2);
}

/** Format a morning/afternoon slot pair into a conversational suggestion. */
function formatSlotSuggestion(
  slots: Array<{ time: string; barber_name?: string }>,
  dayLabel: string
): string {
  if (slots.length === 0) return "";
  if (slots.length === 1) {
    const s = slots[0];
    return `${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} tenho às *${formatTimePt(s.time)}*${s.barber_name ? ` com ${s.barber_name}` : ""}. Quer esse horário?`;
  }
  const [a, b] = slots;
  const barberA = a.barber_name ? ` com ${a.barber_name}` : "";
  const barberB = b.barber_name ? ` com ${b.barber_name}` : "";
  return `${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} tenho horário às *${formatTimePt(a.time)}*${barberA} ou às *${formatTimePt(b.time)}*${barberB}. Qual prefere?`;
}

export type AgentResult = {
  reply: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  state?:
    | "appointment_created"
    | "appointment_rescheduled"
    | "appointment_cancelled"
    | "appointment_confirmed"
    | "handoff_requested"
    | "plan_subscribed";
  /** Operational context block for this turn. Only set when RunAgentOptions.includeDebugContext is true. */
  debugContext?: string;
};

export type RunAgentOptions = {
  /** When set, use this profile/instructions instead of DB (e.g. for sandbox simulation). */
  sandboxDraft?: { agent_profile: unknown; additional_instructions?: string | null };
  /** When false, do not persist assistant messages (e.g. ai-worker persists after sending to WhatsApp). Default true. */
  persistAssistantMessages?: boolean;
  /** ISO datetime overriding "now" — benchmark only, so time-of-day behavior is testable. */
  simulatedNow?: string;
  /** When true, AgentResult.debugContext carries the operational context block seen this turn. */
  includeDebugContext?: boolean;
};

let selectedBarbershopColumnSupported: boolean | null = null;

async function supportsSelectedBarbershopColumn(): Promise<boolean> {
  if (selectedBarbershopColumnSupported != null) return selectedBarbershopColumnSupported;
  try {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ai_conversation_runtime'
           AND column_name = 'selected_barbershop_id'
       ) AS ok`
    );
    selectedBarbershopColumnSupported = r.rows[0]?.ok === true;
  } catch {
    selectedBarbershopColumnSupported = false;
  }
  return selectedBarbershopColumnSupported;
}

/**
 * Analyse the agent's last reply and detect if it proposed a specific service.
 * Returns a PendingProposal when found, null otherwise.
 */
function detectProposalFromReply(
  reply: string,
  services: CatalogService[],
): { service_ids: string[]; service_name: string } | null {
  if (!reply || !services.length) return null;
  const matched = resolveServiceFromText(reply, services);
  const svc = matched?.match ?? matched?.ambiguous?.simple;
  if (!svc) return null;
  return { service_ids: [svc.id], service_name: svc.name };
}

/**
 * Detect what the agent last asked about based on reply text patterns.
 */
function detectLastQuestion(reply: string): BookingDraft["lastAgentQuestion"] {
  const t = reply.toLowerCase();
  if (/qual\s+(dia|hor[aá]rio|data)|que\s+dia/.test(t)) return "datetime";
  if (/qual\s+servi[cç]o|que\s+servi[cç]o|qual\s+corte/.test(t)) return "service";
  if (/posso\s+confirmar|confirmar\s+o\s+hor[aá]rio|confirma[rmos]/.test(t)) return "confirm";
  return null;
}


export async function runAgent(
  barbershopId: string,
  conversationId: string,
  clientPhone: string,
  openai: OpenAI,
  options?: RunAgentOptions
): Promise<AgentResult> {
  const settingsRow = await pool.query<{
    enabled: boolean;
    timezone: string | null;
    model: string;
    model_premium: string | null;
    temperature: number;
    system_prompt_override: string | null;
    agent_profile: unknown;
    additional_instructions: string | null;
    max_output_tokens: number | null;
  }>(
    `SELECT s.enabled, s.timezone, s.model, s.model_premium, s.temperature, s.system_prompt_override,
            s.agent_profile, s.additional_instructions, s.max_output_tokens
     FROM public.barbershop_ai_settings s WHERE s.barbershop_id = $1`,
    [barbershopId]
  );
  const settings = settingsRow.rows[0];
  const planRow = await pool.query<{ billing_plan: string | null }>(
    "SELECT billing_plan FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  const billingPlan = planRow.rows[0]?.billing_plan ?? "pro";

  // Account-wide number mode: resolve selected_barbershop_id and effective barbershop for tools
  type BranchInfo = { id: string; name: string };
  let effectiveBarbershopId = barbershopId;
  let accountBranches: BranchInfo[] = [];
  let numberMode: "account_wide" | "per_branch" = "per_branch";
  try {
    let selectedId: string | null = null;
    if (await supportsSelectedBarbershopColumn()) {
      const runtimeRow = await pool.query<{ selected_barbershop_id: string | null }>(
        `SELECT selected_barbershop_id FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
        [conversationId]
      );
      selectedId = runtimeRow.rows[0]?.selected_barbershop_id ?? null;
    }
    const accountRow = await pool.query<{ account_id: string | null }>(
      "SELECT account_id FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const accountId = accountRow.rows[0]?.account_id ?? null;
    if (accountId) {
      const accRow = await pool.query<{ whatsapp_number_mode: string }>(
        "SELECT whatsapp_number_mode FROM public.accounts WHERE id = $1",
        [accountId]
      );
      numberMode = accRow.rows[0]?.whatsapp_number_mode === "account_wide" ? "account_wide" : "per_branch";
      const branchesRow = await pool.query<{ id: string; name: string }>(
        "SELECT id, name FROM public.barbershops WHERE account_id = $1 ORDER BY name",
        [accountId]
      );
      accountBranches = branchesRow.rows;
      const allowedIds = new Set(accountBranches.map((b) => b.id));
      if (selectedId && allowedIds.has(selectedId)) {
        effectiveBarbershopId = selectedId;
      }
    }
  } catch {
    // Tables/columns may not exist
  }

  const msgCountRow = await pool.query<{ cnt: string }>(
    "SELECT count(*)::text AS cnt FROM public.ai_messages WHERE conversation_id = $1",
    [conversationId]
  );
  const messageCount = parseInt(msgCountRow.rows[0]?.cnt ?? "0", 10);
  const ESCALATION_MESSAGE_THRESHOLD = 15;
  const ESCALATION_TOOL_ERROR_THRESHOLD = 2;
  const premiumAvailable =
    billingPlan === "premium" && (settings?.model_premium ?? "").trim() !== "";
  const usePremiumByMessages =
    premiumAvailable && messageCount >= ESCALATION_MESSAGE_THRESHOLD;
  let usePremiumModel = usePremiumByMessages;
  let model = usePremiumModel ? (settings?.model_premium ?? settings?.model) : (settings?.model ?? "gpt-4o-mini");
  const temperature = settings?.temperature ?? 0.3;
  const draft = options?.sandboxDraft;
  const useDraft = draft && draft.agent_profile != null && typeof draft.agent_profile === "object";
  const persistAssistantMessages = options?.persistAssistantMessages !== false;
  const hasProfile =
    useDraft ||
    (settings?.agent_profile != null &&
      typeof settings.agent_profile === "object" &&
      Object.keys(settings.agent_profile as object).length > 0);
  let systemPrompt: string;
  if (hasProfile) {
    const profile = useDraft ? normalizeProfile(draft.agent_profile) : normalizeProfile(settings!.agent_profile);
    const additionalInstructions = useDraft ? (draft.additional_instructions ?? null) : (settings?.additional_instructions ?? null);
    systemPrompt = buildSystemPrompt({
      basePrompt: DEFAULT_SYSTEM_PROMPT,
      guardrails: RUNTIME_GUARDRAILS,
      profile,
      additionalInstructions,
    });
  } else {
    systemPrompt = buildSystemPrompt({
      basePrompt: DEFAULT_SYSTEM_PROMPT,
      guardrails: RUNTIME_GUARDRAILS,
      profile: null,
      additionalInstructions: settings?.system_prompt_override?.trim() ? settings.system_prompt_override : null,
    });
  }

  // Safety: ensure we always use a real IANA timezone (avoid drifting to UTC in production).
  const timeZone = settings?.timezone && settings.timezone.includes("/") ? settings.timezone : "America/Sao_Paulo";
  const simulatedNowDate = options?.simulatedNow ? new Date(options.simulatedNow) : null;
  const now = simulatedNowDate && !Number.isNaN(simulatedNowDate.getTime()) ? simulatedNowDate : new Date();
  const dateTimeStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const dateOnlyStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const tomorrowOnlyStr = addDaysIso(dateOnlyStr, 1);
  const currentTimeHHmm = (dateTimeStr.includes(" ") ? dateTimeStr.split(" ")[1] : "00:00").slice(0, 5);

  const shopContextRow = await pool.query<{
    name: string;
    business_hours: unknown;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }>("SELECT name, business_hours, address, latitude, longitude FROM public.barbershops WHERE id = $1", [effectiveBarbershopId]);
  const barbershopName = shopContextRow.rows[0]?.name ?? "Barbearia";
  const businessHoursRaw = shopContextRow.rows[0]?.business_hours ?? null;
  const shopAddress = shopContextRow.rows[0]?.address?.trim() ?? "";

  // Late-binding catalog — populated after the catalog fetch below; safe to reference in closures.
  let lateCatalogServices: CatalogService[] = [];
  const hasGeoLocation =
    shopContextRow.rows[0]?.latitude != null && shopContextRow.rows[0]?.longitude != null;

  // Always resolve client by the incoming phone so we never ask for it.
  let clientName = "";
  let clientNameConfirmed = false;
  let whatsappPushName: string | null = null;
  try {
    const c = (await aiTools.upsertClient(effectiveBarbershopId, clientPhone)) as unknown;
    if (c && typeof c === "object") {
      const row = c as Record<string, unknown>;
      clientNameConfirmed = row.name_confirmed === true;
      whatsappPushName = typeof row.whatsapp_contact_name === "string" ? row.whatsapp_contact_name : null;
      const maybeName = row.name;
      if (typeof maybeName === "string" && clientNameConfirmed && isUsableClientName(maybeName)) {
        const formatted = aiTools.formatStoredClientName(maybeName.trim()) ?? maybeName.trim();
        clientName = confirmedPersonName({
          storedName: formatted,
          nameConfirmed: true,
          pushName: whatsappPushName,
        });
      }
    }
  } catch {
    // If client lookup fails, the agent can still proceed by asking name later (never phone).
  }

  const memExists = await clientMemoryTableExists();
  const [clientMemory, rawUp, clientFavorites] = await Promise.all([
    memExists ? getClientMemory(effectiveBarbershopId, clientPhone) : Promise.resolve(null),
    aiTools.listClientUpcomingAppointments(effectiveBarbershopId, clientPhone, dateOnlyStr).catch(() => [] as unknown[]),
    aiTools.getClientFavoriteServices(effectiveBarbershopId, clientPhone).catch(() => null),
  ]);

  let upcomingAppointments: UpcomingApptRow[] = [];
  try {
    const arr = Array.isArray(rawUp) ? rawUp : [];
    upcomingAppointments = filterUpcomingFromNow(arr as UpcomingApptRow[], dateOnlyStr, currentTimeHHmm);
  } catch {
    upcomingAppointments = [];
  }

  const lastVisit =
    upcomingAppointments.length === 0
      ? await aiTools.getClientLastAppointment(effectiveBarbershopId, clientPhone).catch(() => null)
      : null;

  const upcomingBooked = ((): "pending" | "confirmed" | null => {
    const pending = upcomingAppointments.find((a) => a.status === "pending");
    if (pending) return "pending";
    if (upcomingAppointments.some((a) => a.status === "confirmed" || !a.status)) return "confirmed";
    return null;
  })();

  const operationalContextBlock = buildOperationalContextBlock({
    barbershopName,
    timeZone,
    dateTimeStr,
    dateOnlyStr,
    clientName,
    businessHoursRaw,
    clientMemory,
    favorites: clientFavorites,
    address: shopContextRow.rows[0]?.address ?? null,
    hasGeoLocation,
  });

  let contactContextBlock = "";
  if (upcomingAppointments.length > 0) {
    const lines = upcomingAppointments
      .slice(0, 6)
      .map((a) => {
        const full = formatDateShortPt(String(a.date).slice(0, 10));
        const [day, month] = full.split("/");
        const shortDate = day && month ? `${day}/${month}` : full;
        return `- ${shortDate} às ${formatTimePt(String(a.time).slice(0, 5))}: ${a.service_names} (com ${a.barber_name})`;
      })
      .join("\n");
    contactContextBlock =
      `\n\n--- Próximos agendamentos deste contato ---\n${lines}\n` +
      `Ao citar esses horários ao cliente, use exatamente este formato curto (dd/MM às HHh, ex.: 24/09 às 14h). Nunca escreva a data por extenso nem o ano.\n` +
      `Antes de tratar como novo agendamento: cumprimente pelo primeiro nome se souber. Pergunte de forma objetiva se está tudo certo com esse horário ou se prefere reagendar. ` +
      `Para reagendar ou cancelar, use list_client_upcoming_appointments, reschedule_appointment e cancel_appointment conforme o caso.`;
  } else if (
    clientMemory &&
    clientMemory.overall_confidence >= 0.5 &&
    ((clientMemory.preferred_services?.length ?? 0) > 0 || !!clientMemory.preferred_barber_name)
  ) {
    contactContextBlock =
      `\n\n--- Retorno sem horário futuro ---\n` +
      `Este contato tem preferências na memória: encurte o fluxo — ofereça serviço e barbeiro habituais quando fizer sentido e peça principalmente data/horário, salvo se o cliente pedir outra combinação explicitamente.`;
  }

  if (!hasProfile) {
    systemPrompt = systemPrompt + "\n\n" + RUNTIME_GUARDRAILS;
  }
  const todayDateBr = formatDateShortPt(dateOnlyStr);
  const tomorrowDateBr = formatDateShortPt(tomorrowOnlyStr);
  systemPrompt = systemPrompt
    .replace(/\{\{TIMEZONE\}\}/g, timeZone)
    .replace(/\{\{DATE_NOW\}\}/g, dateTimeStr)
    .replace(/\{\{TODAY_DATE\}\}/g, dateOnlyStr)
    .replace(/\{\{TOMORROW_DATE\}\}/g, tomorrowOnlyStr)
    .replace(/\{\{TODAY_DATE_BR\}\}/g, todayDateBr)
    .replace(/\{\{TOMORROW_DATE_BR\}\}/g, tomorrowDateBr)
    .replace(/\{\{CLIENT_PHONE\}\}/g, clientPhone)
    .replace(/\{\{CLIENT_NAME\}\}/g, clientName || "")
    .replace(/\{\{BARBERSHOP_NAME\}\}/g, barbershopName)
    .replace(/\{\{OPENING_MESSAGE\}\}/g, buildOpeningMessage(barbershopName));

  systemPrompt = systemPrompt + operationalContextBlock;
  if (contactContextBlock) {
    systemPrompt = systemPrompt + contactContextBlock;
  }

  if (numberMode === "account_wide" && accountBranches.length > 1) {
    const branchList = accountBranches.map((b, idx) => `${idx + 1}) ${b.name}`).join("; ");
    systemPrompt =
      systemPrompt +
      `\n\nFILIAIS: Esta conta tem várias filiais. Quando o cliente ainda não tiver escolhido a filial, pergunte: "Qual filial você prefere?" e liste: ${branchList}. Quando o cliente escolher, chame a ferramenta select_branch com o barbershop_id correto da filial escolhida. Depois use as outras ferramentas normalmente para a filial selecionada.`;
  }

  const messagesRow = await pool.query<{
    role: string;
    content: string | null;
    tool_name: string | null;
    tool_payload: unknown;
  }>(
    `SELECT role, content, tool_name, tool_payload FROM public.ai_messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  const history = messagesRow.rows;
  const lastN = history.slice(-MAX_MEMORY_MESSAGES);
  const lastUserTextRaw = lastUserTurnText(lastN);
  const lastUserText = lastUserTextRaw.toLowerCase().trim();

  let bookingDraft = await loadBookingDraft(conversationId);

  if (looksLikePlanIntent(lastUserTextRaw) || looksLikePixIntent(lastUserTextRaw)) {
    const planSubscription = await aiTools
      .listClientPlanSubscription(effectiveBarbershopId, clientPhone)
      .catch(() => null);
    if (planSubscription && typeof planSubscription === "object" && (planSubscription as { found?: boolean }).found) {
      const sub = planSubscription as { plan_name?: string; price?: number; subscription_id?: string; overdue?: boolean };
      systemPrompt +=
        `\n\nASSINATURA DESTE CONTATO: ${sub.plan_name ?? "plano"} R$ ${sub.price ?? ""}` +
        `${sub.overdue ? " com cobrança pendente" : ""}. subscription_id=${sub.subscription_id}. ` +
        `Para cobrar, chame send_pix_plan_charge com esse id. Não diga que a assinatura não existe.`;
    }
  }
  if (lastVisit && looksLikeRescheduleIntent(lastUserTextRaw)) {
    systemPrompt +=
      `\n\nREMARCAR SEM HORÁRIO FUTURO: último atendimento foi ${lastVisit.service_names} com ${lastVisit.barber_name} por volta das ${lastVisit.time}. ` +
      `Use o nome da pessoa se souber. Não pergunte o serviço nem o barbeiro de novo. Ofereça esse horário de referência e peça só o sim.`;
  }

  // Benchmark-only: attach the exact context the model/fast-paths saw this turn, so a
  // transcript review can tell what the agent "knew" without re-running anything.
  // Declared before any return so early exits (handoff, greeting) can use it too.
  const debugContext = options?.includeDebugContext
    ? `${operationalContextBlock}${contactContextBlock}`
    : undefined;
  function withDebug<T extends AgentResult>(result: T): T {
    const cleaned = { ...result, reply: sanitizeClientFacingReply(result.reply) };
    return debugContext ? { ...cleaned, debugContext } : cleaned;
  }

  // Handoff por keyword: se cliente pedir humano, pausar conversa e enviar handoff_message
  try {
    const handoffRow = await pool.query<{
      on_user_request_enabled: boolean;
      user_request_keywords: string[] | null;
      handoff_message: string | null;
    }>(
      `SELECT on_user_request_enabled, user_request_keywords, handoff_message
       FROM public.barbershop_ai_handoff_settings WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const handoff = handoffRow.rows[0];
    if (
      handoff?.on_user_request_enabled &&
      Array.isArray(handoff.user_request_keywords) &&
      handoff.user_request_keywords.length > 0
    ) {
      const normalized = lastUserText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const match = handoff.user_request_keywords.some((k) => {
        const kw = String(k).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        return kw && normalized.includes(kw);
      });
      if (match) {
        await setConversationPaused(conversationId, {
          pausedBy: "rule",
          reason: "Cliente pediu atendimento humano (keyword)",
        });
        await pool.query(
          `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
           VALUES ($1, $2, 'paused', 'keyword', $3)`,
          [barbershopId, conversationId, "Cliente pediu atendimento humano (keyword)"]
        );
        const reply =
          (handoff.handoff_message && handoff.handoff_message.trim()) ||
          "Um atendente vai te atender em instantes. Aguarde um momento.";
        if (persistAssistantMessages) {
          await pool.query(
            `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
            [conversationId, reply]
          );
        }
        return withDebug({ reply, state: "handoff_requested" });
      }
    }
  } catch {
    // Table may not exist or handoff disabled
  }

  if (looksLikeHumanHandoff(lastUserTextRaw)) {
    await setConversationPaused(conversationId, {
      pausedBy: "rule",
      reason: "Cliente pediu atendimento humano",
    }).catch(() => {});
    const reply = "Um atendente vai te atender em instantes. Aguarde um momento.";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return withDebug({ reply, state: "handoff_requested" });
  }

  // Proactive name capture: if the user writes "meu nome é X" in the same message,
  // persist it immediately to avoid asking again in the next turn.
  const extractedRaw = extractNameFromText(lastUserTextRaw);
  const extractedName = extractedRaw ? aiTools.formatStoredClientName(extractedRaw) ?? extractedRaw : null;
  if (extractedName && (!clientName || normalizeLoose(clientName) !== normalizeLoose(extractedName))) {
    aiTools.upsertClient(effectiveBarbershopId, clientPhone, extractedName).catch(() => {});
    clientName = extractedName;
  }

  const desired = (() => {
    let desiredDate: string | undefined;
    let desiredDateSource: ClientDateSource | undefined;
    let desiredTime: string | undefined;

    // Boundary: a date/time mentioned before the most recent closed transaction (a
    // successful create/cancel/reschedule/confirm) belongs to that transaction and must
    // not resurface as an "open" intent for later, unrelated turns. Without this bound,
    // "amanhã às 18h" from turn 1 kept being read as a pending request many turns later —
    // even after the appointment it referred to had already been created and closed —
    // which made an unrelated reply (e.g. a presence confirmation) look like it still had
    // a booking in progress and re-trigger "qual serviço deseja?" (RC1).
    const CLOSING_TOOLS = new Set([
      "create_appointment",
      "cancel_appointment",
      "reschedule_appointment",
      "confirm_appointment",
    ]);

    for (const m of [...history].reverse()) {
      if (m.role === "tool" && CLOSING_TOOLS.has(String(m.tool_name ?? ""))) break;
      if (m.role !== "user") continue;
      const content = String(m.content ?? "");
      if (!desiredDate) {
        const resolved = bookingDateFromUserTurn(content, dateOnlyStr);
        if (resolved) {
          desiredDate = resolved.date;
          desiredDateSource = resolved.source;
        }
      }

      if (!desiredTime && !isShopHoursQuestion(content)) {
        const parsed = parseClientTime(content);
        if (parsed) {
          const dateForWindow =
            bookingDateFromUserTurn(content, dateOnlyStr)?.date ?? desiredDate ?? dateOnlyStr;
          const window = shopWindowOnIso(
            dateForWindow,
            businessHoursRaw as Parameters<typeof shopWindowOnIso>[1],
          );
          desiredTime = alignSpokenHour(content, parsed, window.start, window.end);
        }
      }

      if (desiredDate && desiredTime) break;
    }

    const lastAssistantForDate = [...history].reverse().find((m) => m.role === "assistant");
    if (
      !desiredDate &&
      lastAssistantForDate &&
      assistantOfferedNextOpenDay(String(lastAssistantForDate.content ?? "")) &&
      acceptsOfferedDay(lastUserTextRaw)
    ) {
      desiredDate = tomorrowOnlyStr;
      desiredDateSource = "amanha";
    }

    // If user gave only a time, assume today if it's still in the future; otherwise tomorrow.
    if (!desiredDate && desiredTime && !isShopHoursQuestion(lastUserTextRaw)) {
      const tm = (() => {
        const [hh, mm] = desiredTime.split(":");
        return parseInt(hh, 10) * 60 + parseInt(mm, 10);
      })();
      const nowM = (() => {
        const [hh, mm] = currentTimeHHmm.split(":");
        return parseInt(hh, 10) * 60 + parseInt(mm, 10);
      })();
      desiredDate = tm >= nowM + 15 ? dateOnlyStr : tomorrowOnlyStr;
      desiredDateSource = "time_fallback";
    }

    // Horários sempre múltiplos de 5 (ex.: 16:07 -> 16:10).
    if (desiredTime) {
      const totalMins = parseInt(desiredTime.slice(0, 2), 10) * 60 + parseInt(desiredTime.slice(3, 5), 10);
      const rounded = Math.ceil(totalMins / 5) * 5;
      const rh = Math.floor(rounded / 60) % 24;
      const rm = rounded % 60;
      desiredTime = `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
    }

    const turnTime = parseClientTime(lastUserTextRaw);
    if (turnTime) desiredTime = turnTime;

    const offeredClock = offeredFitClockIfAccepted({
      lastAssistant: lastAssistantTurnText(history),
      lastUser: lastUserTextRaw,
    });
    if (offeredClock) desiredTime = offeredClock;

    // Explicit date from the CURRENT turn only — used for date-priority logic
    const currentTurnDate = bookingDateFromUserTurn(lastUserTextRaw, dateOnlyStr);
    return { desiredDate, desiredTime, desiredDateSource, currentTurnDate };
  })();

  /**
   * Resolve the booking date for a deterministic block.
   * Explicit date from the current turn always beats a stale bookingDraft.date
   * (e.g. user says "amanhã" mid-conversation but draft still holds "hoje").
   * Falls back to bookingDraft.date, then desired.desiredDate.
   */
  const resolveBookingDate = (): string | undefined => {
    if (
      desired.currentTurnDate &&
      desired.desiredDateSource !== "time_fallback"
    ) {
      return desired.currentTurnDate.date;
    }
    return bookingDraft.date ?? desired.desiredDate;
  };

  const bookingGuard =
    desired.desiredDate || desired.desiredTime
      ? `\n\nDADOS JÁ INFORMADOS PELO CLIENTE (não invente e não mude):\n- date=${desired.desiredDate ?? "(não informado)"}\n- time=${desired.desiredTime ?? "(não informado)"}\nSe precisar sugerir alternativa, só faça isso se o horário estiver ocupado após checar disponibilidade.`
      : "";

  systemPrompt = systemPrompt + bookingGuard;
  const shouldPreferNameStep =
    !!desired.desiredDate && !!desired.desiredTime
      ? clientName
        ? `\n\nFECHAMENTO (nome já conhecido):\n` +
          `- check_availability → se o slot estiver livre, envie resumo (serviço, barbeiro, dia, hora, valor) e pergunte "Posso confirmar?".\n` +
          `- Só chame create_appointment no turno seguinte após sim/ok/pode/confirmo.\n`
        : `\n\nFECHAMENTO EM 2 MENSAGENS (obrigatório quando não há nome):\n` +
          `- Use o delimitador [[MSG]] para mandar 2 mensagens.\n` +
          `- Msg 1: resumo do agendamento + valor total (do check_availability) + barbeiro + data/hora.\n` +
          `- Msg 2: peça o nome para salvar.\n` +
          `- Quando o cliente responder com o nome, chame create_appointment sem pedir confirmação de novo.`
      : "";
  systemPrompt = systemPrompt + shouldPreferNameStep;
  const isGreetingOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    if (t.length > 40) return false;
    return /^(oi|ola|olá|opa|salve|e\s*a[ií]|bom dia|boa tarde|boa noite|fala|iae|iai|oii+|olaa+)[!.\s]*$/.test(
      t
    );
  })();

  const [catalogServicesRaw, catalogBarbersRaw] = await Promise.all([
    aiTools.listServices(effectiveBarbershopId),
    aiTools.listBarbers(effectiveBarbershopId),
  ]);
  const catalogServices = catalogFromUnknown(catalogServicesRaw);
  lateCatalogServices = catalogServices;
  const catalogBarbers = catalogBarbersFromUnknown(catalogBarbersRaw);

  const turnFacts = draftPatchFromTurn({
    text: lastUserTextRaw,
    todayIso: dateOnlyStr,
    services: catalogServices,
    barbers: catalogBarbers,
  });
  if (
    isClientConfirmation(lastUserTextRaw) &&
    bookingDraft.pendingProposal?.service_ids?.length &&
    !turnFacts.patch.service_ids?.length
  ) {
    const proposal = bookingDraft.pendingProposal;
    bookingDraft = mergeBookingDraft(bookingDraft, {
      service_ids: proposal.service_ids,
      service_name: proposal.service_name,
      pendingProposal: null,
      lastAgentQuestion: null,
    });
  }
  bookingDraft = applyTurnToDraft(bookingDraft, turnFacts.patch, {
    floorWithoutClock: turnFacts.floorWithoutClock,
  });
  if (bookingDraft.status === "closed") {
    bookingDraft = emptyBookingDraft();
  }
  await saveBookingDraft(conversationId, bookingDraft);

  const userIsAffirmativeOnly = isClientConfirmation(lastUserText);
  const isAffirmativeOnly = userIsAffirmativeOnly;

  const assistantAskedConfirmation = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      if (assistantAskedReminderRsvp(m.content ?? "")) return false;
      return /(fecho assim|confirma|posso fechar|posso confirmar|t[aá] tudo certo|pode prosseguir|posso prosseguir|confirma pra mim)/i.test(
        String(m.content ?? "").toLowerCase(),
      );
    }
    return false;
  })();

  const assistantAskedName = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      return assistantMessageAskedForName(String(m.content ?? ""));
    }
    return false;
  })();

  const isLikelyNameOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    if (t.length < 2 || t.length > 40) return false;
    if (isAffirmativeOnly) return false;
    if (isGreetingOnly) return false;
    return /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(t) && t.split(" ").filter(Boolean).length <= 4;
  })();

  const nameFromUserForBooking = (() => {
    if (acceptsAnyBarber(lastUserTextRaw)) return "";
    const raw = extractedName ?? (isLikelyNameOnly && lastUserText.trim() ? lastUserText.trim() : "");
    if (!raw) return "";
    return aiTools.formatStoredClientName(raw) ?? raw;
  })();
  const bookingName = confirmedPersonName({
    statedThisTurn: nameFromUserForBooking,
    storedName: clientName,
    nameConfirmed: clientNameConfirmed || Boolean(nameFromUserForBooking),
    pushName: whatsappPushName,
  });

  if (isLikelyNameOnly && assistantAskedName && lastUserText.trim()) {
    aiTools.upsertClient(effectiveBarbershopId, clientPhone, lastUserText.trim()).catch(() => {});
  }

  let recentReminderSent = false;
  const pendingForRsvp = upcomingAppointments.filter((a) => a.status === "pending");
  if (upcomingBooked === "pending" && pendingForRsvp.length > 0) {
    try {
      const rr = await pool.query(
        `SELECT 1 FROM public.agenda_activity
         WHERE barbershop_id = $1
           AND appointment_id = ANY($2::uuid[])
           AND type = 'reminder_sent'
           AND created_at > now() - interval '26 hours'
         LIMIT 1`,
        [effectiveBarbershopId, pendingForRsvp.map((a) => a.id)],
      );
      recentReminderSent = rr.rows.length > 0;
    } catch (e) {
      console.warn("[runAgent] reminder rsvp lookup failed:", e instanceof Error ? e.message : e);
    }
  }

  const previousAssistantEarly = lastAssistantTurnText(lastN);
  const lastWasReminder = assistantAskedReminderRsvp(previousAssistantEarly);
  const draftBlocksPresence = bookingDraftBlocksPresence({
    draftStatus: bookingDraft.status,
    lastAssistantWasReminder: lastWasReminder,
  });
  const conversationState = draftBlocksPresence
    ? bookingName
      ? "offer_awaiting_confirm"
      : "awaiting_name"
    : lastWasReminder && upcomingBooked === "pending"
      ? "reminder_rsvp_pending"
      : bookingDraft.status === "awaiting_name"
        ? "awaiting_name"
        : bookingDraft.status === "offered"
          ? "offer_awaiting_confirm"
          : upcomingAppointments.length === 0
            ? "no_upcoming"
            : "has_upcoming";
  systemPrompt =
    systemPrompt +
    `\n\nEstado desta conversa: ${conversationState}` +
    (conversationState === "reminder_rsvp_pending"
      ? " — se o cliente afirmar presença, use confirm_appointment com o appointment_id da lista; nunca create_appointment."
      : conversationState === "offer_awaiting_confirm"
        ? " — resumo já enviado; afirmação fecha com create_appointment (ou peça o nome se ainda não houver)."
        : conversationState === "awaiting_name"
          ? " — próximo dado é o nome da pessoa, não cortesia."
          : conversationState === "no_upcoming"
            ? " — não há horário futuro; consultar/cancelar deve dizer isso, não inventar."
            : " — há horário futuro; consultar/cancelar/reagendar usa a lista, não cria outro.");


  // --- RAG: inject knowledge chunks when relevant ---
  try {
    const ragChunks = await retrieveKnowledge(barbershopId, lastUserText, openai);
    if (ragChunks?.length) {
      const knowledgeBlock = buildKnowledgeBlock(ragChunks);
      if (knowledgeBlock) {
        systemPrompt = systemPrompt + "\n\n" + knowledgeBlock;
      }
    }
  } catch (e) {
    console.warn("[runAgent] RAG retrieval failed:", e instanceof Error ? e.message : e);
  }

  // --- Client memory: inject concise preference block ---
  // Kept separate from RAG (institutional knowledge vs. per-client context).
  // Only injected when overall_confidence >= 0.5 and there's actionable data.
  const memoryBlock = buildClientMemoryPromptBlock(clientMemory);
  if (memoryBlock) {
    systemPrompt = systemPrompt + "\n\n" + memoryBlock;
  }

  const reminderRsvpTurn =
    conversationState === "reminder_rsvp_pending" &&
    isAffirmativeOnly &&
    !assistantAskedConfirmation;
  const wantsFirstSlot =
    /\bprimeiro\s+hor[aá]rio\b|\bprimeiro\s+slot\b|\bmais\s+cedo\s+poss[ií]vel\b|\babre\s+(o\s+)?hor[aá]rio\b/i.test(
      lastUserTextRaw,
    );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(isGreetingOnly
      ? ([
          {
            role: "system",
            content:
              "ABERTURA: em cumprimento curto, use a mensagem padrão {{OPENING_MESSAGE}} (já substituída no prompt) ou siga o bloco de próximos agendamentos / retorno com memória, se existir no sistema. " +
              "Não use “Como posso ajudar?” nem “Estou aqui para ajudar”.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(reminderRsvpTurn
      ? ([
          {
            role: "system",
            content:
              "RSVP: o cliente já tem horário pending e a última mensagem foi o lembrete. Use list_client_upcoming_appointments se precisar do id e chame confirm_appointment. Não chame create_appointment.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(wantsFirstSlot
      ? ([
          {
            role: "system",
            content:
              "PRIMEIRO HORÁRIO: o cliente quer o slot mais cedo do dia. " +
              "Não pergunte o serviço nem o barbeiro se já houver horário ou último atendimento. " +
              "Chame get_next_slots com a data correta e limit=1, SEM after_time, usando esse serviço e barbeiro. " +
              "Confirme no resumo. Não adivinhe nem use check_availability.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isAffirmativeOnly && assistantAskedConfirmation && Boolean(upcomingBooked)
      ? ([
          {
            role: "system",
            content:
              "CONFIRMAÇÃO DE REAGENDAMENTO: o cliente confirmou o novo horário. Chame reschedule_appointment com o appointment_id atual. Não cancele, não crie outro e não chame confirm_appointment.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isAffirmativeOnly && assistantAskedConfirmation && !upcomingBooked
      ? ([
          {
            role: "system",
            content:
              "CONFIRMAÇÃO RECEBIDA: o cliente confirmou. Agora você DEVE finalizar o agendamento.\n" +
              "- Se faltar qualquer dado/ID: use tools (list_services, list_barbers, check_availability) para resolver.\n" +
              "- Em seguida, chame create_appointment.\n" +
              "- Não peça confirmação de novo. Não diga que está agendado antes do create_appointment retornar sucesso.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isLikelyNameOnly && assistantAskedName
      ? ([
          {
            role: "system",
            content:
              "NOME RECEBIDO: use esse nome como client_name e finalize o agendamento agora.\n" +
              "- Não peça confirmação novamente.\n" +
              "- Chame create_appointment.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...lastN
      .map((m) => {
        if (m.role === "user") return { role: "user" as const, content: m.content ?? "" };
        if (m.role === "assistant") return { role: "assistant" as const, content: m.content ?? "" };
        // Tool messages cannot be replayed safely across turns (tool_call_id mismatch); skip them.
        return null;
      })
      .filter(Boolean) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ];

  let state: AgentResult["state"];
  let totalUsage: AgentResult["usage"];
  const loopMessages = [...messages];
  const maxToolRounds = 10;
  const memoryServiceNames = (): string[] => {
    const names = [...(clientMemory?.preferred_services ?? [])];
    const last = clientFavorites?.last?.service_names?.trim();
    if (last) names.push(last);
    return names;
  };
  const shopWindowForGuard = () => {
    const iso = desired.desiredDate || dateOnlyStr;
    return shopWindowOnIso(iso, businessHoursRaw as Parameters<typeof shopWindowOnIso>[1]);
  };
  const previousAssistant = lastAssistantTurnText(lastN);

  async function ensureMappedCancel(reply: string): Promise<string> {
    const target = upcomingAppointments[0];
    const phrase = () =>
      target
        ? composeCancellationReply({
            serviceName: target.service_names,
            when: formatResumoWhen(String(target.date).slice(0, 10), String(target.time).slice(0, 5), dateOnlyStr),
            barberName: target.barber_name,
          })
        : reply;
    if (state === "appointment_cancelled") return reply.trim() ? reply : phrase();
    if (!looksLikeCancelIntent(lastUserTextRaw) || looksLikeRescheduleIntent(lastUserTextRaw)) return reply;
    if (!target?.id) return reply;
    const r = await aiTools.cancelAppointmentByAgent(
      currentBarbershopId,
      target.id,
      clientPhone,
      conversationId,
    );
    if (!(r && typeof r === "object" && (r as { ok?: boolean }).ok === true)) return reply;
    state = "appointment_cancelled";
    bookingDraft = emptyBookingDraft();
    await saveBookingDraft(conversationId, bookingDraft);
    updateClientMemoryFromAppointmentEvent({
      eventType: "appointment_cancelled",
      barbershopId: currentBarbershopId,
      clientPhone,
    }).catch(() => {});
    return phrase();
  }

  function applyOutputGuard(reply: string, composed: boolean): string {
    const window = shopWindowForGuard();
    return guardClientReply({
      reply,
      previousAssistant,
      userText: lastUserTextRaw,
      opensAt: window.start,
      closesAt: window.end,
      composed,
    });
  }

  async function finishTurn(reply: string, composed: boolean) {
    let out = applyOutputGuard(reply, composed);
    const acceptingNewBooking =
      isAffirmativeOnly &&
      assistantAskedConfirmation &&
      bookingDraftBlocksPresence({
        draftStatus: bookingDraft.status,
        lastAssistantWasReminder: lastWasReminder,
      }) &&
      !bookingDraft.appointment_id;
    if (acceptingNewBooking && !bookingName && state !== "appointment_created") {
      out = askClientNameReply();
      bookingDraft = mergeBookingDraft(bookingDraft, { status: "awaiting_name" });
      await saveBookingDraft(conversationId, bookingDraft);
    } else if (
      acceptingNewBooking &&
      /presen[cç]a confirmada/i.test(out) &&
      state !== "appointment_created" &&
      upcomingAppointments[0]
    ) {
      const next = upcomingAppointments[0];
      out = composeRescheduleAsk({
        firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
        serviceName: next.service_names || bookingDraft.service_name || "seu horário",
        when: formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr),
        barberName: next.barber_name,
        nextWhen: formatResumoWhen(
          String(bookingDraft.date ?? next.date).slice(0, 10),
          String(bookingDraft.time ?? next.time).slice(0, 5),
          dateOnlyStr,
        ),
      });
    } else if (state === "appointment_created") {
      const when = formatResumoWhen(
        String(bookingDraft.date ?? "").slice(0, 10),
        String(bookingDraft.time ?? "").slice(0, 5),
        dateOnlyStr,
      );
      out = composeBookingCreated({
        firstName: firstNameFromClientName(bookingName || clientName || "você"),
        serviceName: bookingDraft.service_name || "Horário",
        when,
        barberName: bookingDraft.barber_name,
      });
    } else if (state === "appointment_confirmed" && !lastCheckThisTurn && !acceptingNewBooking) {
      const next = upcomingAppointments.find((a) => a.status === "pending") ?? upcomingAppointments[0];
      if (next) {
        const when = formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr);
        out = composePresenceConfirmed({
          firstName: clientName ? firstNameFromClientName(clientName) : undefined,
          when,
          barberName: next.barber_name,
        });
      }
    }
    if (
      looksLikeRescheduleIntent(lastUserTextRaw) &&
      upcomingAppointments.length > 0 &&
      replyDeniesUpcoming(out) &&
      state !== "appointment_rescheduled"
    ) {
      const next = upcomingAppointments[0];
      const requested = desired.desiredTime
        ? formatResumoWhen(desired.desiredDate ?? String(next.date).slice(0, 10), desired.desiredTime, dateOnlyStr)
        : "o horário que você pediu";
      out = composeRescheduleAsk({
        firstName: clientName ? firstNameFromClientName(clientName) : undefined,
        serviceName: next.service_names || "seu horário",
        when: formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr),
        barberName: next.barber_name,
        nextWhen: requested,
      });
    }
    if (
      looksLikeRescheduleIntent(lastUserTextRaw) &&
      upcomingAppointments.length === 0 &&
      lastVisit &&
      (replyDeniesUpcoming(out) || replyAsksForService(out)) &&
      state !== "appointment_created"
    ) {
      out = composeRemarcarFromLast({
        firstName: clientName ? firstNameFromClientName(clientName) : undefined,
        serviceName: lastVisit.service_names,
        barberName: lastVisit.barber_name,
        timeHHmm: lastVisit.time,
      });
    }
    if (shopPixSentThisTurn) {
      out = replyWithoutPixEcho(out, shopPixKeyThisTurn);
    }
    out = await ensureMappedCancel(out);
    out = applyOutputGuard(out, state === "appointment_confirmed" || state === "appointment_cancelled" || composed);
    await persistAssistant(out);
    updateClientMemoryFromConversation(effectiveBarbershopId, clientPhone, {
      messages: lastN.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
      finalState: state,
    }).catch(() => {});
    return withDebug({ reply: out, usage: totalUsage, state });
  }
  let toolErrorCount = 0;
  let currentBarbershopId = effectiveBarbershopId;
  let lastCheckThisTurn: CheckAvailabilitySnapshot | null = null;
  let shopPixSentThisTurn = false;
  let shopPixKeyThisTurn = "";
  const listedUpcomingIdsThisTurn: string[] = [];

  /** Menos criatividade quando o próximo passo é fechar agendamento (nome ou confirmação explícita). */
  const bookingCritical =
    (assistantAskedName && isLikelyNameOnly && !upcomingBooked) ||
    (isAffirmativeOnly && assistantAskedConfirmation && !upcomingBooked);
  const effectiveTemperature = bookingCritical ? Math.min(temperature, 0.2) : temperature;

  async function persistAssistant(content: string | null): Promise<void> {
    if (!persistAssistantMessages) return;
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [conversationId, sanitizeClientFacingReply(content ?? "")]
    );
  }
  async function persistTool(toolName: string, payload: unknown, content: string): Promise<void> {
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content) VALUES ($1, 'tool', $2, $3, $4)`,
      [conversationId, toolName, JSON.stringify(payload), content.slice(0, 8192)]
    );
  }

  for (let round = 0; round < maxToolRounds; round++) {
    const maxTokens = settings?.max_output_tokens ?? 350;
    const completion = await openai.chat.completions.create({
      model,
      temperature: effectiveTemperature,
      max_tokens: maxTokens,
      messages: loopMessages,
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    });
    const choice = completion.choices[0];
    if (completion.usage) {
      totalUsage = {
        prompt_tokens: completion.usage.prompt_tokens ?? 0,
        completion_tokens: completion.usage.completion_tokens ?? 0,
        total_tokens: completion.usage.total_tokens ?? 0,
      };
    }
    if (!choice) {
      return finishTurn("", false);
    }
    const msg = choice.message;
    if (msg.tool_calls?.length) {
      await persistAssistant(msg.content ?? null);
      // IMPORTANT: push the assistant tool_calls message exactly once, then add one tool response per tool_call_id.
      // If we push the assistant message multiple times (once per tool), OpenAI rejects the sequence.
      loopMessages.push(msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);
      const roundNotes: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
      let locationSentThisTurn = false;
      let stickerSentThisTurn = false;
      for (const tc of msg.tool_calls) {
        const fn = "function" in tc ? (tc as { function?: { name?: string; arguments?: string } }).function : undefined;
        const name = fn?.name as string;
        const args = (() => {
          try {
            return JSON.parse(fn?.arguments ?? "{}") as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        const callToolOnce = async (): Promise<unknown> => {
          if (name === "select_branch") {
            const bid = args.barbershop_id as string;
            if (!bid || !accountBranches.some((b) => b.id === bid)) {
              return { error: "barbershop_id inválido ou não pertence a esta conta" };
            }
            if (await supportsSelectedBarbershopColumn()) {
              await pool.query(
                `INSERT INTO public.ai_conversation_runtime (conversation_id, selected_barbershop_id, updated_at)
                 VALUES ($1, $2, now())
                 ON CONFLICT (conversation_id) DO UPDATE SET selected_barbershop_id = $2, updated_at = now()`,
                [conversationId, bid]
              );
            }
            currentBarbershopId = bid;
            return { ok: true, message: "Filial selecionada. Use as outras ferramentas para esta filial." };
          }
          if (name === "list_services") return aiTools.listServices(currentBarbershopId);
          if (name === "list_barbers") return aiTools.listBarbers(currentBarbershopId);
          if (name === "list_appointments") {
            const listDate = (() => {
              const raw = (args.date as string) ?? "";
              const d = raw || desired.desiredDate || "";
              if (desired.desiredDate && d !== desired.desiredDate) return desired.desiredDate;
              if (lastUserText.includes("amanh") && d && d !== tomorrowOnlyStr) return tomorrowOnlyStr;
              if (lastUserText.includes("hoje") && d && d !== dateOnlyStr) return dateOnlyStr;
              return d;
            })();
            if (listDate && !/^\d{4}-\d{2}-\d{2}$/.test(listDate)) {
              return {
                error:
                  "date inválida para list_appointments: use yyyy-MM-dd (ex.: 2026-04-09). Não use barbershop_id, nome ou UUID de outra entidade como data.",
              };
            }
            const barberIdList = args.barber_id as string | undefined;
            if (
              barberIdList != null &&
              String(barberIdList).trim() !== "" &&
              !isValidUuid(String(barberIdList).trim())
            ) {
              return {
                error:
                  "barber_id deve ser o UUID retornado por list_barbers, não o nome do barbeiro.",
              };
            }
            return aiTools.listAppointments(currentBarbershopId, listDate, barberIdList);
          }
          if (name === "check_availability") {
            const dRaw = (args.date as string) ?? "";
            const tRaw = (args.time as string) ?? "";
            const date = pickExecutedToolDate({
              desiredDate: desired.desiredDate,
              desiredSource: desired.desiredDateSource,
              toolDate: dRaw,
            });
            const timeRaw = pickExecutedToolTime({
              desiredTime: desired.desiredTime,
              toolTime: tRaw,
            });
            const window = shopWindowOnIso(date, businessHoursRaw as Parameters<typeof shopWindowOnIso>[1]);
            const time = alignSpokenHour(lastUserTextRaw, timeRaw, window.start, window.end);
            const isToday = date === dateOnlyStr;
            const servicesUnknown = await aiTools.listServices(currentBarbershopId);
            const catalog = catalogFromUnknown(servicesUnknown);
            const named = resolveServiceForTurn(lastUserTextRaw, memoryServiceNames(), catalog);
            if (!bookingDraft.service_ids?.length && !named.match) {
              return {
                error: named.ambiguous
                  ? "Serviço ainda ambíguo. Pergunte se é o simples ou o combo. Não chame check_availability."
                  : "Serviço ainda não está no rascunho. Pergunte corte, barba ou combo. Não chame check_availability.",
              };
            }
            const argServiceIds = idsKnownToCatalog(args.service_ids, catalog);
            const argServiceId = idKnownToCatalog(args.service_id, catalog);
            const serviceIds = named.match
              ? [named.match.id]
              : argServiceIds.length
                ? argServiceIds
                : argServiceId
                  ? [argServiceId]
                  : bookingDraft.service_ids;
            const serviceId = serviceIds?.length === 1 ? serviceIds[0] : argServiceId;
            const barberId = idKnownToCatalog(args.barber_id, catalogBarbers) ?? bookingDraft.barber_id;
            args.date = date;
            args.time = time;
            if (serviceIds?.length) args.service_ids = serviceIds;
            if (barberId) args.barber_id = barberId;
            return aiTools.checkAvailability(currentBarbershopId, {
              date,
              time,
              after_time: bookingDraft.after_time
                ? bookingDraft.after_time
                : isToday
                  ? ((args.after_time as string) || currentTimeHHmm)
                  : undefined,
              barber_id: barberId,
              service_id: serviceId,
              service_ids: serviceIds,
            });
          }
          if (name === "get_next_slots") {
            const dRaw = (args.date as string) ?? "";
            const date = pickExecutedToolDate({
              desiredDate: desired.desiredDate,
              desiredSource: desired.desiredDateSource,
              toolDate: dRaw,
            });
            const isToday = date === dateOnlyStr;
            const servicesUnknown = await aiTools.listServices(currentBarbershopId);
            const catalog = catalogFromUnknown(servicesUnknown);
            const named = resolveServiceForTurn(lastUserTextRaw, memoryServiceNames(), catalog);
            const carriedServiceIds = bookingDraft.service_ids?.length
              ? bookingDraft.service_ids
              : upcomingAppointments[0]?.service_ids?.length
                ? upcomingAppointments[0].service_ids
                : lastVisit?.service_ids ?? [];
            if (!carriedServiceIds.length && !named.match) {
              return {
                error: named.ambiguous
                  ? "Serviço ainda ambíguo. Pergunte se é o simples ou o combo. Não chame get_next_slots."
                  : "Serviço ainda não está no rascunho. Pergunte o serviço. Não chame get_next_slots.",
              };
            }
            const argServiceIds = idsKnownToCatalog(args.service_ids, catalog);
            const argServiceId = idKnownToCatalog(args.service_id, catalog);
            const serviceIds = named.match
              ? [named.match.id]
              : argServiceIds.length
                ? argServiceIds
                : argServiceId
                  ? [argServiceId]
                  : carriedServiceIds;
            const serviceId = serviceIds?.length === 1 ? serviceIds[0] : argServiceId;
            return aiTools.getNextSlots(currentBarbershopId, {
              date,
              service_id: serviceId,
              service_ids: serviceIds,
              after_time: bookingDraft.after_time
                ? bookingDraft.after_time
                : isToday
                  ? ((args.after_time as string) || currentTimeHHmm)
                  : undefined,
              barber_id:
                idKnownToCatalog(args.barber_id, catalogBarbers) ??
                bookingDraft.barber_id ??
                upcomingAppointments[0]?.barber_id ??
                lastVisit?.barber_id,
              limit: typeof args.limit === "number" ? args.limit : undefined,
            });
          }
          if (name === "upsert_client")
            return aiTools.upsertClient(
              currentBarbershopId,
              resolveToolClientPhone(args.phone, clientPhone),
              args.name as string | undefined,
              args.notes as string | undefined
            );
          if (name === "create_appointment") {
            if (upcomingAppointments.length > 0) {
              return {
                error:
                  "Cliente já tem horário. Use reschedule_appointment com o appointment_id atual; não crie outro nem cancele o atual.",
              };
            }
            const bookingConfirmedThisTurn =
              assistantAskedConfirmation ||
              assistantAskedName ||
              bookingDraft.status === "offered" ||
              bookingDraft.status === "awaiting_name" ||
              draftIsCloseable(bookingDraft);
            const createName = [args.client_name, bookingName, clientName]
              .map((n) => (typeof n === "string" ? n.trim() : ""))
              .find((n) => isUsableClientName(n));
            if (!draftIsCloseable(bookingDraft)) {
              return {
                deferred: true,
                reason: "awaiting_client_confirmation",
                instruction:
                  "Não crie o agendamento neste turno. Envie um resumo (serviço, barbeiro, dia da semana, data, hora, valor) e pergunte 'Posso confirmar?'. Só chame create_appointment depois do sim/ok ou do nome pedido no resumo.",
              };
            }
            if (!createName) {
              return {
                deferred: true,
                reason: "awaiting_client_name",
                instruction:
                  "Não crie o agendamento neste turno. Peça o nome do cliente com 'Para confirmar, qual seu nome?'. Não envie outro resumo nem trate cortesia como nome.",
              };
            }
            if (!bookingConfirmedThisTurn) {
              return {
                deferred: true,
                reason: "awaiting_client_confirmation",
                instruction:
                  "Não crie o agendamento neste turno. Envie um resumo e pergunte 'Posso confirmar?'.",
              };
            }
            const payload: Parameters<typeof aiTools.createAppointment>[1] = {
              client_phone: (args.client_phone as string) ?? clientPhone,
              client_name: createName,
              barber_id: bookingDraft.barber_id as string,
              ...(bookingDraft.service_ids?.length === 1
                ? { service_id: bookingDraft.service_ids[0] }
                : { service_ids: bookingDraft.service_ids }),
              date: bookingDraft.date as string,
              time: bookingDraft.time as string,
              notes: args.notes as string | undefined,
            };
            if (typeof args.client_id === "string" && args.client_id) payload.client_id = args.client_id;
            const r = await aiTools.createAppointment(currentBarbershopId, payload, conversationId);
            // Fire-and-forget: update client memory from the newly created appointment
            if ((r as Record<string, unknown>)?.id) {
              state = "appointment_created";
              bookingDraft = mergeBookingDraft(bookingDraft, {
                status: "closed",
                appointment_id: String((r as Record<string, unknown>).id),
              });
              await saveBookingDraft(conversationId, bookingDraft);
              const appointmentResult = r as Record<string, unknown>;
              const serviceNames = (
                Array.isArray(appointmentResult.services)
                  ? (appointmentResult.services as Array<{ name?: string; service_name?: string }>)
                      .map((s) => s?.name ?? s?.service_name ?? "")
                      .filter(Boolean)
                  : []
              );
              updateClientMemoryFromAppointmentEvent({
                eventType: "appointment_created",
                barbershopId: currentBarbershopId,
                clientPhone,
                barberId: payload.barber_id,
                serviceNames,
              }).catch(() => {});
            } else if (payload.client_name?.trim()) {
              // Appointment failed but we have the name — persist it so the next
              // runAgent turn doesn't re-trigger the FECHAMENTO EM 2 MENSAGENS block.
              aiTools.upsertClient(effectiveBarbershopId, clientPhone, payload.client_name.trim()).catch(() => {});
            }
            return r;
          }
          if (name === "list_client_upcoming_appointments") {
            const listed = await aiTools.listClientUpcomingAppointments(
              currentBarbershopId,
              resolveToolClientPhone(args.client_phone, clientPhone) || "",
              dateOnlyStr,
            );
            if (Array.isArray(listed)) {
              for (const row of listed as Array<{ id?: string }>) {
                if (typeof row?.id === "string") listedUpcomingIdsThisTurn.push(row.id);
              }
            }
            return listed;
          }
          if (name === "cancel_appointment") {
            if (upcomingAppointments.length === 0 && listedUpcomingIdsThisTurn.length === 0) {
              return {
                error:
                  "Não há horário futuro para este contato. Informe isso ao cliente. Não invente cancelamento e não chame cancel_appointment de novo.",
              };
            }
            if (assistantAskedConfirmation && !looksLikeCancelIntent(lastUserText)) {
              return {
                error:
                  "Não cancele para reagendar. Use reschedule_appointment com o appointment_id do horário atual.",
              };
            }
            const r = await aiTools.cancelAppointmentByAgent(
              currentBarbershopId,
              (args.appointment_id as string) ?? "",
              resolveToolClientPhone(args.client_phone, clientPhone) || "",
              conversationId,
            );
            if (r && typeof r === "object" && (r as { ok?: boolean }).ok === true) {
              state = "appointment_cancelled";
              bookingDraft = emptyBookingDraft();
              await saveBookingDraft(conversationId, bookingDraft);
              updateClientMemoryFromAppointmentEvent({
                eventType: "appointment_cancelled",
                barbershopId: currentBarbershopId,
                clientPhone,
              }).catch(() => {});
            }
            return r;
          }
          if (name === "reschedule_appointment") {
            if (looksLikeRescheduleIntent(lastUserText) && !isAffirmativeOnly) {
              return {
                deferred: true,
                reason: "awaiting_client_confirmation",
                instruction:
                  "Não altere o horário neste turno. Envie um resumo do novo dia/hora e pergunte 'Posso confirmar?'. Só chame reschedule_appointment depois do sim.",
              };
            }
            if (!draftIsCloseable(bookingDraft) || !bookingDraft.appointment_id) {
              return {
                deferred: true,
                reason: "awaiting_offered_draft",
                instruction:
                  "Só reagende a partir do rascunho já oferecido (check_availability + Posso confirmar?). Não invente data/hora.",
              };
            }
            const r = await aiTools.rescheduleAppointmentByAgent(
              currentBarbershopId,
              bookingDraft.appointment_id,
              resolveToolClientPhone(args.client_phone, clientPhone) || "",
              {
                date: bookingDraft.date as string,
                time: bookingDraft.time as string,
                barber_id: bookingDraft.barber_id,
              },
              conversationId,
            );
            if (r && typeof r === "object" && (r as { ok?: boolean }).ok === true) {
              state = "appointment_rescheduled";
              bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed" });
              await saveBookingDraft(conversationId, bookingDraft);
              const barberIdOpt = (args.barber_id as string | undefined)?.trim();
              updateClientMemoryFromAppointmentEvent({
                eventType: "appointment_rescheduled",
                barbershopId: currentBarbershopId,
                clientPhone,
                ...(barberIdOpt ? { barberId: barberIdOpt } : {}),
              }).catch(() => {});
            }
            return r;
          }
          if (name === "confirm_appointment") {
            if (
              bookingDraftBlocksPresence({
                draftStatus: bookingDraft.status,
                lastAssistantWasReminder: lastWasReminder,
              })
            ) {
              return {
                error:
                  "Este sim fecha o horário novo. Não use confirm_appointment. Peça o nome se faltar; com o nome, use create_appointment ou reschedule_appointment.",
              };
            }
            if (assistantAskedConfirmation && upcomingAppointments.length > 0 && conversationState !== "reminder_rsvp_pending") {
              return {
                error:
                  "Cliente confirmou o novo horário. Use reschedule_appointment com o appointment_id atual; não use confirm_appointment.",
              };
            }
            const rawId = String(args.appointment_id ?? "").trim();
            const allowed = allowedConfirmAppointmentIds(upcomingAppointments, listedUpcomingIdsThisTurn);
            if (!allowed.has(rawId)) {
              return {
                error:
                  "appointment_id inválido. Chame list_client_upcoming_appointments e use o UUID pending/confirmed devolvido. Não invente o id.",
              };
            }
            const r = await aiTools.confirmAppointmentByAgent(
              currentBarbershopId,
              rawId,
              resolveToolClientPhone(args.client_phone, clientPhone) || "",
              conversationId,
            );
            if (r && typeof r === "object" && (r as { ok?: boolean }).ok === true) {
              state = "appointment_confirmed";
            }
            return r;
          }
          if (name === "send_barbershop_location") {
            if (locationSentThisTurn) {
              return { ok: true, already_sent: true, message: "Localização já enviada neste pedido." };
            }
            locationSentThisTurn = true;
            return sendBarbershopLocationToClient(
              currentBarbershopId,
              resolveToolClientPhone(args.client_phone, clientPhone) || "",
            );
          }
          if (name === "send_sticker") {
            if (stickerSentThisTurn) {
              return { ok: true, already_sent: true, message: "Figurinha já enviada nesta conversa." };
            }
            stickerSentThisTurn = true;
            return sendStickerToClient(currentBarbershopId, clientPhone);
          }
          if (name === "list_plans")
            return aiTools.listPlans(currentBarbershopId);
          if (name === "subscribe_client_to_plan") {
            const subResult = await aiTools.subscribeClientToPlan(currentBarbershopId, {
              client_phone: clientPhone,
              plan_id: (args.plan_id as string) ?? "",
              billing_day: typeof args.billing_day === "number" ? args.billing_day : undefined,
            });
            if (subResult && typeof subResult === "object" && !("error" in subResult)) {
              state = "plan_subscribed";
            }
            return subResult;
          }
          if (name === "send_pix_plan_charge")
            return aiTools.sendPixPlanCharge(currentBarbershopId, {
              subscription_id: (args.subscription_id as string) ?? "",
              client_phone: clientPhone,
            });
          if (name === "send_shop_pix") {
            const pix = await aiTools.sendShopPix(currentBarbershopId, clientPhone);
            if (pix && typeof pix === "object" && (pix as { sent?: boolean }).sent) {
              shopPixSentThisTurn = true;
              shopPixKeyThisTurn = String((pix as { pix_key?: string }).pix_key ?? "");
              delete (pix as { pix_key?: string }).pix_key;
            }
            return pix;
          }
          if (name === "list_client_plan") return aiTools.listClientPlanSubscription(currentBarbershopId, clientPhone);
          if (name === "update_client_notes")
            return aiTools.updateClientNotes(currentBarbershopId, clientPhone, (args.note as string) ?? "");
          if (name === "add_to_waitlist")
            return aiTools.addToWaitlist(currentBarbershopId, {
              client_phone: resolveToolClientPhone(args.client_phone, clientPhone) || "",
              client_name: args.client_name as string | undefined,
              desired_date: (args.desired_date as string) ?? "",
              desired_time: (args.desired_time as string) ?? bookingDraft.time ?? "",
              service_id:
                (args.service_id as string | undefined) ?? bookingDraft.service_ids?.[0] ?? "",
              barber_id: (args.barber_id as string | undefined) ?? bookingDraft.barber_id,
              notes: args.notes as string | undefined,
            });
          return { error: "Unknown tool" };
        };

        let result: unknown;
        try {
          result = await callToolOnce();
        } catch (e1) {
          // One retry for transient connectivity/DB hiccups.
          try {
            result = await callToolOnce();
          } catch (e2) {
            result = { error: e2 instanceof Error ? e2.message : "Tool error" };
          }
        }
        if (
          result != null &&
          typeof result === "object" &&
          "error" in result &&
          (result as { error?: unknown }).error
        ) {
          toolErrorCount++;
        }
        const content = JSON.stringify(result).slice(0, 4096);
        await persistTool(name, args, content);
        loopMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
        if (name === "check_availability") {
          const snap = snapshotCheckAvailability(result, bookingDraft.barber_id);
          if (snap) lastCheckThisTurn = snap;
          if (snap) {
            bookingDraft = mergeBookingDraft(bookingDraft, {
              ...draftPatchFromSnap(snap),
              status: snap.available ? bookingDraft.status : "collecting",
            });
            await saveBookingDraft(conversationId, bookingDraft);
            const alreadyConfirmed = isAffirmativeOnly && assistantAskedConfirmation;
            roundNotes.push({
              role: "system" as const,
              content: snap.available
                ? alreadyConfirmed
                  ? `SLOT LIVRE em ${snap.date} às ${snap.time} com ${snap.barberName || "o barbeiro pedido"} (${snap.serviceName || "serviço"}, R$ ${snap.totalPrice}). ` +
                    `O cliente já confirmou. Chame create_appointment agora. Não pergunte "Posso confirmar?" de novo.`
                  : `SLOT LIVRE em ${snap.date} às ${snap.time} com ${snap.barberName || "o barbeiro pedido"} (${snap.serviceName || "serviço"}, R$ ${snap.totalPrice}). ` +
                    `Responda só com um resumo (serviço, barbeiro, dia da semana, data, hora, valor) e pergunte "Posso confirmar?". ` +
                    `PROIBIDO neste turno: create_appointment, falar de outro dia fechado, "não conseguimos", "deu erro".`
                : `Horário indisponível (${snap.whyUnavailable || "ocupado"}). Fale só de indisponibilidade e ofereça outro dia/horário. ` +
                  `PROIBIDO: "não conseguimos agendar", "deu erro", "não foi possível".`,
            } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
          }
        }

        // After create_appointment fails, inject a mandatory system guardrail to
        // prevent the model from hallucinating a booking confirmation.
        if (
          name === "create_appointment" &&
          result != null &&
          typeof result === "object" &&
          "error" in result &&
          (result as { error?: unknown }).error
        ) {
          const errCode = String((result as Record<string, unknown>).code ?? "ERRO");
          roundNotes.push({
            role: "system" as const,
            content:
              `⛔ AGENDAMENTO NÃO CRIADO (${errCode}): o horário solicitado NÃO foi reservado.\n` +
              `ABSOLUTAMENTE PROIBIDO: dizer "Agendamento confirmado", "está marcado", "Aguardamos você", ` +
              `"confirmei o agendamento" ou qualquer variação.\n` +
              `AÇÃO IMEDIATA OBRIGATÓRIA: chame get_next_slots (limit=8) para obter novos horários ` +
              `e ofereça 2 opções conversacionais (manhã + tarde) ao cliente.` +
              (errCode === "SLOT_CONFLICT" ? " Não repita o horário rejeitado." : ""),
          } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
        }
        if (
          name === "reschedule_appointment" &&
          result != null &&
          typeof result === "object" &&
          "error" in result &&
          (result as { error?: unknown }).error
        ) {
          const errCode = String((result as Record<string, unknown>).code ?? "ERRO");
          roundNotes.push({
            role: "system" as const,
            content:
              `⛔ REAGENDAMENTO NÃO EFETUADO (${errCode}): a agenda NÃO foi alterada.\n` +
              `ABSOLUTAMENTE PROIBIDO: dizer "reagendado", "confirmado" ou "agendamento ajustado" até um reschedule_appointment bem-sucedido.\n` +
              `Ao cliente: diga de forma humana que esse horário não está disponível (ou já foi preenchido) e pergunte se prefere manhã ou tarde. ` +
              `Chame get_next_slots (limit=8) e ofereça 2–3 horários conversacionais sem lista numerada.` +
              (errCode === "SLOT_CONFLICT" ? " Não repita o horário rejeitado." : ""),
          } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
        }
      }
      for (const note of roundNotes) loopMessages.push(note);
      if (
        premiumAvailable &&
        !usePremiumModel &&
        toolErrorCount >= ESCALATION_TOOL_ERROR_THRESHOLD
      ) {
        usePremiumModel = true;
        model = settings?.model_premium ?? settings?.model ?? model;
      }
      continue;
    }
    const replyRaw = (msg.content ?? "").trim();
    let reply = sanitizeClientFacingReply(replyRaw);
    let composed = false;
    if (looksLikePhoneRequest(reply)) {
      reply = "Me diz qual serviço você quer e pra qual dia e horário, que já te encaixo.";
    }
    if (lastCheckThisTurn?.available && lastCheckThisTurn.barberName && lastCheckThisTurn.serviceName) {
      const alreadyConfirmed = isAffirmativeOnly && assistantAskedConfirmation;
      if (!alreadyConfirmed) {
        reply = composeAvailableSlotConfirm({
          serviceName: lastCheckThisTurn.serviceName,
          barberName: lastCheckThisTurn.barberName,
          dateIso: lastCheckThisTurn.date,
          timeHHmm: lastCheckThisTurn.time,
          totalPrice: lastCheckThisTurn.totalPrice,
          timeZone,
            firstName: clientName ? firstNameFromClientName(clientName) : undefined,
            todayIso: dateOnlyStr,
          });
        reply = withBarberSubstitutionDisclosure(reply, lastUserTextRaw, catalogBarbers, lastCheckThisTurn.barberName);
        composed = true;
      }
      bookingDraft = mergeBookingDraft(bookingDraft, {
        ...draftPatchFromSnap(lastCheckThisTurn),
        status: clientName ? "offered" : "awaiting_name",
      });
      await saveBookingDraft(conversationId, bookingDraft);
    } else if (lastCheckThisTurn && !lastCheckThisTurn.available) {
      reply = occupiedCopyFromSnap(
        {
          ...lastCheckThisTurn,
          barberName: lastCheckThisTurn.barberName || bookingDraft.barber_name || "",
          barberId: lastCheckThisTurn.barberId || bookingDraft.barber_id || "",
        },
        dateOnlyStr,
        lastN.some(
          (m) => m.role === "user" && clientPinnedBarberClockAndDay(String(m.content ?? ""), catalogBarbers, dateOnlyStr),
        ),
      );
      composed = true;
      bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(lastCheckThisTurn), status: "collecting" });
      await saveBookingDraft(conversationId, bookingDraft);
    }
    return finishTurn(reply, composed);
  }

  return finishTurn("", false);
}
