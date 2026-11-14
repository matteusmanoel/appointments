import { OPT_OUT_PROMO_LINE } from "../outbound/templates.js";
import OpenAI from "openai";
import { pool } from "../db.js";
import * as aiTools from "./tools.js";
import { understandTurn } from "./agent/understanding.js";
import {
  ASK_BOOKING_NAME,
  ASK_CORTE_OR_COMBO,
  ASK_HOUR,
  ASK_SERVICE,
  CLOCK_OUTSIDE_HOURS,
  PLAN_CHARGE_ACK,
  orchestrate,
  validateToolCatalogArgs,
} from "./agent/orchestrator.js";
import { composePendingIntentOffer, loadPendingIntents, savePendingIntents } from "./agent/pending-intents.js";
import type { IntentType } from "./agent/types.js";
import type { ConversationState as CanonicalConversationState } from "./agent/types.js";
import { buildAgentContext } from "./agent/context-builder.js";
import type { AgentTurnTrace } from "./turn-trace.js";
import { buildSystemPrompt, normalizeProfile } from "./prompt-builder.js";
import { retrieveKnowledge, buildKnowledgeBlock } from "./rag.js";
import { setConversationPaused } from "./runtime-pause.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";
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
import { addDaysIso, alignSpokenHour, describeShopOpenStatus, formatDateBr, formatResumoWhen, formatTimePt, formatWeekCalendarForTools, parseClientTime, pickExecutedToolDate, pickExecutedToolTime, shopOpenStatusNow, shopWindowOnIso, weekdayPtFromIso, weekdayShortPtFromIso } from "./date-calendar.js";
import type { ClientDateSource } from "./date-calendar.js";
import {
  acceptsAnyBarber,
  acceptsOfferedDay,
  assistantAskedBarberPreference,
  assistantAskedReminderRsvp,
  assistantOfferedNextOpenDay,
  assistantOfferedFitSlot,
  assistantOfferedSingleHour,
  assistantOfferedAltBarberSlot,
  bookingDateFromUserTurn,
  composeHumanConsult,
  draftPatchFromTurn,
  isClientConfirmation,
  isClientRefusal,
  isShopHoursQuestion,
  lastAssistantTurnText,
  assistantMessageIsPlanCharge,
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
  clockForNamedBarber,
  prefersNamedBarberOverTime,
  clientPinnedBarberClockAndDay,
} from "./conversation-intents.js";
import {
  applyTurnToDraft,
  composeUnavailableReply,
  composeAskService,
  composeSuggestUsualService,
  assistantSuggestedUsualService,
  resolveUsualService,
  composeAmbiguousCorte,
  draftIsCloseable,
  emptyBookingDraft,
  inferServiceKeyword,
  loadBookingDraft,
  concreteAlternativeToLock,
  firstLockableSlot,
  lockOfferedSlot,
  shouldComposeNamedBarberCard,
  mergeBookingDraft,
  offeredClockFromUnavailable,
  pickRequestedBarber,
  pickServiceFromCatalog,
  resolveBarberFromText,
  resolveMultipleServicesFromText,
  resolveServiceFromText,
  resolveCheckServiceIds,
  unknownNamedBarberFromText,
  saveBookingDraft,
  type BookingDraft,
  type CatalogBarber,
  type CatalogService,
} from "./booking-draft.js";
import type { UnavailableReason } from "./slot-fit.js";

type ClientFavoritesResult = Awaited<ReturnType<typeof aiTools.getClientFavoriteServices>>;

const INTENT_LABEL_PT: Record<IntentType, string> = {
  schedule: "o agendamento",
  reschedule: "o reagendamento",
  cancel: "o cancelamento",
  presence: "a confirmação de presença",
  waitlist: "a lista de espera",
  payment: "o pagamento (PIX)",
  plan: "os planos",
  consult: "a consulta dos horários marcados",
  location: "a localização",
  hours: "o horário de funcionamento",
  handoff: "falar com a equipe",
  unknown: "o pedido",
};

function intentLabelsPt(intents: IntentType[]): string {
  const labels = intents.map((i) => INTENT_LABEL_PT[i]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

/** Turn outcomes that close the transactional intent — the moment to offer pending intents. */
const TRANSACTION_CLOSED_STATES = new Set<string>([
  "appointment_created",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_confirmed",
]);

/**
 * Maps legacy runAgent conversation state strings to the canonical ConversationState type.
 * Legacy states predate the ADR-0002 architecture; V2 will persist canonical state directly.
 */
function mapLegacyConvState(legacy: string): CanonicalConversationState {
  switch (legacy) {
    case "offer_awaiting_confirm": return "slot_offered";
    case "awaiting_name":          return "awaiting_name";
    case "reminder_rsvp_pending":  return "reminder_24h_pending";
    case "no_upcoming":            return "idle";
    case "has_upcoming":           return "idle";
    default:                       return "idle";
  }
}

function buildOpeningMessage(barbershopName: string): string {
  const n = (barbershopName ?? "").trim() || "barbearia";
  const variants = [
    `Olá! Bem-vindo à ${n}! 😊[[MSG]]Quer ver os serviços disponíveis ou já prefere agendar um horário?`,
    `Oi, tudo bem? Seja bem-vindo à ${n}![[MSG]]Posso ajudar com algum serviço ou prefere já marcar um horário?`,
    `Olá! Seja bem-vindo à ${n}![[MSG]]Gostaria de consultar nossos serviços ou já agendar um horário?`,
  ];
  return variants[Math.floor(Date.now() / 10000) % variants.length]!;
}

export type UpcomingApptRow = {
  id: string;
  date: string;
  time: string;
  service_names: string;
  barber_name: string;
  barber_id?: string;
  service_ids?: string[];
  status?: string;
  price?: number;
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
  const statusLine = describeShopOpenStatus(openStatus);
  const consumption = buildConsumptionSummaryLines(params.clientMemory, params.favorites);
  const nameLine = params.clientName.trim()
    ? `Nome da pessoa: *${params.clientName.trim()}* (só este nome no tratamento).`
    : `Nome da pessoa: ainda não dito por ela. Não use o nome do contato do WhatsApp.`;
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
    `Ao responder sobre horário de funcionamento, diga esse fato em frase humana. Nunca recalcule se está aberto a partir da tabela e nunca repita um rótulo interno. ` +
    `Se a loja já encerrou, diga isso e quando reabre. Se a pessoa perguntou quais são os horários, inclua também a tabela de expediente da semana (o bloco acima). ` +
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
  /n[aã]o\s+consigo\s+(verificar|consultar|checar|colocar|acessar|processar)/i,
  /estou\s+tendo\s+dificuldades/i,
  /string\s+vazia/i,
  /status\s+agora/i,
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
    ? `✅ Presença confirmada, ${params.firstName}! Te esperamos ${params.when}${who}.`
    : `✅ Presença confirmada! Te esperamos ${params.when}${who}.`;
}

export function composeCancellationReply(params: {
  serviceName?: string;
  when: string;
  barberName?: string;
}): string {
  const service = params.serviceName?.trim() || "Horário";
  const who = params.barberName ? ` com o ${params.barberName}` : "";
  return `❌ ${service} de ${params.when}${who} cancelado. Quando quiser remarcar, é só chamar!`;
}

/**
 * Silence beats an error leak or a repeated bubble.
 * Deterministic slot/presence/cancel copy is passed with composed=true so it is not wiped for exposure.
 */
export type ClientReplyGuardInput = {
  reply: string;
  previousAssistant: string;
  userText: string;
  opensAt: string | null;
  closesAt: string | null;
  composed: boolean;
  /** Shop catalog names; a booking summary citing anything else is silenced. */
  catalog?: { services: string[]; barbers: string[] };
};

export type ClientReplyGuardReason = "ai_exposure" | "unaligned_hour" | "repeated_reply" | "catalog_mismatch";

export function guardClientReplyWithReason(input: ClientReplyGuardInput): {
  reply: string;
  silencedBy: ClientReplyGuardReason | null;
} {
  const reply = (input.reply ?? "").trim();
  if (!reply) return { reply: "", silencedBy: null };
  if (!input.composed && containsAiExposure(reply)) return { reply: "", silencedBy: "ai_exposure" };
  if (!input.composed && replyCitesUnalignedHour(input.userText, reply, input.opensAt, input.closesAt)) {
    return { reply: "", silencedBy: "unaligned_hour" };
  }
  if (
    !input.composed &&
    input.catalog &&
    summaryCitesItemOutsideCatalog(reply, input.catalog.services, input.catalog.barbers)
  ) {
    return { reply: "", silencedBy: "catalog_mismatch" };
  }
  if (replyRepeatsPrevious(reply, input.previousAssistant)) return { reply: "", silencedBy: "repeated_reply" };
  return { reply, silencedBy: null };
}

export function guardClientReply(input: ClientReplyGuardInput): string {
  return guardClientReplyWithReason(input).reply;
}

const SUMMARY_NON_CATALOG_TOKEN_RE =
  /\d|r\$|:\s*$|\b(hoje|amanh[aã]|depois de amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|feira|manh[aã]|tarde|noite|confirmar|confirmado|total|valor|servi[cç]os?|barbeiro|profissional|data|hor[aá]rio|hora|dia|resumo|endere[cç]o|local)\b/i;

/**
 * A booking summary (price + "Posso confirmar?") lists service and barber in bold.
 * Any bold item that is neither a catalog service nor a barber is an invented offer.
 */
export function summaryCitesItemOutsideCatalog(
  reply: string,
  serviceNames: string[],
  barberNames: string[],
): boolean {
  const text = reply ?? "";
  const looksLikeSummary = /posso\s+confirmar|r\$\s?\d/i.test(text);
  if (!looksLikeSummary) return false;
  const known = [...serviceNames, ...barberNames].map((n) => normalizeLoose(n)).filter(Boolean);
  if (!known.length) return false;
  const bold = [...text.matchAll(/\*([^*\n]{2,60})\*/g)].map((m) => (m[1] ?? "").trim());
  for (const item of bold) {
    if (SUMMARY_NON_CATALOG_TOKEN_RE.test(item)) continue;
    const norm = normalizeLoose(item);
    if (!norm) continue;
    const parts = norm.split(/\s*(?:\+|,|\be\b|\bcom\b)\s*/).map((p) => p.trim()).filter((p) => p.length >= 3);
    if (!parts.length) continue;
    const allKnown = parts.every((p) => known.some((k) => k.includes(p) || p.includes(k)));
    if (!allKnown) return true;
  }
  return false;
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
export function detectViolations(
  reply: string,
  catalog?: { services: string[]; barbers: string[] },
): string[] {
  const out: string[] = [];
  const t = (reply ?? "").trim();
  if (looksLikePhoneRequest(t)) out.push("phone_ask");
  if (UUID_REGEX.test(t)) out.push("uuid_leak");
  const emojis = t.match(EMOJI_REGEX);
  if (emojis != null && emojis.length > MAX_EMOJIS_FOR_VIOLATION) out.push("excessive_emojis");
  if (containsAiExposure(t)) out.push("ai_exposure");
  if (catalog && summaryCitesItemOutsideCatalog(t, catalog.services, catalog.barbers)) {
    out.push("service_not_in_catalog");
  }
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

/** Card of the slot a failed create or reschedule just tried to write. The draft stays open. */
export function composeUnwrittenSlotCard(slot: AvailableSlotSummary): string {
  return composeAvailableSlotConfirm(slot);
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
  /** Recent user messages (excluding current) to check when current turn omits barber name. */
  recentUserTurns?: string[],
): string {
  // Check current turn first; fall back to the most recent user turn that named an unknown barber.
  // This catches the pattern: turn 1 "com Gabriel" → turn 2 "corte e barba" (no name repeated).
  const unknownRequested =
    unknownNamedBarberFromText(rawUserText, barbers) ??
    recentUserTurns?.map((t) => unknownNamedBarberFromText(t, barbers)).find(Boolean) ??
    null;
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

/**
 * Barber for a slot check. A name said this turn wins. Otherwise a move of the
 * single upcoming appointment keeps that professional — a tool id must not
 * swap them for whoever is listed first.
 */
export function barberIdForAvailability(params: {
  namedBarberId?: string | null;
  anyBarber: boolean;
  draftBarberId?: string | null;
  upcomingBarberId?: string | null;
  toolBarberId?: string | null;
  catalogIds: readonly string[];
}): string | undefined {
  const known = new Set(params.catalogIds);
  const trusted = (id?: string | null) => (id && isValidUuid(id) ? id : undefined);
  const inCatalog = (id?: string | null) => {
    const value = trusted(id);
    if (!value) return undefined;
    return known.size === 0 || known.has(value) ? value : undefined;
  };
  const named = inCatalog(params.namedBarberId);
  if (named) return named;
  if (params.anyBarber) return inCatalog(params.toolBarberId);
  return trusted(params.upcomingBarberId) ?? trusted(params.draftBarberId) ?? inCatalog(params.toolBarberId);
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
    alternatives: holdRequestedBarber ? sameBarber.slice(0, 2) : alts,
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

function draftKeptAfterCancel(
  prev: BookingDraft,
  target?: {
    id?: string;
    date?: string;
    time?: string;
    price?: number;
    service_names?: string;
    service_ids?: string[];
    barber_name?: string;
    barber_id?: string;
  } | null,
  knownName?: boolean,
): BookingDraft {
  const date = target?.date ? String(target.date).slice(0, 10) : "";
  const time = target?.time ? String(target.time).slice(0, 5) : "";
  const hasSlot = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  return {
    ...emptyBookingDraft(),
    ...(prev.service_ids?.length ? { service_ids: prev.service_ids } : target?.service_ids?.length ? { service_ids: target.service_ids } : {}),
    service_name: prev.service_name || target?.service_names || undefined,
    barber_id: prev.barber_id || target?.barber_id,
    barber_name: prev.barber_name || target?.barber_name,
    ...(hasSlot ? { date, time } : {}),
    ...(target?.id ? { appointment_id: target.id } : {}),
    ...(typeof target?.price === "number" && Number.isFinite(target.price) ? { total_price: target.price } : {}),
    phase: "rebook_eligible",
    status: hasSlot ? (knownName ? "offered" : "awaiting_name") : "collecting",
  };
}

export function isUsableClientName(name: string | undefined): boolean {
  const t = (name ?? "").trim();
  if (t.length < 2) return false;
  const folded = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (folded === "cliente") return false;
  if (/^(undefined|null|nan|none|desconhecido)$/.test(folded)) return false;
  if (/^(por gentileza|gentileza|por favor|obrigado|obrigada|sim|ok|pode)$/.test(folded)) return false;
  if (looksLikeCancelIntent(t) || looksLikeRescheduleIntent(t)) return false;
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
  // When nameConfirmed is true the client explicitly stated their name during the
  // booking flow — trust it even when it coincides with the WhatsApp push name.
  // Push names can be real personal names; blocking them here causes spurious
  // re-asks ("Me diz seu nome para salvar" on a confirmed client).
  // The matchesUnconfirmedPush guard applies only to the unconfirmed path above.
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

/** Native or text PIX already left the chat. Drop only the key echo and keep the rest of the answer. */
export function replyWithoutPixEcho(reply: string, pixKey: string): string {
  const key = (pixKey ?? "").trim();
  const digits = key.replace(/\D/g, "");
  const kept = reply
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (key && line.includes(key)) return false;
      if (digits.length >= 8 && line.includes(digits)) return false;
      if (/chave\s+pix|te mandei a chave|pix da\b/i.test(line) && !/\b(valor|pre[cç]o|r\$)\b/i.test(line)) return false;
      return true;
    });
  const rest = kept.join("\n").trim();
  return rest || "Te mandei a chave PIX aqui.";
}

/** PIX card already went out. Keep the price when the client asked for it. */
export function replyAfterPixCard(params: {
  reply: string;
  pixKey: string;
  userText: string;
  price?: number;
}): string {
  let out = replyWithoutPixEcho(params.reply, params.pixKey);
  const askedPrice = /\b(valor|pre[cç]o|quanto)\b/i.test(params.userText);
  if (askedPrice && params.price != null && Number.isFinite(params.price) && !/r\$\s*\d/i.test(out)) {
    out = `O valor é R$ ${params.price.toFixed(2).replace(".", ",")}. ${out}`.trim();
  }
  return out;
}

const PIX_TYPE_LABEL: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  telefone: "Celular",
  email: "E-mail",
  aleatoria: "Chave aleatória",
};

export function formatBrl(price: number): string {
  return `R$ ${price.toFixed(2).replace(".", ",")}`;
}

const PIX_RECEIPT_BUBBLE =
  "Assim que realizar o pagamento, se puder nos enviar o comprovante, eu agradeço! Se tiver qualquer outra dúvida, estou à disposição. 👍";

/** Copy-chip: word joiner + narrow no-break space so WhatsApp keeps the key as one token. */
function pixKeyChip(key: string): string {
  return `\`${"\u2060\u202F"}${key}${"\u202F\u2060"}\``;
}

/** First bubble is the key. The receipt ask is a second bubble. */
export function composeShopPixReply(params: {
  pixKey: string;
  keyType?: string | null;
  holderName?: string | null;
  shopName?: string | null;
  serviceName?: string | null;
  price?: number | null;
}): string {
  const key = params.pixKey.trim();
  const typeLabel = params.keyType ? (PIX_TYPE_LABEL[params.keyType] ?? params.keyType) : null;
  const who = [params.holderName?.trim(), params.shopName?.trim()].filter(Boolean).join(" / ");
  const meta = [typeLabel ? `Chave tipo ${typeLabel}` : null, who ? `Nome: ${who}` : null].filter(Boolean).join(" • ");
  const price =
    params.price != null && Number.isFinite(params.price) ? formatBrl(params.price) : null;
  const service = params.serviceName?.trim();
  const lead =
    price && service
      ? `Fica em ${price} o ${service}. Segue a nossa chave PIX:`
      : price
        ? `Fica em ${price}. Segue a nossa chave PIX:`
        : "Segue a nossa chave PIX:";
  const card = [lead, pixKeyChip(key)];
  if (meta) card.push(`_ (${meta})_`);
  return `${card.join("\n\n")}[[MSG]]${PIX_RECEIPT_BUBBLE}`;
}

/** The pin already went out; the text only acknowledges it. */
export function composeLocationSent(): string {
  return "Enviei nossa localização.[[MSG]]Se precisar de mais alguma coisa, é só avisar!";
}

/** Model wrote an RSVP success line. Valid only after confirm_appointment sets appointment_confirmed. */
export function replyClaimsPresenceConfirmed(reply: string): boolean {
  return /presen[cç]a\s+confirmada/i.test(reply);
}

/** A reply that claims this turn created or confirmed a booking, not a recap of one that already exists. */
export function looksLikeHallucinatedBookingClaim(reply: string): boolean {
  return /agendamento\s+(foi\s+)?confirmado|aguardamos\s+você\b|\bconfirmei\s+(o|seu|a\s+sua?)\s+(agendamento|remarca[cç][aã]o|horário)\b|n[aã]o\s+consegui\s+validar|atendente\s+confere/i.test(
    reply,
  );
}

export function composeUpcomingRecap(params: {
  firstName?: string;
  serviceName: string;
  when: string;
  barberName?: string;
  price?: number;
}): string {
  const who = params.firstName
    ? `${params.firstName}, seu horário está agendado para `
    : "Seu horário está agendado para ";
  const when = params.when ? params.when.charAt(0).toLowerCase() + params.when.slice(1) : params.when;
  const service = params.serviceName.trim() || "o serviço combinado";
  const barber = params.barberName?.trim().split(/\s+/)[0];
  const withBarber = barber ? ` com o ${barber}` : "";
  const price =
    params.price != null && Number.isFinite(params.price) ? ` O valor é ${formatBrl(params.price)}.` : "";
  const body = `${who}${when}: ${service}${withBarber}.${price}`
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
  return `${body}[[MSG]]Se precisar cancelar ou reagendar é só dizer o novo dia e horário que eu ajusto pra você.`;
}

/** Mid-sentence when: "amanhã, segunda-feira (28/09) às 15h". */
export function formatMarkedWhen(dateIso: string, timeHHmm: string, todayIso: string): string {
  const weekday = weekdayPtFromIso(dateIso);
  const ddmm = formatDateBr(dateIso).slice(0, 5);
  const body = `${weekday} (${ddmm}) às ${formatTimePt(timeHHmm)}`;
  if (dateIso === todayIso) return `hoje, ${body}`;
  if (dateIso === addDaysIso(todayIso, 1)) return `amanhã, ${body}`;
  return body;
}

/** Minutes from the shop's local clock until the appointment starts. */
export function minutesUntilAppointment(params: {
  dateIso: string;
  timeHHmm: string;
  todayIso: string;
  nowHHmm: string;
}): number | null {
  const time = params.timeHHmm.slice(0, 5);
  const now = params.nowHHmm.slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.dateIso) || !/^\d{4}-\d{2}-\d{2}$/.test(params.todayIso)) return null;
  if (!/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(now)) return null;
  const [y, m, d] = params.dateIso.split("-").map(Number);
  const [ty, tm, td] = params.todayIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const [nh, nm] = now.split(":").map(Number);
  const start = Date.UTC(y!, (m ?? 1) - 1, d, hh, mm);
  const current = Date.UTC(ty!, (tm ?? 1) - 1, td, nh, nm);
  return Math.round((start - current) / 60000);
}

/** Second bubble only when the 2h reminder can still be sent. */
export const REMINDER_BUBBLE_LEAD_MINUTES = 180;

export function composeBookingCreated(params: {
  firstName: string;
  serviceName: string;
  when: string;
  barberName?: string;
  remindBefore?: boolean;
}): string {
  const barber = params.barberName?.trim().split(/\s+/)[0];
  const withPro = barber ? `, com o profissional ${barber}` : "";
  const booked = `✅ Agendado, ${params.firstName}! Seu horário de ${params.serviceName} está marcado para ${params.when}${withPro}.`;
  // Instrução de opt-out em toda confirmação (lp-correcoes §16.6, parecer I-04).
  // Sem lembrete de 2h (horário próximo): NÃO promete lembretes, só a instrução de opt-out.
  if (!params.remindBefore) return `${booked}\n\n${OPT_OUT_PROMO_LINE}`;
  return `${booked}[[MSG]]Enviaremos um lembrete 2h antes e pedimos que confirme para garantir o seu horário. Até lá!\n\n${OPT_OUT_PROMO_LINE}`;
}

export function composeRescheduleDone(params: {
  firstName: string;
  serviceName: string;
  when: string;
  barberName?: string;
}): string {
  const barber = params.barberName?.trim().split(/\s+/)[0];
  const withPro = barber ? `, com o profissional ${barber}` : "";
  return `✅ Pronto, ${params.firstName}! Seu horário de ${params.serviceName} ficou para ${params.when}${withPro}.`;
}

/** The offered card names a different clock than the draft. Affirmation must not write the stale draft. */
export function rescheduleDraftMatchesOffer(draftTime: string | undefined, assistantText: string): boolean {
  const offered = parseClientTime(assistantText);
  const draft = (draftTime ?? "").slice(0, 5);
  if (!offered || !/^\d{2}:\d{2}$/.test(draft)) return true;
  return offered.slice(0, 5) === draft;
}

/** Model invented a booking failure. A real unavailable check is composed elsewhere. */
export function replyNarratesBookingFailure(reply: string): boolean {
  return /j[aá] est[aá] ocupad|tamb[eé]m est[aá] ocupad|n[aã]o estou conseguindo|n[aã]o consegui reagendar|mais um momento para resolver/i.test(
    reply,
  );
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

/**
 * The model is negotiating a slot (busy, or a menu of times) without a
 * check_availability result from this turn. That reply must not reach the client.
 */
/** The reply asserts a clock is free. A failed check must not become this claim. */
export function replyClaimsSlotIsFree(reply: string): boolean {
  const t = (reply ?? "").toLowerCase();
  return /\b(livres?|dispon[ií]vel|tenho\s+[aà]s|pode ser [aà]s)\b/.test(t);
}

export function replyNegotiatesUnverifiedSlots(reply: string): boolean {
  const text = reply.toLowerCase();
  if (/n[aã]o est[aá] dispon[ií]vel|indispon[ií]vel|op[cç][oõ]es dispon/.test(text)) return true;
  const clocks = text.match(/\b\d{1,2}\s*h\d{0,2}\b/g) ?? [];
  return clocks.length >= 2;
}

/**
 * This turn names a clock that is not the sole upcoming appointment.
 * The date stays on that row unless the turn named another day.
 */
export function pendingMoveSlot(params: {
  userText: string;
  upcomingDate: string;
  upcomingTime: string;
  date: string;
  opensAt: string | null;
  closesAt: string | null;
}): { date: string; time: string } | null {
  const raw = parseClientTime(params.userText);
  if (!raw) return null;
  const time = alignSpokenHour(params.userText, raw, params.opensAt, params.closesAt).slice(0, 5);
  const date = params.date.slice(0, 10);
  const same =
    date === params.upcomingDate.slice(0, 10) && time === params.upcomingTime.slice(0, 5);
  if (same || !/^\d{2}:\d{2}$/.test(time) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, time };
}

/**
 * Bare yes to a card that asked "Posso confirmar?" and named a clock.
 * A new clock in the user text is a move, not this acceptance.
 */
export function affirmedUnverifiedClock(params: {
  userText: string;
  previousAssistant: string;
  affirmative: boolean;
  askedConfirmation: boolean;
  opensAt: string | null;
  closesAt: string | null;
}): string | null {
  if (!params.affirmative || !params.askedConfirmation) return null;
  if (parseClientTime(params.userText)) return null;
  const raw = parseClientTime(params.previousAssistant);
  if (!raw) return null;
  const time = alignSpokenHour(params.previousAssistant, raw, params.opensAt, params.closesAt).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(time) ? time : null;
}

/** Says the appointment is already at a clock that is not the row on file. */
export function replyClaimsOtherClock(reply: string, bookedTimeHHmm: string): boolean {
  if (!/est[aá] agendado|est[aá] marcado|posso confirmar/i.test(reply)) return false;
  const cited = parseClientTime(reply);
  if (!cited) return false;
  return cited.slice(0, 5) !== bookedTimeHHmm.slice(0, 5);
}

/** Service, barber, date and time the client named in this turn. History does not count. */
export function understoodBookableSlot(intent: {
  primary: string;
  intents: string[];
  service: { ids?: string[] } | "ambiguous" | null;
  barber: { kind: string; id?: string } | null;
  dateTime: { date?: string; time?: string } | null;
}): { date: string; time: string; barberId: string; serviceIds: string[] } | null {
  if (intent.primary !== "schedule" && !intent.intents.includes("schedule")) return null;
  const service = intent.service;
  const barber = intent.barber;
  const date = intent.dateTime?.date;
  const time = intent.dateTime?.time;
  if (!service || service === "ambiguous" || !service.ids?.length) return null;
  if (!barber || barber.kind !== "named" || !barber.id) return null;
  if (!date || !time) return null;
  return { date, time, barberId: barber.id, serviceIds: service.ids };
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

/** Words that open a message but are never the client's own name (greetings, vocatives, fillers). */
const LEADING_NON_NAME_WORDS = new Set([
  "oi", "oie", "oii", "ola", "opa", "salve", "eai", "iae", "fala", "hey", "hello", "bom", "boa", "dia", "tarde",
  "noite", "tudo", "td", "beleza", "blz", "show", "top", "joia", "ok", "okay", "sim", "nao", "claro", "certo",
  "entao", "bem", "olha", "veja", "tipo", "cara", "mano", "brother", "bro", "parceiro", "amigo", "amiga",
  "chefe", "mestre", "irmao", "moco", "moca", "senhor", "senhora", "pessoal", "galera", "gente", "obrigado",
  "obrigada", "valeu", "vlw", "por", "favor", "gostaria", "quero", "queria", "preciso", "pode", "poderia",
  "consegue", "tem", "teria", "hoje", "amanha", "depois", "agora", "sera", "sabe", "desculpa", "perdao",
  "barbearia", "barbeiro", "atendente", "corte", "barba", "cabelo", "horario", "agenda", "agendamento",
  "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo", "manha", "que", "qual", "quando",
  "como", "onde", "voce", "voces", "vc", "vcs", "eu", "me", "meu", "minha", "aqui", "la", "ai", "isso", "esse",
  "essa", "este", "esta", "ja", "so", "tambem", "e", "o", "a", "os", "as", "um", "uma", "de", "do", "da",
]);

/**
 * A booking message that opens with the client's own name: "Mateus, corte amanhã às 15h".
 * Only a comma/period/colon-separated opener counts, and only when the rest of the
 * message carries a booking signal (verb, date, clock or catalog service). Greetings,
 * vocatives, barber names and the shop name are never taken as the client's name.
 */
export function extractLeadingAddressedName(
  text: string,
  ctx: { todayIso: string; serviceNames: string[]; barberNames: string[]; shopName?: string },
): string | null {
  const raw = (text ?? "").replace(/\p{Extended_Pictographic}/gu, " ").replace(/\s+/g, " ").trim();
  const m = raw.match(/^([A-Za-zÀ-ÖØ-öø-ÿ']{2,20}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ']{2,20})?)\s*[,.:;–—-]\s*(.{4,})$/);
  if (!m) return null;
  const candidate = (m[1] ?? "").trim();
  const rest = (m[2] ?? "").trim();
  const words = candidate.split(" ").map((w) => foldName(w));
  if (words.some((w) => LEADING_NON_NAME_WORDS.has(w))) return null;
  const folded = foldName(candidate);
  const collides = [...ctx.serviceNames, ...ctx.barberNames, ctx.shopName ?? ""]
    .map((n) => foldName(n))
    .filter((n) => n.length >= 2)
    .some((n) => n === folded || n.split(/\s+/).includes(words[0] ?? ""));
  if (collides) return null;
  if (!isUsableClientName(candidate)) return null;
  const restFolded = foldName(rest);
  const mentionsService = ctx.serviceNames.some((s) => {
    const first = foldName(s).split(/\s+/)[0] ?? "";
    return first.length >= 4 && restFolded.includes(first);
  });
  const hasBookingSignal =
    looksLikeNewBookingIntent(rest) ||
    looksLikeRescheduleIntent(rest) ||
    Boolean(parseClientTime(rest)) ||
    Boolean(bookingDateFromUserTurn(rest, ctx.todayIso)) ||
    mentionsService;
  return hasBookingSignal ? candidate : null;
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
· PIX / pagar / débito / acerto → send_shop_pix. O sistema manda valor e chave numa mensagem só. Não repita a chave nem monte cartão. Cobrança mensal de plano → send_pix_plan_charge.
· Planos / assinatura / mensalidade → list_plans antes de responder; "quero pagar/assinar" também send_shop_pix, sem abrir corte.
· Fila / me avise se liberar → add_to_waitlist. Localização → send_barbershop_location (máx. 1). Expediente → contexto operacional, sem recalcular. Humano → string vazia (handoff).
· Serviço + data/hora → check_availability. Sem hora → get_next_slots. service_ids: UUID do combo se existir; senão combine UUIDs. Não invente UUID.
· Hora falada de 1 a 8, sem "da manhã", antes da abertura = mesmo horário à tarde (às 6 com abertura às 9h = 18h).

--- FLUXOS CANÔNICOS ---
AGENDAR: check_availability ou get_next_slots → resumo *Serviço* | *Barbeiro* | Dia dd/MM às HHh | R$ X,XX + "Posso confirmar?" → sem nome, peça o nome → create_appointment.
Após create_appointment ou reschedule_appointment com sucesso: não escreva a confirmação — o sistema envia.
RSVP sucesso: "Presença confirmada, [Nome]! Te esperamos [dia dd/MM às HHh] com o [Barbeiro]." Só depois que confirm_appointment retornar ok neste turno. Afirmação sem lembrete pendente não confirma presença.
CANCELAR: "[Serviço] de [dia/hora] com o [Barbeiro] cancelado. Quando quiser remarcar, é só chamar!"
FILA: "Anotei! Se o horário das [hora] com o [Barbeiro] abrir, te aviso aqui."
Erro de ferramenta ao gravar horário: responda string vazia. Não diga que está ocupado nem que não conseguiu.

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
- Nunca escrever "Presença confirmada" se confirm_appointment não retornou ok neste turno.
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
        "Prepara a chave PIX da loja (débito, plano ou acerto avulso). O sistema manda valor e chave numa mensagem. Não repita a chave. Não chama confirm_appointment.",
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
  /** Structured slice of this turn. The worker logs it; it does not change the reply. */
  turnTrace?: AgentTurnTrace;
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

export async function supportsSelectedBarbershopColumn(): Promise<boolean> {
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
  // ── Load all DB context via context-builder ──────────────────────────────
  const _ctx = await buildAgentContext(
    barbershopId,
    conversationId,
    clientPhone,
    options?.simulatedNow
  );

  // Destructure immutable fields
  const {
    settings,
    billingPlan,
    accountBranches,
    numberMode,
    messageCount,
    premiumAvailable,
    usePremiumByMessages,
    timeZone,
    dateTimeStr,
    dateOnlyStr,
    tomorrowOnlyStr,
    currentTimeHHmm,
    barbershopName,
    businessHoursRaw,
    shopAddress,
    hasGeoLocation,
    clientNameConfirmed,
    whatsappPushName,
    clientMemory,
    upcomingAppointments,
    upcomingBooked,
    lastVisit,
    history,
    lastN,
  } = _ctx;

  // Mutable fields (may be updated during the turn)
  let effectiveBarbershopId = _ctx.effectiveBarbershopId;
  let clientName = _ctx.clientName;
  let bookingDraft = _ctx.bookingDraft;
  const lastUserTextRaw = _ctx.lastUserTextRaw;
  const clientFavorites = _ctx.clientFavorites as ClientFavoritesResult | null;

  // ── Derived constants (unchanged from original) ─────────────────────────
  const ESCALATION_TOOL_ERROR_THRESHOLD = 2;
  let usePremiumModel = usePremiumByMessages;
  let model: string = usePremiumModel
    ? (settings?.model_premium ?? settings?.model ?? "gpt-4o-mini")
    : (settings?.model ?? "gpt-4o-mini");
  const temperature = settings?.temperature ?? 0.3;
  const draft = options?.sandboxDraft;
  const useDraft = draft && draft.agent_profile != null && typeof draft.agent_profile === "object";
  const persistAssistantMessages = options?.persistAssistantMessages !== false;
  const hasProfile =
    useDraft ||
    (settings?.agent_profile != null &&
      typeof settings.agent_profile === "object" &&
      Object.keys(settings.agent_profile as object).length > 0);

  // ── System prompt (built from context data) ──────────────────────────────
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

  // Late-binding catalog — populated after the catalog fetch below; safe to reference in closures.
  let lateCatalogServices: CatalogService[] = [];

  const operationalContextBlock = buildOperationalContextBlock({
    barbershopName,
    timeZone,
    dateTimeStr,
    dateOnlyStr,
    clientName: confirmedPersonName({
      storedName: clientName,
      nameConfirmed: clientNameConfirmed,
      pushName: whatsappPushName,
    }),
    businessHoursRaw,
    clientMemory,
    favorites: clientFavorites,
    address: shopAddress || null,
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
      `Consulta lista os horários. Saudação com horário futuro cita só o próximo, com o texto fixo. ` +
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

  const lastUserText = lastUserTextRaw.toLowerCase().trim();

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
  // decisionOwner is updated after routing runs; default to llm_tool_loop.
  const turnTrace: AgentTurnTrace = {
    decisionOwner: "llm_tool_loop",
    conversationState: "",
    canonicalState: null,
    intent: null,
    routing: null,
    nameKnown: Boolean(clientName && isUsableClientName(clientName)),
    nameSource: null,
    openai: [],
    toolsExecuted: [],
    catalogRejections: [],
  };
  function withDebug<T extends AgentResult>(result: T): T {
    const cleaned = { ...result, reply: sanitizeClientFacingReply(result.reply), turnTrace };
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

  const [catalogServicesRaw, catalogBarbersRaw] = await Promise.all([
    aiTools.listServices(effectiveBarbershopId),
    aiTools.listBarbers(effectiveBarbershopId),
  ]);
  const catalogServices = catalogFromUnknown(catalogServicesRaw);
  lateCatalogServices = catalogServices;
  const catalogBarbers = catalogBarbersFromUnknown(catalogBarbersRaw);

  // Proactive name capture: "meu nome é X" or a booking message that opens with the
  // client's own name ("Mateus, corte amanhã às 15h") is persisted now so the closing
  // step never asks for it again.
  const explicitNameRaw = extractNameFromText(lastUserTextRaw);
  const leadingNameRaw = explicitNameRaw
    ? null
    : extractLeadingAddressedName(lastUserTextRaw, {
        todayIso: dateOnlyStr,
        serviceNames: catalogServices.map((s) => s.name),
        barberNames: catalogBarbers.map((b) => b.name),
        shopName: barbershopName,
      });
  const extractedRaw = explicitNameRaw ?? leadingNameRaw;
  const extractedName = extractedRaw ? aiTools.formatStoredClientName(extractedRaw) ?? extractedRaw : null;
  if (extractedName) {
    turnTrace.nameSource = explicitNameRaw ? "explicit" : "leading_address";
  }
  if (extractedName && (!clientName || normalizeLoose(clientName) !== normalizeLoose(extractedName))) {
    aiTools.upsertClient(effectiveBarbershopId, clientPhone, extractedName).catch(() => {});
    clientName = extractedName;
  }

  let spokenHourOutside = false;
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
          if (window.start && parsed < window.start && desiredTime < window.start) spokenHourOutside = true;
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
    if (turnTime && !isShopHoursQuestion(lastUserTextRaw)) {
      const dateForWindow =
        bookingDateFromUserTurn(lastUserTextRaw, dateOnlyStr)?.date ?? desiredDate ?? dateOnlyStr;
      const window = shopWindowOnIso(
        dateForWindow,
        businessHoursRaw as Parameters<typeof shopWindowOnIso>[1],
      );
      desiredTime = alignSpokenHour(lastUserTextRaw, turnTime, window.start, window.end);
      if (window.start && turnTime < window.start && desiredTime < window.start) spokenHourOutside = true;
    }

    const offeredClock = offeredFitClockIfAccepted({
      lastAssistant: lastAssistantTurnText(history),
      lastUser: lastUserTextRaw,
    });
    if (offeredClock && !turnTime) desiredTime = offeredClock;

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

  const turnFacts = draftPatchFromTurn({
    text: lastUserTextRaw,
    todayIso: dateOnlyStr,
    services: catalogServices,
    barbers: catalogBarbers,
  });
  // "Vai ser o de sempre, X?": a proposta vale só para a resposta ao turno imediatamente seguinte. O "sim" só a
  // aceita se a última fala do agente FOI a sugestão (o rascunho sozinho não basta: um "sim" a outra pergunta,
  // "pode contar comigo" ou "vou sim" não aplica o de sempre). Qualquer outra resposta descarta a proposta.
  const usualProposal = bookingDraft.pendingProposal;
  const usualSuggestionOpen =
    bookingDraft.lastAgentQuestion === "usual_service" && Boolean(usualProposal?.service_ids?.length);
  const usualSuggestionIsPreviousTurn =
    usualSuggestionOpen && assistantSuggestedUsualService(lastAssistantTurnText(lastN));
  // O serviço pode ter saído do catálogo entre a sugestão e o sim: nesse caso não aceita.
  const catalogIds = new Set(catalogServices.map((s) => s.id));
  const usualServiceAccepted =
    usualSuggestionIsPreviousTurn &&
    isClientConfirmation(lastUserTextRaw) &&
    !turnFacts.patch.service_ids?.length &&
    (usualProposal?.service_ids ?? []).every((id) => catalogIds.has(id));
  const usualServiceRefused =
    usualSuggestionIsPreviousTurn && isClientRefusal(lastUserTextRaw) && !turnFacts.patch.service_ids?.length;
  if (usualServiceAccepted && usualProposal) {
    bookingDraft = mergeBookingDraft(bookingDraft, {
      service_ids: usualProposal.service_ids,
      service_name: usualProposal.service_name,
      pendingProposal: null,
      lastAgentQuestion: null,
    });
  } else if (usualSuggestionOpen) {
    bookingDraft = mergeBookingDraft(bookingDraft, {
      pendingProposal: null,
      lastAgentQuestion: usualServiceRefused ? "service" : null,
    });
  }
  if (typeof turnFacts.patch.time === "string" && /^\d{2}:\d{2}/.test(turnFacts.patch.time)) {
    const clockDate = turnFacts.patch.date || bookingDraft.date || dateOnlyStr;
    const clockWindow = shopWindowOnIso(
      clockDate,
      businessHoursRaw as Parameters<typeof shopWindowOnIso>[1],
    );
    turnFacts.patch.time = alignSpokenHour(
      lastUserTextRaw,
      turnFacts.patch.time.slice(0, 5),
      clockWindow.start,
      clockWindow.end,
    );
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
    if (
      looksLikeRescheduleIntent(t) ||
      looksLikeCancelIntent(t) ||
      looksLikeNewBookingIntent(t)
    ) {
      return false;
    }
    return /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(t) && t.split(" ").filter(Boolean).length <= 4;
  })();

  const nameFromUserForBooking = (() => {
    if (acceptsAnyBarber(lastUserTextRaw)) return "";
    const raw =
      extractedName ??
      (assistantAskedName && isLikelyNameOnly && lastUserText.trim() ? lastUserText.trim() : "");
    if (!raw) return "";
    return aiTools.formatStoredClientName(raw) ?? raw;
  })();
  const bookingName = confirmedPersonName({
    statedThisTurn: nameFromUserForBooking,
    storedName: clientName,
    nameConfirmed: clientNameConfirmed || Boolean(nameFromUserForBooking),
    pushName: whatsappPushName,
  });
  turnTrace.nameKnown = Boolean(bookingName);

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
    : (lastWasReminder || recentReminderSent) && upcomingBooked === "pending"
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

  // ── Understanding + Orchestrator (V1 — additive, does not yet replace existing logic) ─────
  // Produces structured IntentSet and deterministic routing decisions from the current turn.
  // Informs: barber disclosure, intent conflict resolution, plan_offered clearing, handoff.
  const canonicalConvState = mapLegacyConvState(conversationState);
  turnTrace.conversationState = conversationState;
  turnTrace.canonicalState = canonicalConvState;
  const intentSet = understandTurn({
    text: lastUserTextRaw,
    todayIso: dateOnlyStr,
    services: catalogServices,
    barbers: catalogBarbers,
    previousState: canonicalConvState,
    conversationId,
  });
  const pendingIntents = await loadPendingIntents(conversationId);
  let hasActiveSubscription = false;
  if (intentSet.primary === "plan" || intentSet.intents.includes("plan")) {
    try {
      const listed = (await aiTools.listClientPlanSubscription(effectiveBarbershopId, clientPhone)) as {
        found?: boolean;
      };
      hasActiveSubscription = listed?.found === true;
    } catch {
      hasActiveSubscription = false;
    }
  }
  const speechWindow = shopWindowOnIso(
    desired.desiredDate || dateOnlyStr,
    businessHoursRaw as Parameters<typeof shopWindowOnIso>[1],
  );
  const spokenRaw = isShopHoursQuestion(lastUserTextRaw) ? null : parseClientTime(lastUserTextRaw);
  const alignedSpoken = spokenRaw
    ? alignSpokenHour(lastUserTextRaw, spokenRaw, speechWindow.start, speechWindow.end)
    : undefined;
  const replyingToPlanCharge = assistantMessageIsPlanCharge(lastAssistantTurnText(lastN));
  const routing = orchestrate({
    intentSet,
    conversationState: canonicalConvState,
    previousTurnConfidence: undefined, // TODO V2: persist per-turn confidence in DB
    hasUpcomingAppointment: upcomingAppointments.length > 0,
    hasActiveBookingDraft: !!(bookingDraft.service_ids?.length || bookingDraft.service_name),
    pendingIntents,
    isAffirmative: isAffirmativeOnly,
    waitlistOfferOpen: bookingDraft.waitlistOffer === true && Boolean(bookingDraft.date && bookingDraft.time && bookingDraft.service_name),
    hasPersonName: Boolean(bookingName),
    nameStatedThisTurn: Boolean(nameFromUserForBooking),
    hasActiveSubscription,
    carriedClock: alignedSpoken ?? bookingDraft.time ?? null,
    namedBarberThisTurn:
      Boolean(resolveBarberFromText(lastUserTextRaw, catalogBarbers)) && !parseClientTime(lastUserTextRaw),
    carriedServiceIds: bookingDraft.service_ids?.length
      ? bookingDraft.service_ids
      : (upcomingAppointments[0]?.service_ids ?? []),
    replyingToPlanCharge,
    spokenHourOutside,
    usualService: resolveUsualService({ favorites: clientFavorites, memory: clientMemory, catalog: catalogServices }),
    usualServiceAlreadySuggested: Boolean(bookingDraft.usualSuggested),
    usualServiceAccepted,
  });
  if (routing.primaryIntent === "hours") {
    const openNow = shopOpenStatusNow({
      todayIso: dateOnlyStr,
      nowHHmm: currentTimeHHmm,
      businessHours: (businessHoursRaw ?? null) as Parameters<typeof shopOpenStatusNow>[0]["businessHours"],
    });
    routing.turnDirective = describeShopOpenStatus(openNow);
  }
  if (JSON.stringify(routing.nextPending) !== JSON.stringify(pendingIntents)) {
    await savePendingIntents(conversationId, routing.nextPending);
  }
  const resumingPending = routing.resumedPending.length > 0;
  const routingApplied: string[] = [];
  turnTrace.intent = {
    primary: intentSet.primary,
    intents: intentSet.intents,
    confidence: intentSet.confidence,
    service:
      intentSet.service == null
        ? null
        : intentSet.service === "ambiguous"
          ? "ambiguous"
          : intentSet.service.name,
    barber:
      intentSet.barber == null
        ? null
        : intentSet.barber.kind === "any"
          ? "any"
          : intentSet.barber.name,
    date: intentSet.dateTime?.date ?? null,
    time: alignedSpoken ?? intentSet.dateTime?.time ?? null,
  };
  // Orchestrator takes ownership when it blocks/restricts the LLM's freedom.
  if (!routing.recordingAuthorized || routing.waitlistMissingClock || routing.triggerHandoff) {
    turnTrace.decisionOwner = "orchestrator";
  }

  turnTrace.routing = {
    primaryIntent: routing.primaryIntent,
    triggerHandoff: routing.triggerHandoff,
    handoffReason: routing.handoffReason,
    clearPlanOffered: routing.clearPlanOffered,
    requiresBarberDisclosure: routing.requiresBarberDisclosure,
    unknownBarberName: routing.unknownBarberName,
    handleNow: routing.handleNow,
    deferred: routing.deferred,
    applied: routingApplied,
    allowedTools: routing.allowedTools,
  };

  const secondaryNow = routing.handleNow.slice(1);
  if (resumingPending) {
    routingApplied.push("resume_pending");
    systemPrompt +=
      `\n\nPEDIDO RETOMADO: o cliente aceitou ver agora ${intentLabelsPt(routing.resumedPending)}. ` +
      "Trate só isso neste turno (planos → list_plans; pagamento → send_shop_pix; localização → send_barbershop_location). " +
      "O agendamento anterior já está fechado: não chame create_appointment, reschedule_appointment nem confirm_appointment.";
  } else if (secondaryNow.length) {
    routingApplied.push("companion_same_turn");
    systemPrompt +=
      `\n\nPEDIDOS NO MESMO TURNO: o principal é ${intentLabelsPt([routing.primaryIntent])}; o cliente também pediu ${intentLabelsPt(secondaryNow)}. ` +
      "Resolva o principal primeiro e atenda os demais neste mesmo turno com a ferramenta correspondente " +
      "(pagamento → send_shop_pix; localização → send_barbershop_location). Só afirme o que as ferramentas retornaram.";
  }
  if (routing.deferred.length) {
    routingApplied.push("defer_secondary");
    systemPrompt +=
      `\n\nPEDIDO ADIADO: o cliente também mencionou ${intentLabelsPt(routing.deferred)}. ` +
      `Neste turno trate só ${intentLabelsPt([routing.primaryIntent])}. Não responda sobre ${intentLabelsPt(routing.deferred)} ` +
      "nem diga que já resolveu — isso será oferecido automaticamente quando o principal fechar.";
  }

  // Barber substitution guardrail: if Understanding detected an unknown named barber,
  // inject a system guardrail so the LLM doesn't silently substitute.
  if (routing.requiresBarberDisclosure && routing.unknownBarberName) {
    routingApplied.push("barber_disclosure");
    systemPrompt =
      systemPrompt +
      `\n\nAVISO: o cliente pediu o barbeiro "${routing.unknownBarberName}" que NÃO está na equipe. ` +
      `Antes de oferecer um slot, informe isso de forma simpática e apresente quem está disponível naquele horário.`;
  }

  // Unknown intent: no recording tools allowed this turn.
  // The agent must ask an objective clarifying question and must not call any write tool.
  if (routing.primaryIntent === "unknown" && !routing.recordingAuthorized) {
    routingApplied.push("no_recording");
    systemPrompt +=
      "\n\nINTENÇÃO NÃO IDENTIFICADA: Faça uma pergunta objetiva para entender o que o cliente quer. " +
      "PROIBIDO neste turno: create_appointment, reschedule_appointment, cancel_appointment, " +
      "add_to_waitlist, update_client_notes, confirm_appointment e qualquer ferramenta que grava dados.";
  }
  systemPrompt +=
    `\n\nFERRAMENTAS DESTE TURNO: ${routing.allowedTools.length ? routing.allowedTools.join(", ") : "nenhuma"}. ` +
    "Qualquer outra chamada é recusada e não vira handoff. " +
    "Não escolha uma hora que a pessoa não disse e que não está no rascunho. " +
    "Pergunte a hora só quando a pessoa está marcando ou remarcando e a hora ainda não foi dita. " +
    "Pedido de chave PIX, endereço ou valor não é pedido de horário. " +
    "Um sim curto, mesmo com uma cortesia antes, aceita o horário já oferecido. " +
    "Desistir de ir ou pedir para cancelar cancela o horário atual na hora: não diga que a ação falhou e não use esse pedido como nome.";
  if (routing.primaryIntent === "plan" && hasActiveSubscription) {
    systemPrompt +=
      "\n\nQuem já tem plano e pede a cobrança: chame send_pix_plan_charge. Não crie outra assinatura.";
  } else if (routing.primaryIntent === "plan" && bookingName) {
    systemPrompt +=
      "\n\nA pessoa disse o nome. Chame subscribe_client_to_plan no plano que ela pediu. A chave da primeira cobrança sai junto.";
  }
  const establishedFact = routing.turnDirective || (spokenHourOutside ? CLOCK_OUTSIDE_HOURS : "");
  if (establishedFact) {
    systemPrompt += `\nSe a frase do modelo não puder sair, diga só: ${establishedFact}`;
  }

  // Waitlist with incomplete clock: orchestrator blocks add_to_waitlist and asks for missing fields.
  if (routing.waitlistMissingClock) {
    routingApplied.push("waitlist_clock_incomplete");
    const fieldLabels: Record<string, string> = { date: "data", time: "horário", service: "serviço" };
    const missing = routing.waitlistMissingClock.map((f) => fieldLabels[f] ?? f).join(", ");
    systemPrompt +=
      `\n\nFILA DE ESPERA — dados incompletos: falta ${missing}. ` +
      "Pergunte só o que falta. NÃO chame add_to_waitlist até ter data, horário e serviço.";
  }

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
              "PRIMEIRO HORÁRIO: é a abertura do dia pedido, o mesmo serviço e o mesmo barbeiro. " +
              "Chame check_availability nesse horário de abertura. " +
              "Se a abertura já passou, use o próximo relógio desse dia em que o serviço cabe. " +
              "Não repita o horário que a pessoa já tem e não troque de barbeiro.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isAffirmativeOnly &&
    (assistantAskedConfirmation || assistantOfferedSingleHour(previousAssistantEarly)) &&
    Boolean(upcomingBooked) &&
    !resumingPending
      ? ([
          {
            role: "system",
            content:
              "CONFIRMAÇÃO DE REAGENDAMENTO: o cliente aceitou a hora já oferecida, inclusive 'pode sim' com uma cortesia antes, ou quando a oferta foi 'Fica bom?' ou 'Quer esse?'. " +
              "Chame reschedule_appointment com o appointment_id atual, o mesmo barbeiro e essa hora. Não cancele, não crie outro, não troque de barbeiro e não chame confirm_appointment.",
          },
        ] as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
      : []),
    ...(isAffirmativeOnly && assistantAskedConfirmation && !upcomingBooked && !resumingPending
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
    if (state === "appointment_cancelled") return phrase();
    if (!looksLikeCancelIntent(lastUserTextRaw) || looksLikeRescheduleIntent(lastUserTextRaw)) return reply;
    if (!target?.id) return "Você não tem horário marcado agora.";
    const r = await aiTools.cancelAppointmentByAgent(
      currentBarbershopId,
      target.id,
      clientPhone,
      conversationId,
    );
    if (!(r && typeof r === "object" && (r as { ok?: boolean }).ok === true)) return reply;
    state = "appointment_cancelled";
    bookingDraft = draftKeptAfterCancel(bookingDraft, target, Boolean(bookingName));
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
    const guarded = guardClientReplyWithReason({
      reply,
      previousAssistant,
      userText: lastUserTextRaw,
      opensAt: window.start,
      closesAt: window.end,
      composed,
      catalog: {
        services: catalogServices.map((s) => s.name),
        barbers: [
          ...catalogBarbers.map((b) => b.name),
          ...(clientName ? [clientName] : []),
          ...(barbershopName ? [barbershopName] : []),
        ],
      },
    });
    if (guarded.silencedBy) {
      turnTrace.silencedBy = guarded.silencedBy;
      if (guarded.silencedBy === "repeated_reply" && (composed || establishedFact)) {
        return establishedFact || reply;
      }
      return establishedFact;
    }
    return guarded.reply;
  }

  async function finishTurn(reply: string, composed: boolean) {
    if (state === "handoff_requested") {
      const out = applyOutputGuard(reply, true);
      await persistAssistant(out);
      return withDebug({ reply: out, usage: totalUsage, state });
    }
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
    } else if (state === "appointment_created" || state === "appointment_rescheduled") {
      const dateIso = String(bookingDraft.date ?? "").slice(0, 10);
      const timeHHmm = String(bookingDraft.time ?? "").slice(0, 5);
      const when = formatMarkedWhen(dateIso, timeHHmm, dateOnlyStr);
      const lead = {
        firstName: firstNameFromClientName(bookingName || clientName || "você"),
        serviceName: bookingDraft.service_name || "Horário",
        when,
        barberName: bookingDraft.barber_name,
      };
      const mins = minutesUntilAppointment({
        dateIso,
        timeHHmm,
        todayIso: dateOnlyStr,
        nowHHmm: currentTimeHHmm,
      });
      out =
        state === "appointment_created"
          ? composeBookingCreated({
              ...lead,
              remindBefore: mins != null && mins >= REMINDER_BUBBLE_LEAD_MINUTES,
            })
          : composeRescheduleDone(lead);
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
    const consultRecap =
      routing.primaryIntent === "consult" && !state && upcomingAppointments.length > 0;
    if (consultRecap) {
      const next = upcomingAppointments[0];
      out = composeUpcomingRecap({
        firstName: clientName ? firstNameFromClientName(clientName) : undefined,
        serviceName: next.service_names || "seu horário",
        when: formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr),
        barberName: next.barber_name,
        price: next.price,
      });
    }
    if (shopPixThisTurn) {
      const booked = upcomingAppointments[0];
      out = composeShopPixReply({
        pixKey: shopPixThisTurn.key,
        keyType: shopPixThisTurn.keyType,
        holderName: shopPixThisTurn.holderName,
        shopName: shopPixThisTurn.shopName,
        serviceName: booked?.service_names || bookingDraft.service_name,
        price: booked?.price ?? bookingDraft.total_price,
      });
    }
    const locationReplied = locationPinSentThisTurn && !shopPixThisTurn && !consultRecap && !composed && !state;
    if (locationReplied) out = composeLocationSent();
    let falsePresenceReplaced = false;
    if (state !== "appointment_confirmed" && replyClaimsPresenceConfirmed(out)) {
      const next = upcomingAppointments[0];
      out = next
        ? composeUpcomingRecap({
            firstName: clientName ? firstNameFromClientName(clientName) : undefined,
            serviceName: next.service_names || "seu horário",
            when: formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr),
            barberName: next.barber_name,
            price: next.price,
          })
        : "Não confirmei presença. Me diz o dia e o horário se quiser ajustar.";
      falsePresenceReplaced = true;
    }
    out = await ensureMappedCancel(out);
    out = applyOutputGuard(
      out,
      consultRecap ||
        falsePresenceReplaced ||
        locationReplied ||
        Boolean(shopPixThisTurn) ||
        state === "appointment_confirmed" ||
        state === "appointment_cancelled" ||
        state === "appointment_created" ||
        state === "appointment_rescheduled" ||
        composed,
    );
    if (out && state && TRANSACTION_CLOSED_STATES.has(state) && routing.nextPending.intents.length) {
      const offer = composePendingIntentOffer(routing.nextPending.intents);
      if (offer) {
        out = `${out}[[MSG]]${offer}`;
        routingApplied.push("offer_pending");
        await savePendingIntents(conversationId, { intents: routing.nextPending.intents, offered: true });
      }
    }
    await persistAssistant(out);
    updateClientMemoryFromConversation(effectiveBarbershopId, clientPhone, {
      messages: lastN.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
      finalState: state,
    }).catch(() => {});
    return withDebug({ reply: out, usage: totalUsage, state });
  }

  async function handoffAfterBookingFailure(toolName: string) {
    if (!routingApplied.includes("claim_withheld")) routingApplied.push("claim_withheld");
    turnTrace.silencedBy = turnTrace.silencedBy ?? `claim_withheld:${toolName}`;
    return finishTurn(establishedFact, Boolean(establishedFact));
  }

  async function lockOneConcreteHour(reply: string, snap: CheckAvailabilitySnapshot): Promise<string> {
    if (parseClientTime(reply)) return reply;
    const nextDate =
      snap.nextOpenDate && /^\d{4}-\d{2}-\d{2}$/.test(snap.nextOpenDate) ? snap.nextOpenDate : snap.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return reply;
    const barberId = snap.barberId || bookingDraft.barber_id;
    const serviceIds = bookingDraft.service_ids?.length ? bookingDraft.service_ids : snap.serviceIds;
    if (!barberId || !serviceIds.length) return reply;
    try {
      const listed = await aiTools.getNextSlots(effectiveBarbershopId, {
        date: nextDate,
        service_ids: serviceIds,
        barber_id: barberId,
        limit: 1,
        ...(nextDate === snap.date && bookingDraft.after_time ? { after_time: bookingDraft.after_time } : {}),
      });
      const slots =
        listed && typeof listed === "object" && Array.isArray((listed as { slots?: unknown }).slots)
          ? (listed as { slots: Array<{ time?: string; barber_id?: string; barber_name?: string }> }).slots
          : [];
      const first = firstLockableSlot(slots);
      if (!first) return reply;
      bookingDraft = lockOfferedSlot(bookingDraft, {
        date: nextDate,
        time: first.time,
        barber_id: first.barber_id,
        barber_name: first.barber_name || snap.barberName || bookingDraft.barber_name,
        status: bookingName ? "offered" : "awaiting_name",
      });
      const when = formatResumoWhen(nextDate, first.time, dateOnlyStr);
      const who = (first.barber_name || snap.barberName || "").split(" ")[0];
      return `Nesse horário não cabe. Posso te encaixar ${when}${who ? ` com o ${who}` : ""}. Fica bom pra você?`;
    } catch {
      return reply;
    }
  }

  async function speakUnwrittenSlot(): Promise<string> {
    const date = String(bookingDraft.date ?? "").slice(0, 10);
    const time = String(bookingDraft.time ?? "").slice(0, 5);
    const barberId = bookingDraft.barber_id;
    const serviceIds = bookingDraft.service_ids ?? [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !barberId || !serviceIds.length) {
      return serviceIds.length ? "Qual hora você prefere?" : ASK_SERVICE;
    }
    bookingDraft = mergeBookingDraft(bookingDraft, {
      status: bookingName ? "offered" : "awaiting_name",
    });
    const card = () =>
      composeUnwrittenSlotCard({
        serviceName: bookingDraft.service_name || "Horário",
        barberName: bookingDraft.barber_name || "o barbeiro",
        dateIso: String(bookingDraft.date ?? date).slice(0, 10),
        timeHHmm: String(bookingDraft.time ?? time).slice(0, 5),
        totalPrice: bookingDraft.total_price ?? 0,
        firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
        todayIso: dateOnlyStr,
      });
    try {
      const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
        date,
        time,
        barber_id: barberId,
        ...(serviceIds.length === 1 ? { service_id: serviceIds[0] } : { service_ids: serviceIds }),
      });
      const snap = snapshotCheckAvailability(checked, barberId);
      await persistTool(
        "check_availability",
        { date, time, barber_id: barberId },
        JSON.stringify(checked).slice(0, 4096),
      );
      turnTrace.toolsExecuted.push({ name: "check_availability", ok: Boolean(snap) });
      if (snap && !snap.available) {
        const filled = {
          ...snap,
          barberName: snap.barberName || bookingDraft.barber_name || "",
          barberId: snap.barberId || barberId,
        };
        let reply = occupiedCopyFromSnap(filled, dateOnlyStr, true);
        const alternative = concreteAlternativeToLock({
          date: filled.date || date,
          reason: filled.unavailableReason,
          requestedTime: filled.time || time,
          requestedBarberId: barberId,
          requestedBarberName: bookingDraft.barber_name,
          holdRequestedBarber: true,
          allowOtherBarber: false,
          lastFit: filled.lastFit,
          alternatives: filled.alternatives,
          sameTimeOthers: filled.sameTimeOthers,
        });
        if (alternative?.barber_id) {
          bookingDraft = lockOfferedSlot(bookingDraft, {
            date: alternative.date,
            time: alternative.time,
            barber_id: alternative.barber_id,
            barber_name: alternative.barber_name || bookingDraft.barber_name,
            status: bookingName ? "offered" : "awaiting_name",
          });
        } else {
          reply = await lockOneConcreteHour(reply, filled);
        }
        await saveBookingDraft(conversationId, bookingDraft);
        return reply.trim() || card();
      }
    } catch {
      /* the card still speaks */
    }
    await saveBookingDraft(conversationId, bookingDraft);
    return card();
  }

  let toolErrorCount = 0;
  let currentBarbershopId = effectiveBarbershopId;
  let lastCheckThisTurn: CheckAvailabilitySnapshot | null = null;
  let shopPixThisTurn: {
    key: string;
    keyType: string | null;
    holderName: string | null;
    shopName: string | null;
  } | null = null;
  let locationPinSentThisTurn = false;
  let partialSlotListThisTurn = false;
  const movingAppointmentId =
    upcomingAppointments.length === 1 && isValidUuid(upcomingAppointments[0]?.id ?? "")
      ? upcomingAppointments[0].id
      : undefined;
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

  function barberForThisAvailabilityCheck(toolBarberId: unknown): string | undefined {
    const named =
      intentSet.barber?.kind === "named" && intentSet.barber.id && isValidUuid(intentSet.barber.id)
        ? intentSet.barber.id
        : undefined;
    const clientNamedBarber = intentSet.barber != null;
    return barberIdForAvailability({
      namedBarberId: named,
      anyBarber: acceptsAnyBarber(lastUserTextRaw) || intentSet.barber?.kind === "any",
      draftBarberId: bookingDraft.barber_id,
      upcomingBarberId:
        !clientNamedBarber && upcomingAppointments.length === 1 ? upcomingAppointments[0]?.barber_id : undefined,
      toolBarberId: typeof toolBarberId === "string" ? toolBarberId : undefined,
      catalogIds: catalogBarbers.map((b) => b.id),
    });
  }

  function pinDraftBarber(barberId: string | undefined) {
    if (!barberId || bookingDraft.barber_id === barberId) return;
    const name =
      catalogBarbers.find((b) => b.id === barberId)?.name ??
      upcomingAppointments.find((a) => a.barber_id === barberId)?.barber_name;
    bookingDraft = {
      ...bookingDraft,
      barber_id: barberId,
      ...(name ? { barber_name: name } : {}),
    };
  }

  if (isGreetingOnly && upcomingAppointments.length > 0) {
    const next = [...upcomingAppointments].sort((a, b) =>
      `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
    )[0]!;
    const reply = composeHumanConsult({
      firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
      serviceName: next.service_names || "seu horário",
      weekdayShort: weekdayShortPtFromIso(String(next.date).slice(0, 10)),
      barberName: next.barber_name,
      timeHHmm: String(next.time).slice(0, 5),
    });
    return finishTurn(reply, true);
  }

  if (routing.primaryIntent === "plan" && !hasActiveSubscription && !bookingName) {
    return finishTurn(establishedFact || "Para assinar, qual seu nome?", true);
  }

  const carriedService = bookingDraft.service_name || upcomingAppointments[0]?.service_names || "";
  if (
    carriedService &&
    routing.handleNow.includes("reschedule") &&
    (intentSet.service == null || intentSet.service === "ambiguous")
  ) {
    systemPrompt +=
      `\n\nO serviço deste horário continua ${carriedService}. ` +
      "Não troque por um serviço avulso e não pergunte se é o combo ou só uma parte.";
  }

  const namingNewSlot = Boolean(
    parseClientTime(lastUserTextRaw) || bookingDateFromUserTurn(lastUserTextRaw, dateOnlyStr),
  );
  const namedThisTurn = resolveBarberFromText(lastUserTextRaw, catalogBarbers);
  if (
    namedThisTurn &&
    shouldComposeNamedBarberCard({
      messageNamesCatalogBarber: true,
      draftHasService: Boolean(bookingDraft.service_ids?.length),
      draftHasClock: Boolean(bookingDraft.date && bookingDraft.time),
      messageHasClock: Boolean(parseClientTime(lastUserTextRaw)),
    })
  ) {
    const date = String(bookingDraft.date).slice(0, 10);
    const earlierUsers = lastN.filter((m) => m.role === "user").map((m) => String(m.content ?? ""));
    const previousAsk = earlierUsers.length >= 2 ? earlierUsers[earlierUsers.length - 2] : "";
    const time = clockForNamedBarber(previousAsk, String(bookingDraft.time ?? ""));
    const serviceIds = bookingDraft.service_ids ?? [];
    const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
      date,
      time,
      barber_id: namedThisTurn.id,
      ...(serviceIds.length === 1 ? { service_id: serviceIds[0] } : { service_ids: serviceIds }),
    });
    const snap = snapshotCheckAvailability(checked, namedThisTurn.id);
    await persistTool(
      "check_availability",
      { date, time, barber_id: namedThisTurn.id },
      JSON.stringify(checked).slice(0, 4096),
    );
    turnTrace.toolsExecuted.push({ name: "check_availability", ok: Boolean(snap) });
    if (snap?.available) {
      bookingDraft = lockOfferedSlot(bookingDraft, {
        date,
        time,
        barber_id: namedThisTurn.id,
        barber_name: namedThisTurn.name,
        status: bookingName ? "offered" : "awaiting_name",
      });
      await saveBookingDraft(conversationId, bookingDraft);
      return finishTurn(
        composeAvailableSlotConfirm({
          serviceName: snap.serviceName || bookingDraft.service_name || "Horário",
          barberName: namedThisTurn.name,
          dateIso: date,
          timeHHmm: time,
          totalPrice: snap.totalPrice || bookingDraft.total_price || 0,
          firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
          todayIso: dateOnlyStr,
        }),
        true,
      );
    }
    if (snap) {
      const filled = { ...snap, barberId: namedThisTurn.id, barberName: namedThisTurn.name };
      let reply = occupiedCopyFromSnap(filled, dateOnlyStr, true);
      const alternative = concreteAlternativeToLock({
        date: filled.date || date,
        reason: filled.unavailableReason,
        requestedTime: filled.time || time,
        requestedBarberId: namedThisTurn.id,
        requestedBarberName: namedThisTurn.name,
        holdRequestedBarber: true,
        allowOtherBarber: false,
        lastFit: filled.lastFit,
        alternatives: filled.alternatives,
        sameTimeOthers: filled.sameTimeOthers,
      });
      if (alternative?.barber_id) {
        bookingDraft = lockOfferedSlot(bookingDraft, {
          date: alternative.date,
          time: alternative.time,
          barber_id: alternative.barber_id,
          barber_name: alternative.barber_name || namedThisTurn.name,
          status: bookingName ? "offered" : "awaiting_name",
        });
      } else {
        reply = await lockOneConcreteHour(reply, filled);
      }
      await saveBookingDraft(conversationId, bookingDraft);
      const spoken = reply.trim();
      return finishTurn(spoken || `Esse horário com o ${namedThisTurn.name.split(" ")[0]} não está livre.`, true);
    }
    return finishTurn(`Não consegui ver a agenda do ${namedThisTurn.name.split(" ")[0]} agora.`, true);
  }
  if (
    looksLikeRescheduleIntent(lastUserTextRaw) &&
    !isAffirmativeOnly &&
    !namingNewSlot &&
    bookingDraft.date &&
    bookingDraft.time &&
    bookingDraft.barber_id &&
    (bookingDraft.service_ids?.length ?? 0) > 0
  ) {
    bookingDraft = lockOfferedSlot(bookingDraft, {
      date: String(bookingDraft.date).slice(0, 10),
      time: String(bookingDraft.time).slice(0, 5),
      barber_id: bookingDraft.barber_id,
      barber_name: bookingDraft.barber_name,
      status: bookingName ? "offered" : "awaiting_name",
    });
    await saveBookingDraft(conversationId, bookingDraft);
    return finishTurn(
      composeAvailableSlotConfirm({
        serviceName: bookingDraft.service_name || "Horário",
        barberName: bookingDraft.barber_name || "o barbeiro",
        dateIso: String(bookingDraft.date).slice(0, 10),
        timeHHmm: String(bookingDraft.time).slice(0, 5),
        totalPrice: bookingDraft.total_price ?? 0,
        firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
        todayIso: dateOnlyStr,
      }),
      true,
    );
  }

  if (
    isLikelyNameOnly &&
    !draftIsCloseable(bookingDraft) &&
    bookingDraft.status !== "awaiting_name" &&
    upcomingAppointments.length > 0 &&
    routing.primaryIntent === "unknown"
  ) {
    const next = upcomingAppointments[0]!;
    return finishTurn(
      composeUpcomingRecap({
        firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
        serviceName: next.service_names || "seu horário",
        when: formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr),
        barberName: next.barber_name,
        price: next.price,
      }),
      true,
    );
  }

  if (isAffirmativeOnly && !parseClientTime(lastUserTextRaw) && bookingDraft.date && !bookingDraft.time) {
    return finishTurn("Qual hora você prefere?", true);
  }

  if (looksLikeCancelIntent(lastUserTextRaw) && !looksLikeRescheduleIntent(lastUserTextRaw)) {
    return finishTurn("", true);
  }

  const acceptingOpenDraft =
    draftIsCloseable(bookingDraft) &&
    Boolean(bookingName) &&
    (isAffirmativeOnly || Boolean(nameFromUserForBooking));
  if (
    acceptingOpenDraft &&
    bookingDraft.appointment_id &&
    routing.allowedTools.includes("reschedule_appointment")
  ) {
    const payload = {
      date: bookingDraft.date as string,
      time: bookingDraft.time as string,
      barber_id: bookingDraft.barber_id as string,
    };
    const written = await aiTools.rescheduleAppointmentByAgent(
      effectiveBarbershopId,
      bookingDraft.appointment_id,
      clientPhone,
      payload,
      conversationId,
    );
    const ok = written != null && typeof written === "object" && (written as { ok?: boolean }).ok === true;
    await persistTool("reschedule_appointment", payload, JSON.stringify(written).slice(0, 4096));
    turnTrace.toolsExecuted.push({ name: "reschedule_appointment", ok });
    if (ok) {
      state = "appointment_rescheduled";
      bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed" });
      await saveBookingDraft(conversationId, bookingDraft);
      return finishTurn("", true);
    }
    return finishTurn(await speakUnwrittenSlot(), true);
  } else if (
    acceptingOpenDraft &&
    !bookingDraft.appointment_id &&
    routing.allowedTools.includes("create_appointment") &&
    upcomingAppointments.length === 0
  ) {
    const payload: Parameters<typeof aiTools.createAppointment>[1] = {
      client_phone: clientPhone,
      client_name: bookingName,
      barber_id: bookingDraft.barber_id as string,
      ...(bookingDraft.service_ids?.length === 1
        ? { service_id: bookingDraft.service_ids[0] }
        : { service_ids: bookingDraft.service_ids }),
      date: bookingDraft.date as string,
      time: bookingDraft.time as string,
    };
    const created = await aiTools.createAppointment(effectiveBarbershopId, payload, conversationId);
    const createdId =
      created && typeof created === "object" ? String((created as { id?: string }).id ?? "") : "";
    await persistTool("create_appointment", payload, JSON.stringify(created).slice(0, 4096));
    turnTrace.toolsExecuted.push({ name: "create_appointment", ok: Boolean(createdId) });
    if (createdId) {
      state = "appointment_created";
      bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed", appointment_id: createdId });
      await saveBookingDraft(conversationId, bookingDraft);
      return finishTurn("", true);
    }
    return finishTurn(await speakUnwrittenSlot(), true);
  }

  if (
    isAffirmativeOnly &&
    !parseClientTime(lastUserTextRaw) &&
    !draftIsCloseable(bookingDraft) &&
    upcomingAppointments.length > 0 &&
    // Um "sim" que aceita a oferta pendente (ex.: plano, logo após agendar) não é "tudo certo com o horário".
    !resumingPending &&
    !looksLikeCancelIntent(lastUserTextRaw) &&
    !looksLikeRescheduleIntent(lastUserTextRaw)
  ) {
    const next = upcomingAppointments[0]!;
    return finishTurn(
      composeUpcomingRecap({
        firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
        serviceName: next.service_names || "seu horário",
        when: formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr),
        barberName: next.barber_name,
        price: next.price,
      }),
      true,
    );
  }

  if (
    looksLikePixIntent(lastUserTextRaw) &&
    !looksLikePlanIntent(lastUserTextRaw) &&
    !parseClientTime(lastUserTextRaw) &&
    routing.primaryIntent !== "schedule" &&
    routing.primaryIntent !== "reschedule"
  ) {
    const pix = await aiTools.sendShopPix(effectiveBarbershopId, clientPhone);
    const row =
      pix && typeof pix === "object"
        ? (pix as {
            ok?: boolean;
            pix_key?: string;
            pix_key_type?: string | null;
            pix_holder_name?: string | null;
            shop_name?: string | null;
          })
        : null;
    await persistTool("send_shop_pix", {}, JSON.stringify({ ok: Boolean(row?.ok && row?.pix_key) }).slice(0, 200));
    turnTrace.toolsExecuted.push({ name: "send_shop_pix", ok: Boolean(row?.ok && row?.pix_key) });
    if (row?.ok && row.pix_key) {
      shopPixThisTurn = {
        key: row.pix_key,
        keyType: row.pix_key_type ?? null,
        holderName: row.pix_holder_name ?? null,
        shopName: row.shop_name ?? null,
      };
      return finishTurn("", true);
    }
    return finishTurn("A chave PIX a equipe te passa por aqui.", true);
  }

  if (routing.turnDirective === ASK_BOOKING_NAME && !routing.allowedTools.includes("create_appointment")) {
    bookingDraft = mergeBookingDraft(bookingDraft, { status: "awaiting_name" });
    await saveBookingDraft(conversationId, bookingDraft);
    return finishTurn(ASK_BOOKING_NAME, true);
  }

  if (routing.turnDirective === PLAN_CHARGE_ACK) {
    return finishTurn(PLAN_CHARGE_ACK, true);
  }

  if (
    routing.turnDirective === ASK_SERVICE ||
    routing.turnDirective === ASK_HOUR ||
    routing.turnDirective === ASK_CORTE_OR_COMBO ||
    routing.turnDirective === CLOCK_OUTSIDE_HOURS
  ) {
    const suggestion = routing.turnDirective === ASK_SERVICE ? routing.usualServiceSuggestion : null;
    if (routing.turnDirective === ASK_SERVICE && alignedSpoken) {
      bookingDraft = mergeBookingDraft(bookingDraft, {
        time: alignedSpoken,
        date: desired.desiredDate || bookingDraft.date || dateOnlyStr,
        status: "collecting",
        lastAgentQuestion: "service",
      });
      await saveBookingDraft(conversationId, bookingDraft);
    }
    if (suggestion) {
      // Cliente que volta: sugere o de sempre e espera o "sim". O serviço só entra no rascunho no aceite.
      bookingDraft = mergeBookingDraft(bookingDraft, {
        pendingProposal: { service_ids: suggestion.service_ids, service_name: suggestion.service_name },
        lastAgentQuestion: "usual_service",
        usualSuggested: true,
      });
      await saveBookingDraft(conversationId, bookingDraft);
      return finishTurn(composeSuggestUsualService({ usualName: suggestion.service_name }), true);
    }
    if (routing.turnDirective === ASK_SERVICE && usualServiceRefused) {
      await saveBookingDraft(conversationId, bookingDraft);
      return finishTurn(`Sem problema! ${ASK_SERVICE}`, true);
    }
    return finishTurn(routing.turnDirective, true);
  }

  if (
    !alignedSpoken &&
    !bookingDraft.time &&
    bookingDraft.date &&
    (bookingDraft.service_ids?.length ?? 0) > 0 &&
    upcomingAppointments.length === 0 &&
    !looksLikeCancelIntent(lastUserTextRaw) &&
    !looksLikeRescheduleIntent(lastUserTextRaw) &&
    !looksLikeConsultIntent(lastUserTextRaw) &&
    !looksLikePixIntent(lastUserTextRaw) &&
    !looksLikeLocationIntent(lastUserTextRaw) &&
    !looksLikePlanIntent(lastUserTextRaw)
  ) {
    return finishTurn(ASK_HOUR, true);
  }

  if (
    alignedSpoken &&
    bookingDraft.status !== "offered" &&
    bookingDraft.status !== "awaiting_name" &&
    (bookingDraft.service_ids?.length ?? 0) > 0 &&
    bookingDraft.barber_id &&
    bookingDraft.date &&
    upcomingAppointments.length === 0 &&
    !looksLikeCancelIntent(lastUserTextRaw) &&
    !looksLikeRescheduleIntent(lastUserTextRaw)
  ) {
    const date = String(bookingDraft.date).slice(0, 10);
    const time = alignedSpoken.slice(0, 5);
    const serviceIds = bookingDraft.service_ids ?? [];
    const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
      date,
      time,
      barber_id: bookingDraft.barber_id,
      ...(serviceIds.length === 1 ? { service_id: serviceIds[0] } : { service_ids: serviceIds }),
    });
    const snap = snapshotCheckAvailability(checked, bookingDraft.barber_id);
    await persistTool(
      "check_availability",
      { date, time, barber_id: bookingDraft.barber_id },
      JSON.stringify(checked).slice(0, 4096),
    );
    turnTrace.toolsExecuted.push({ name: "check_availability", ok: Boolean(snap) });
    const offerHour = snap?.available
      ? { date: snap.date, time: snap.time.slice(0, 5), barberId: snap.barberId || bookingDraft.barber_id, barberName: snap.barberName, serviceName: snap.serviceName, price: snap.totalPrice }
      : snap?.lastFit?.time && snap.lastFit.barber_id
        ? {
            date: snap.date,
            time: snap.lastFit.time.slice(0, 5),
            barberId: snap.lastFit.barber_id,
            barberName: snap.lastFit.barber_name || bookingDraft.barber_name,
            serviceName: snap.serviceName || bookingDraft.service_name,
            price: snap.totalPrice,
          }
        : null;
    if (offerHour?.barberId && offerHour.serviceName) {
      bookingDraft = lockOfferedSlot(bookingDraft, {
        date: offerHour.date,
        time: offerHour.time,
        barber_id: offerHour.barberId,
        barber_name: offerHour.barberName,
        status: bookingName ? "offered" : "awaiting_name",
      });
      await saveBookingDraft(conversationId, bookingDraft);
      const card = composeAvailableSlotConfirm({
        serviceName: offerHour.serviceName,
        barberName: offerHour.barberName || "o barbeiro",
        dateIso: offerHour.date,
        timeHHmm: offerHour.time,
        totalPrice: offerHour.price ?? 0,
        firstName: bookingName ? firstNameFromClientName(bookingName) : undefined,
        todayIso: dateOnlyStr,
      });
      const prefix =
        offerHour.time !== time ? `Às ${formatTimePt(time)} não cabe nesse dia.[[MSG]]` : "";
      return finishTurn(`${prefix}${card}`, true);
    }
    return finishTurn(ASK_HOUR, true);
  }

  for (let round = 0; round < maxToolRounds; round++) {
    const maxTokens = settings?.max_output_tokens ?? 350;
    const openAiStarted = Date.now();
    const completion = await openai.chat.completions.create({
      model,
      temperature: effectiveTemperature,
      max_tokens: maxTokens,
      messages: loopMessages,
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
    });
    const choice = completion.choices[0];
    const toolsRequested = (choice?.message.tool_calls ?? []).map((tc) => {
      const fn = "function" in tc ? (tc as { function?: { name?: string } }).function : undefined;
      return fn?.name ?? "unknown";
    });
    turnTrace.openai.push({
      round,
      model,
      latencyMs: Date.now() - openAiStarted,
      finishReason: choice?.finish_reason ?? null,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      toolsRequested,
    });
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
        if (name !== "select_branch" && !routing.allowedTools.includes(name)) {
          const refused = {
            error: "fora_do_plano",
            message: establishedFact || "Esta ação não faz parte deste turno.",
          };
          if (!routingApplied.includes("tool_not_in_plan")) routingApplied.push("tool_not_in_plan");
          turnTrace.toolsExecuted.push({ name, ok: false });
          const refusedContent = JSON.stringify(refused);
          await persistTool(name, args, refusedContent);
          loopMessages.push({ role: "tool", tool_call_id: tc.id, content: refusedContent });
          continue;
        }
        if (currentBarbershopId === effectiveBarbershopId) {
          const catalogCheck = validateToolCatalogArgs(name, args, {
            serviceIds: catalogServices.map((s) => s.id),
            barberIds: catalogBarbers.map((b) => b.id),
          });
          if (catalogCheck.rejected.length) {
            for (const key of Object.keys(args)) delete args[key];
            Object.assign(args, catalogCheck.args);
            for (const field of catalogCheck.rejected) turnTrace.catalogRejections.push({ tool: name, field });
            roundNotes.push({
              role: "system" as const,
              content:
                `IDs fora do catálogo foram ignorados em ${name} (${catalogCheck.rejected.join(", ")}). ` +
                "Use somente ids devolvidos por list_services/list_barbers. Não ofereça serviço ou barbeiro que a barbearia não tem.",
            } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
          }
        }
        let bookingWriteFailed = false;
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
            const argServiceIds = idsKnownToCatalog(args.service_ids, catalog);
            const argServiceId = idKnownToCatalog(args.service_id, catalog);
            const resolvedServices = resolveCheckServiceIds({
              namedMatchId: named.match?.id,
              namedAmbiguous: Boolean(named.ambiguous),
              draftServiceIds: bookingDraft.service_ids,
              upcomingServiceIds: upcomingAppointments[0]?.service_ids,
              argServiceIds: argServiceId ? [argServiceId, ...argServiceIds] : argServiceIds,
            });
            if ("ask" in resolvedServices) {
              return {
                error:
                  resolvedServices.ask === "ambiguous"
                    ? "Serviço ainda ambíguo. Pergunte se é o simples ou o combo. Não chame check_availability."
                    : "Serviço ainda não está no rascunho. Pergunte corte, barba ou combo. Não chame check_availability.",
              };
            }
            const serviceIds = resolvedServices.serviceIds;
            const serviceId = serviceIds?.length === 1 ? serviceIds[0] : argServiceId;
            const barberId = barberForThisAvailabilityCheck(args.barber_id);
            pinDraftBarber(barberId);
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
              exclude_appointment_id: movingAppointmentId,
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
            const argServiceIds = idsKnownToCatalog(args.service_ids, catalog);
            const argServiceId = idKnownToCatalog(args.service_id, catalog);
            const resolvedServices = resolveCheckServiceIds({
              namedMatchId: named.match?.id,
              namedAmbiguous: Boolean(named.ambiguous),
              draftServiceIds: bookingDraft.service_ids,
              upcomingServiceIds: upcomingAppointments[0]?.service_ids?.length
                ? upcomingAppointments[0].service_ids
                : lastVisit?.service_ids,
              argServiceIds: argServiceId ? [argServiceId, ...argServiceIds] : argServiceIds,
            });
            if ("ask" in resolvedServices) {
              return {
                error:
                  resolvedServices.ask === "ambiguous"
                    ? "Serviço ainda ambíguo. Pergunte se é o simples ou o combo. Não chame get_next_slots."
                    : "Serviço ainda não está no rascunho. Pergunte o serviço. Não chame get_next_slots.",
              };
            }
            const serviceIds = resolvedServices.serviceIds;
            const serviceId = serviceIds?.length === 1 ? serviceIds[0] : argServiceId;
            const nextSlotsBarberId =
              barberForThisAvailabilityCheck(args.barber_id) ??
              (upcomingAppointments.length === 0 ? lastVisit?.barber_id : undefined);
            pinDraftBarber(nextSlotsBarberId);
            const listed = await aiTools.getNextSlots(currentBarbershopId, {
              date,
              service_id: serviceId,
              service_ids: serviceIds,
              after_time: bookingDraft.after_time
                ? bookingDraft.after_time
                : isToday
                  ? ((args.after_time as string) || currentTimeHHmm)
                  : undefined,
              barber_id: nextSlotsBarberId,
              limit: typeof args.limit === "number" ? args.limit : undefined,
              exclude_appointment_id: movingAppointmentId,
            });
            if (listed && typeof listed === "object" && (listed as { more_later?: boolean }).more_later) {
              partialSlotListThisTurn = true;
              roundNotes.push({
                role: "system" as const,
                content:
                  "LISTA PARCIAL: estes são os primeiros horários do dia, não o dia inteiro. Não diga que o restante do expediente está lotado.",
              });
            }
            return listed;
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
              client_phone: resolveToolClientPhone(args.client_phone, clientPhone),
              client_name: createName,
              barber_id: bookingDraft.barber_id as string,
              ...(bookingDraft.service_ids?.length === 1
                ? { service_id: bookingDraft.service_ids[0] }
                : { service_ids: bookingDraft.service_ids }),
              date: bookingDraft.date as string,
              time: bookingDraft.time as string,
              notes: args.notes as string | undefined,
            };
            const r = await aiTools.createAppointment(currentBarbershopId, payload, conversationId);
            const failureCode = r && typeof r === "object" ? String((r as { code?: unknown }).code ?? "") : "";
            if (failureCode === "SLOT_CONFLICT" || failureCode === "PAST_TIME") {
              bookingWriteFailed = true;
            }
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
            if (routing.primaryIntent === "reschedule") {
              if (!routingApplied.includes("block_cancel_on_reschedule")) {
                routingApplied.push("block_cancel_on_reschedule");
              }
              return {
                error:
                  "O cliente pediu para remarcar, não para cancelar. Não cancele: ofereça o novo dia/horário e use reschedule_appointment depois do sim.",
              };
            }
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
            const cancelCode = r && typeof r === "object" ? String((r as { code?: unknown }).code ?? "") : "";
            if (cancelCode === "SLOT_CONFLICT" || cancelCode === "PAST_TIME") {
              bookingWriteFailed = true;
            }
            if (r && typeof r === "object" && (r as { ok?: boolean }).ok === true) {
              state = "appointment_cancelled";
              bookingDraft = draftKeptAfterCancel(bookingDraft, upcomingAppointments[0]);
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
            if (movingAppointmentId && !bookingDraft.appointment_id) {
              bookingDraft = mergeBookingDraft(bookingDraft, { appointment_id: movingAppointmentId });
            }
            const confirmingOffer =
              isAffirmativeOnly &&
              (assistantAskedConfirmation || assistantOfferedSingleHour(previousAssistant));
            if (!confirmingOffer) {
              return {
                deferred: true,
                reason: "awaiting_client_confirmation",
                instruction:
                  "Não altere o horário neste turno. Envie um resumo do novo dia/hora e pergunte 'Posso confirmar?'. Só chame reschedule_appointment depois do sim. Não diga que houve falha.",
              };
            }
            const offerMatches = rescheduleDraftMatchesOffer(bookingDraft.time, previousAssistant);
            if (!offerMatches || !draftIsCloseable(bookingDraft) || !bookingDraft.appointment_id) {
              if (confirmingOffer && offerMatches && draftIsCloseable(bookingDraft) && !bookingDraft.appointment_id) {
                bookingWriteFailed = true;
                return { error: "reschedule_unbound", code: "ACTION_FAILED" };
              }
              return {
                deferred: true,
                reason: "awaiting_offered_draft",
                instruction: offerMatches
                  ? "Só reagende a partir do rascunho já oferecido (check_availability + Posso confirmar?). Não invente data/hora e não diga que houve falha."
                  : "O rascunho não é o horário que o cliente acabou de aceitar. Chame check_availability desse horário. Não diga que está ocupado e não diga que houve falha.",
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
            const rescheduleOk = r != null && typeof r === "object" && (r as { ok?: boolean }).ok === true;
            if (!rescheduleOk) {
              bookingWriteFailed = true;
            }
            if (rescheduleOk) {
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
            const confirmCode = r && typeof r === "object" ? String((r as { code?: unknown }).code ?? "") : "";
            if (confirmCode === "SLOT_CONFLICT" || confirmCode === "PAST_TIME") {
              bookingWriteFailed = true;
            }
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
            const sent = await sendBarbershopLocationToClient(
              currentBarbershopId,
              resolveToolClientPhone(args.client_phone, clientPhone) || "",
            );
            if ("ok" in sent && sent.ok) locationPinSentThisTurn = true;
            return sent;
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
              client_name: bookingName || undefined,
            });
            if (subResult && typeof subResult === "object" && !("error" in subResult)) {
              state = "plan_subscribed";
              const created = subResult as { subscription_id?: string; plan_name?: string };
              const planName = created.plan_name?.trim() || "plano";
              let firstCharge: unknown = null;
              if (created.subscription_id) {
                firstCharge = await aiTools.sendPixPlanCharge(currentBarbershopId, {
                  subscription_id: created.subscription_id,
                  client_phone: clientPhone,
                });
                const chargeOk =
                  firstCharge != null &&
                  typeof firstCharge === "object" &&
                  !("error" in (firstCharge as object));
                turnTrace.toolsExecuted.push({ name: "send_pix_plan_charge", ok: chargeOk });
              }
              await recordOperationalActivity({
                barbershopId: currentBarbershopId,
                type: "plan_requested",
                summary: `Pediu o plano ${planName}`,
                conversationId,
                clientPhone,
                clientName: bookingName || null,
              });
              return { ...(subResult as object), first_charge: firstCharge };
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
            if (pix && typeof pix === "object" && (pix as { ok?: boolean }).ok && (pix as { pix_key?: string }).pix_key) {
              const row = pix as {
                pix_key: string;
                pix_key_type?: string | null;
                pix_holder_name?: string | null;
                shop_name?: string | null;
              };
              shopPixThisTurn = {
                key: row.pix_key,
                keyType: row.pix_key_type ?? null,
                holderName: row.pix_holder_name ?? null,
                shopName: row.shop_name ?? null,
              };
              return {
                ok: true,
                prepared: true,
                instruction: "A mensagem com valor e chave será enviada pelo sistema. Não repita a chave.",
              };
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
        const toolFailed =
          result != null &&
          typeof result === "object" &&
          "error" in result &&
          Boolean((result as { error?: unknown }).error);
        if (toolFailed) {
          toolErrorCount++;
        }
        turnTrace.toolsExecuted.push({ name, ok: !toolFailed });
        const content = JSON.stringify(result).slice(0, 4096);
        await persistTool(name, args, content);
        loopMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content,
        });
        if (bookingWriteFailed) {
          return finishTurn(await speakUnwrittenSlot(), true);
        }
        if (state === "appointment_created" || state === "appointment_rescheduled") {
          return finishTurn("", true);
        }
        const deferredReason =
          result != null && typeof result === "object" && (result as { deferred?: boolean }).deferred === true
            ? String((result as { reason?: unknown }).reason ?? "")
            : "";
        if (deferredReason === "awaiting_client_name") {
          if (!routingApplied.includes("ask_name")) routingApplied.push("ask_name");
          return finishTurn(askClientNameReply(), true);
        }
        // Waitlist success → fixed action text (Orchestrator contract: tool fact, not LLM improvisation).
        if (name === "add_to_waitlist" && !toolFailed) {
          if (!routingApplied.includes("waitlist_recorded")) routingApplied.push("waitlist_recorded");
          roundNotes.push({
            role: "system" as const,
            content:
              "AÇÃO CONCLUÍDA: cliente entrou na fila. " +
              "Responda com uma confirmação curta e factual (ex.: 'Anotei! Se esse horário abrir eu te aviso.'). " +
              "Não diga que houve falha. Não repita os dados do horário. Não prometa prazo.",
          } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
        }

        if (name === "check_availability") {
          const snap = snapshotCheckAvailability(result, bookingDraft.barber_id);
          if (snap) lastCheckThisTurn = snap;
          if (snap) {
            const alreadyConfirmed = isAffirmativeOnly && assistantAskedConfirmation;
            bookingDraft = mergeBookingDraft(bookingDraft, {
              ...draftPatchFromSnap(snap),
              ...(movingAppointmentId ? { appointment_id: movingAppointmentId } : {}),
              status: snap.available
                ? alreadyConfirmed
                  ? "offered"
                  : bookingDraft.status
                : "collecting",
            });
            await saveBookingDraft(conversationId, bookingDraft);
            roundNotes.push({
              role: "system" as const,
              content: snap.available
                ? alreadyConfirmed
                  ? movingAppointmentId
                    ? `SLOT LIVRE em ${snap.date} às ${snap.time} com ${snap.barberName || "o barbeiro pedido"} (${snap.serviceName || "serviço"}, R$ ${snap.totalPrice}). ` +
                      `O cliente já confirmou. Chame reschedule_appointment agora. Não use create_appointment e não diga que houve falha.`
                    : `SLOT LIVRE em ${snap.date} às ${snap.time} com ${snap.barberName || "o barbeiro pedido"} (${snap.serviceName || "serviço"}, R$ ${snap.totalPrice}). ` +
                      `O cliente já confirmou. Chame create_appointment agora. Não pergunte "Posso confirmar?" de novo.`
                  : `SLOT LIVRE em ${snap.date} às ${snap.time} com ${snap.barberName || "o barbeiro pedido"} (${snap.serviceName || "serviço"}, R$ ${snap.totalPrice}). ` +
                    `Responda só com um resumo (serviço, barbeiro, dia da semana, data, hora, valor) e pergunte "Posso confirmar?". ` +
                    `PROIBIDO neste turno: create_appointment, falar de outro dia fechado, "não conseguimos", "deu erro".`
                : `Horário indisponível (${snap.whyUnavailable || "ocupado"}). Fale só de indisponibilidade e ofereça outro dia/horário. ` +
                  `PROIBIDO: "não conseguimos agendar", "deu erro", "não foi possível".`,
            } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
          }
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
    const understood = understoodBookableSlot(intentSet);
    const soleUpcoming = upcomingAppointments.length === 1 ? upcomingAppointments[0] : undefined;
    const moveServiceIds = soleUpcoming?.service_ids?.length
      ? soleUpcoming.service_ids
      : bookingDraft.service_ids ?? [];
    const moveDate = soleUpcoming
      ? (bookingDateFromUserTurn(lastUserTextRaw, dateOnlyStr)?.date ?? String(soleUpcoming.date).slice(0, 10))
      : "";
    const moveWindow = moveDate
      ? shopWindowOnIso(moveDate, businessHoursRaw as Parameters<typeof shopWindowOnIso>[1])
      : { start: null as string | null, end: null as string | null };
    const moveSlot = soleUpcoming
      ? pendingMoveSlot({
          userText: lastUserTextRaw,
          upcomingDate: String(soleUpcoming.date),
          upcomingTime: String(soleUpcoming.time),
          date: moveDate,
          opensAt: moveWindow.start,
          closesAt: moveWindow.end,
        })
      : null;
    const acceptedClock =
      soleUpcoming && !moveSlot && !draftIsCloseable(bookingDraft)
        ? affirmedUnverifiedClock({
            userText: lastUserTextRaw,
            previousAssistant,
            affirmative: isAffirmativeOnly,
            askedConfirmation: assistantAskedConfirmation,
            opensAt: moveWindow.start,
            closesAt: moveWindow.end,
          })
        : null;
    const forcedSlot = understood
      ? {
          date: understood.date,
          time: understood.time,
          barberId: understood.barberId,
          serviceIds: understood.serviceIds,
        }
      : moveSlot && moveServiceIds.length
        ? {
            date: moveSlot.date,
            time: moveSlot.time,
            barberId: barberForThisAvailabilityCheck(undefined),
            serviceIds: moveServiceIds,
          }
        : acceptedClock && moveServiceIds.length
          ? {
              date: String(soleUpcoming?.date ?? "").slice(0, 10),
              time: acceptedClock,
              barberId: barberForThisAvailabilityCheck(undefined),
              serviceIds: moveServiceIds,
            }
          : null;
    if (
      routing.allowedTools.includes("check_availability") &&
      forcedSlot?.barberId &&
      forcedSlot.serviceIds.length &&
      !lastCheckThisTurn &&
      !turnTrace.toolsExecuted.some((tool) => tool.name === "check_availability")
    ) {
      const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
        date: forcedSlot.date,
        time: forcedSlot.time,
        barber_id: forcedSlot.barberId,
        service_ids: forcedSlot.serviceIds,
        exclude_appointment_id: movingAppointmentId,
      });
      const snap = snapshotCheckAvailability(checked, forcedSlot.barberId);
      if (snap) {
        lastCheckThisTurn = snap;
        turnTrace.toolsExecuted.push({ name: "check_availability", ok: true });
        if (!routingApplied.includes("check_before_draft")) routingApplied.push("check_before_draft");
        await persistTool(
          "check_availability",
          {
            date: forcedSlot.date,
            time: forcedSlot.time,
            barber_id: forcedSlot.barberId,
            service_ids: forcedSlot.serviceIds,
          },
          JSON.stringify(checked).slice(0, 4096),
        );
      }
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
        const recentUserTurnsForDisclosure = lastN
          .filter((m) => m.role === "user")
          .slice(-4, -1) // up to 3 previous user messages, excluding the current
          .map((m) => String(m.content ?? ""));
        reply = withBarberSubstitutionDisclosure(reply, lastUserTextRaw, catalogBarbers, lastCheckThisTurn.barberName, recentUserTurnsForDisclosure);
        composed = true;
      }
      bookingDraft = mergeBookingDraft(bookingDraft, {
        ...draftPatchFromSnap(lastCheckThisTurn),
        ...(movingAppointmentId ? { appointment_id: movingAppointmentId } : {}),
        status: clientName ? "offered" : "awaiting_name",
      });
      await saveBookingDraft(conversationId, bookingDraft);
      const acceptedThisCheck =
        Boolean(acceptedClock) &&
        alreadyConfirmed &&
        lastCheckThisTurn.time.slice(0, 5) === acceptedClock &&
        Boolean(movingAppointmentId) &&
        draftIsCloseable(bookingDraft);
      if (
        acceptedThisCheck &&
        movingAppointmentId &&
        lastCheckThisTurn.barberId &&
        routing.allowedTools.includes("reschedule_appointment")
      ) {
        const written = await aiTools.rescheduleAppointmentByAgent(
          effectiveBarbershopId,
          movingAppointmentId,
          clientPhone,
          {
            date: lastCheckThisTurn.date,
            time: lastCheckThisTurn.time,
            barber_id: lastCheckThisTurn.barberId,
          },
          conversationId,
        );
        const ok = written != null && typeof written === "object" && (written as { ok?: boolean }).ok === true;
        await persistTool(
          "reschedule_appointment",
          {
            date: lastCheckThisTurn.date,
            time: lastCheckThisTurn.time,
            barber_id: lastCheckThisTurn.barberId,
          },
          JSON.stringify(written).slice(0, 4096),
        );
        turnTrace.toolsExecuted.push({ name: "reschedule_appointment", ok });
        if (!ok) return finishTurn(await speakUnwrittenSlot(), true);
        state = "appointment_rescheduled";
        bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed" });
        await saveBookingDraft(conversationId, bookingDraft);
        reply = "";
        composed = true;
      }
    } else if (lastCheckThisTurn && !lastCheckThisTurn.available) {
      const namedNow = resolveBarberFromText(lastUserTextRaw, catalogBarbers);
      const boundBarberId = bookingDraft.barber_id || upcomingAppointments[0]?.barber_id;
      const heldBarber = Boolean(boundBarberId) && !(namedNow && namedNow.id !== boundBarberId);
      const unavailableSnap = {
        ...lastCheckThisTurn,
        barberName: lastCheckThisTurn.barberName || bookingDraft.barber_name || "",
        barberId: lastCheckThisTurn.barberId || bookingDraft.barber_id || "",
      };
      reply = occupiedCopyFromSnap(unavailableSnap, dateOnlyStr, heldBarber);
      composed = true;
      const alternative = concreteAlternativeToLock({
        date: unavailableSnap.date,
        reason: unavailableSnap.unavailableReason,
        requestedTime: unavailableSnap.time,
        requestedBarberId: unavailableSnap.barberId,
        requestedBarberName: unavailableSnap.barberName,
        holdRequestedBarber: heldBarber,
        allowOtherBarber: !heldBarber,
        lastFit: unavailableSnap.lastFit,
        alternatives: unavailableSnap.alternatives,
        sameTimeOthers: unavailableSnap.sameTimeOthers,
      });
      const spokenHour = assistantOfferedSingleHour(reply) ? parseClientTime(reply) : null;
      const lockBarberId = alternative?.barber_id || unavailableSnap.barberId || bookingDraft.barber_id;
      const lockTime = (spokenHour || alternative?.time || "").slice(0, 5);
      if (lockBarberId && /^\d{2}:\d{2}$/.test(lockTime) && (spokenHour || alternative?.barber_id)) {
        bookingDraft = lockOfferedSlot(
          mergeBookingDraft(bookingDraft, draftPatchFromSnap(lastCheckThisTurn)),
          {
            date: alternative?.date || unavailableSnap.date,
            time: lockTime,
            barber_id: lockBarberId,
            barber_name: alternative?.barber_name || unavailableSnap.barberName || bookingDraft.barber_name,
            appointment_id: movingAppointmentId,
            status: bookingName ? "offered" : "awaiting_name",
          },
        );
      } else if (!parseClientTime(reply)) {
        reply = await lockOneConcreteHour(reply, unavailableSnap);
        if (!parseClientTime(reply)) {
          bookingDraft = mergeBookingDraft(bookingDraft, {
            ...draftPatchFromSnap(lastCheckThisTurn),
            status: "collecting",
            waitlistOffer: reply.includes("te aviso"),
          });
        }
      } else {
        bookingDraft = mergeBookingDraft(bookingDraft, {
          ...draftPatchFromSnap(lastCheckThisTurn),
          status: "collecting",
          waitlistOffer: reply.includes("te aviso"),
        });
      }
      await saveBookingDraft(conversationId, bookingDraft);
    }
    if (
      !composed &&
      soleUpcoming &&
      !state &&
      replyClaimsOtherClock(reply, String(soleUpcoming.time).slice(0, 5))
    ) {
      reply = composeUpcomingRecap({
        firstName: clientName ? firstNameFromClientName(clientName) : undefined,
        serviceName: soleUpcoming.service_names || "seu horário",
        when: formatResumoWhen(String(soleUpcoming.date).slice(0, 10), String(soleUpcoming.time).slice(0, 5), dateOnlyStr),
        barberName: soleUpcoming.barber_name,
        price: soleUpcoming.price,
      });
      composed = true;
    }
    const checkedSlotsThisTurn =
      Boolean(lastCheckThisTurn) ||
      turnTrace.toolsExecuted.some(
        (tool) => (tool.name === "check_availability" || tool.name === "get_next_slots") && tool.ok,
      );
    const checkSaidUnavailable = Boolean(lastCheckThisTurn && !lastCheckThisTurn.available);
    if (!composed && !checkSaidUnavailable && replyNarratesBookingFailure(reply)) {
      return handoffAfterBookingFailure("narrated_booking_failure");
    }
    if (
      !composed &&
      partialSlotListThisTurn &&
      /n[aã]o temos hor[aá]rios|restante do (dia|expediente) est[aá]/i.test(reply)
    ) {
      return handoffAfterBookingFailure("partial_day_claim");
    }
    if (!composed && !checkedSlotsThisTurn && replyNegotiatesUnverifiedSlots(reply)) {
      return handoffAfterBookingFailure("unverified_slot_reply");
    }
    const checkFailed = turnTrace.toolsExecuted.some((tool) => tool.name === "check_availability" && !tool.ok);
    if (!composed && checkFailed && replyClaimsSlotIsFree(reply)) {
      return handoffAfterBookingFailure("check_failed_free_claim");
    }
    return finishTurn(reply, composed);
  }

  turnTrace.silencedBy = "tool_loop_exhausted";
  return finishTurn("", false);
}
