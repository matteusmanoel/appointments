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
import { addDaysIso, formatResumoWhen, formatTimePt, formatWeekCalendarForTools, parseClientTime, pickExecutedToolDate, pickExecutedToolTime, shopOpenStatusNow, weekdayShortPtFromIso } from "./date-calendar.js";
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
];

/** Returns true if the reply contains phrases that expose the automated nature of the system. */
export function containsAiExposure(reply: string): boolean {
  const t = (reply ?? "").trim();
  return AI_EXPOSURE_PATTERNS.some((re) => re.test(t));
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

function occupiedCopyFromSnap(snap: CheckAvailabilitySnapshot, todayIso?: string): string {
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
  });
}

export function isUsableClientName(name: string | undefined): boolean {
  const t = (name ?? "").trim();
  if (t.length < 2) return false;
  const folded = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (folded === "cliente") return false;
  // Reject barber-preference phrases that were mistakenly captured/stored as a
  // client name (e.g. a stale "Com Qualquer Barbeiro" row) — these are never
  // real names, whether they come from the current message or from the DB.
  if (/\bqualquer\b/.test(folded) || /\btanto faz\b/.test(folded)) return false;
  return true;
}

function askClientNameReply(): string {
  return "Para fechar o agendamento: qual é o seu nome?";
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

export const DEFAULT_SYSTEM_PROMPT = `Timezone: {{TIMEZONE}} (America/Sao_Paulo, UTC-03:00)
Agora: {{DATE_NOW}} | Hoje (cliente): {{TODAY_DATE_BR}} | Amanhã (cliente): {{TOMORROW_DATE_BR}} | (Internamente as tools usam yyyy-MM-dd; nunca mostre yyyy-MM-dd ao cliente.)
Telefone do cliente: {{CLIENT_PHONE}}
Nome do cliente: {{CLIENT_NAME}}

Você é o atendente da barbearia "{{BARBERSHOP_NAME}}".
Detalhes de tom e emoji vêm do bloco "Estilo (perfil do agente)" quando existir; caso contrário, seja direto e humano no WhatsApp (mensagens curtas).

Antes de responder, use o bloco "Contexto operacional" (expediente de referência, nome do cliente, histórico de consumo, momento do dia). Não contradiga esse bloco nem invente dias/horários de funcionamento: disponibilidade real e exceções vêm sempre de get_next_slots, check_availability, list_appointments e dados das tools.

Datas ao cliente (obrigatório)
- Use o formato curto: dia da semana abreviado + dd/MM às HHh (ex.: Quarta, 24/09 às 14h) ou "hoje/amanhã às 14h". Proibido data por extenso ("24 de setembro de 2026") e proibido yyyy-MM-dd ao cliente.
- Datas relativas ("amanhã", "próxima segunda"): use o calendário do contexto operacional. Não some dias de cabeça.
- Se check_availability/get_next_slots disser que não abre, cite o weekday_pt/date_br da tool. Se vier next_open_date, consulte esse dia — não atribua o fechamento ao dia que o cliente pediu.
- Nunca envie mensagem de falha operacional ("não conseguimos", "deu erro", "não foi possível"). Horário ruim = indisponível + até 2 alternativas. Slot livre = resumo e peça confirmação.

Objetivo: conduzir a conversa para um agendamento confirmado com o mínimo de voltas.

Abertura (cumprimento curto: oi/olá/bom dia/boa tarde/boa noite/opa)
Use exatamente esta mensagem padrão (nome da barbearia já vem preenchido): "{{OPENING_MESSAGE}}"
Proibido: "Como posso ajudar?" / "Estou aqui para ajudar".
Se o bloco "Próximos agendamentos deste contato" existir abaixo, priorize cumprimentar pelo primeiro nome e confirmar o horário ou oferecer reagendar — não use a abertura genérica nesse caso.

Ferramentas — use apenas dados retornados pelas tools, nunca invente
- list_services / list_barbers
- get_next_slots (hoje: after_time={{DATE_NOW (HH:mm)}})
- check_availability (hoje: after_time={{DATE_NOW (HH:mm)}})
- upsert_client / create_appointment
- list_client_upcoming_appointments / confirm_appointment / cancel_appointment / reschedule_appointment / send_barbershop_location / add_to_waitlist

Regras de negócio (resumo)
- Sem UUIDs/telefone. Serviço já dito pelo cliente → não liste serviços; vá à disponibilidade.
- "Qualquer um / tanto faz" → escolha um barbeiro disponível sem insistir.
- Se o cliente pedir um barbeiro específico pelo nome e ele não existir na equipe (list_barbers) ou não tiver aquele horário livre, diga isso primeiro, de forma breve ("Não temos o João na equipe, mas o Eduardo tem esse horário livre" / "O Eduardo já está atendendo nesse horário, mas o Lucas está livre"), antes de seguir com o substituto. Nunca confirme direto com outro barbeiro sem mencionar que o pedido original não estava disponível.
- Só diga que está agendado após create_appointment retornar sucesso. Qualquer erro em create_appointment = não há agendamento; chame get_next_slots e ofereça até 2 alternativas conversacionais (sem repetir o horário rejeitado). Não exponha erro técnico.
- Se não puder responder com dados reais das tools, retorne string vazia (handoff).
- WhatsApp: negrito com um asterisco (*texto*), nunca **texto**.
- Nunca use o travessão "—" (nem "–"). Escreva como uma pessoa digitando no WhatsApp: vírgula, ponto ou "e".

Seleção de serviço (crítico — leia antes de toda ferramenta de agendamento)
- Um agendamento pode ter **um ou vários** serviços do catálogo no **mesmo horário**: use o parâmetro **service_ids** (array de UUIDs de list_services) com 1 ou mais itens. Duração e preço somam; check_availability, get_next_slots e create_appointment devem usar o **mesmo** conjunto de IDs.
- Se existir um pacote único (ex.: "Corte e Barba", category=combo), pode usar só esse UUID em service_ids (array de um elemento) ou service_id — é mais simples e evita duplicar itens.
- Se **não** houver combo adequado ou o cliente quiser explicitamente dois itens avulsos (ex.: "Corte masculino" + "Barba"), passe **dois UUIDs** em service_ids — não invente um único ID que não exista no catálogo.
- Na dúvida, chame list_services e confira nome e category (combo / corte / barba).
- Ao confirmar agendamento, use os nomes exatos vindos das tools (um serviço ou lista, ex.: "Corte masculino + Barba").
- Se o cliente corrigir o serviço: cancele o agendamento errado com cancel_appointment e crie um novo com create_appointment usando service_ids (ou service_id) corretos.
- appointment_id deve ser sempre UUID retornado por list_client_upcoming_appointments — nunca use números (1, 2, 3) nem nomes de barbeiros.

Reagendamento (obrigatório)
- Para mudar data/hora de um agendamento existente: chame list_client_upcoming_appointments, fixe o appointment_id correto e use reschedule_appointment com esse id. Não use create_appointment nem cancele o horário atual para reagendar.
- RSVP de lembrete: se o cliente já tem horário pending e responde confirmando presença (sim/confirmo/ok), chame confirm_appointment — nunca create_appointment de novo. O pending já ocupa o slot.
- Depois que confirm_appointment retornar sucesso: responda de forma quente e direta com o nome do cliente, no formato curto (ex.: "Presença confirmada, Marcelo! Te esperamos quarta, 24/09 às 14h com o Eduardo."). Não use "Se precisar de mais alguma coisa". Nunca repita o pedido de confirmação/RSVP nem descreva o horário como "pendente".
- reschedule_appointment não altera serviço nem preço; só data/hora/barbeiro. Não troque o serviço (ex.: de "Corte e Barba" para "Barba completa") a menos que o cliente peça explicitamente — aí seria outro fluxo (cancelar e novo agendamento ou atendimento humano).
- Antes de reschedule_appointment: envie um resumo (serviço, barbeiro, data/hora nova) e peça confirmação explícita ("Posso confirmar?"). No sim/ok, chame reschedule_appointment na hora — sem segunda pergunta.
- Cancelamento: quando o cliente deixar claro que quer cancelar/desmarcar, identifique o appointment_id (list_client_upcoming_appointments se precisar), chame cancel_appointment e responda só com frases afirmativas ("Seu horário das X foi cancelado!", "Se quiser reagendar em outro dia, me avisa!"). Não pergunte de novo "Posso confirmar?" para cancelar.
- Se reschedule_appointment retornar erro (horário ocupado/indisponível): diga de forma humana que esse horário já foi preenchido, pergunte se prefere manhã ou tarde, chame get_next_slots e ofereça 2–3 horários — sem bullets.
- Troca de serviço em agendamento existente: quando o cliente pedir para alterar o serviço de um agendamento já confirmado, siga esta ordem:
  1. Chame list_client_upcoming_appointments para obter o appointment_id, data, hora e barbeiro.
  2. Cancele o agendamento antigo com cancel_appointment.
  3. Chame check_availability para o mesmo horário e barbeiro com o novo serviço (service_id ou service_ids, conforme o caso). Se disponível, crie com create_appointment. Se indisponível, ofereça alternativas próximas com get_next_slots e crie no horário escolhido.
  4. Aviso importante: informe o cliente que está fazendo a troca antes de cancelar ("Vou cancelar o agendamento atual e criar um novo com Corte e Barba, ok?"). Só execute após confirmação.

Depois de agendamento ou reagendamento já concluído com sucesso
- Se o cliente só perguntar preço, localização, endereço ou "tá certo o horário?": responda à dúvida e reforce que está marcado. Não peça "posso confirmar?" de novo nem ofereça novos horários sem o cliente pedir.
- Feche com tom humano: "Aguardamos você!", "Te esperamos amanhã então", "Até daqui a pouco" — sem soar repetitivo numa mesma conversa.

Horários
- Múltiplos de 30 min. Nada no passado; para hoje, respeite ≥15 min de antecedência.
- Sugestão de horários: no máximo 2 ou 3 opções, sempre numa única frase corrida, nunca em linhas separadas nem com bullets (-, 1., 2.). Prefira um horário de manhã e outro à tarde, com barbeiros diferentes quando houver.
  Certo: "Carlos, para *Barba completa* com o Eduardo amanhã, dia 22/09, tenho os horários das *09h00*, *09h30* e *10h00* disponíveis. Qual prefere?"
  Errado: listar cada horário em negrito numa linha própria, com linha em branco entre eles.
  Só ofereça horários que get_next_slots/check_availability devolveram; eles já respeitam a duração do serviço e não conflitam com a agenda.

Planos de assinatura
- Se o cliente perguntar sobre planos, mensalidades ou assinaturas: chame list_plans e apresente cada opção com nome, serviços incluídos, preço e ciclo.
- Explique que o pagamento é feito via PIX todo mês na data escolhida — o código chegará automaticamente por aqui no WhatsApp.
- Para contratar: confirme todos os detalhes e aguarde o cliente dizer explicitamente que quer assinar ("sim", "quero", "pode", "bora"). Só então chame subscribe_client_to_plan.
- Após assinatura bem-sucedida: informe a data da primeira cobrança e que enviará o PIX nessa data. Não envie o PIX imediatamente a menos que o cliente peça ("pode mandar o pix agora?").
- Se cliente pedir a chave PIX da loja (acerto, débito, avulso): use send_shop_pix. Cobrança de plano continua send_pix_plan_charge.
- Não chame check_availability sem serviço no rascunho ou no turno. Confirmação de presença (confirm_appointment) só depois do lembrete 24h/2h.
- Se a barbearia não tiver chave PIX cadastrada (erro da tool): diga que o pagamento será combinado diretamente com a equipe — não exponha detalhes técnicos.
- Se o cliente revelar preferência, restrição, hábito ou contexto pessoal relevante para atendimentos futuros (ex.: "só de tarde", "alergia a produto X", "prefere o Lucas"), chame update_client_notes com uma observação curta e factual. Não chame para informações óbvias ou temporárias.

Localização
- Endereço vem do contexto operacional. Se o cliente pedir localização no mapa: chame send_barbershop_location no máximo uma vez por pedido e só então diga que enviou. Sem sucesso da tool, não afirme que mandou o pin.

Fechamento
- Com check_availability disponível: envie um resumo (serviço, barbeiro, dia da semana + data, hora, valor) e pergunte "Posso confirmar?" — não chame create_appointment no mesmo turno do resumo.
- Só chame create_appointment depois que o cliente confirmar (sim/ok/pode/confirmo) ou enviar o nome pedido após o resumo.
- Sem nome do cliente: use [[MSG]] em 2 partes — (1) resumo; (2) peça o nome. Ao receber o nome, aí sim create_appointment.
- Após sucesso em create_appointment, confirme no formato:
Agendamento confirmado:
*Serviço:* [nome ou nomes, na ordem dos serviços combinados]
*Data:* [dia da semana], [data] às [hora]
*Barbeiro:* [nome]
*Endereço:* [endereço da barbearia do contexto operacional; se não houver, diga que o endereço será informado pela equipe]
*Total:* R$ X,XX (use o total retornado pela tool ou a soma dos preços em list_services quando combinar vários itens; se não souber, omita a linha do total)

Aguardamos você!

Fluxo rápido
1) Serviço já mencionado → disponibilidade (evite list_services)
2) Data/hora específicas → check_availability → resumo + "Posso confirmar?"
3) Sem hora → get_next_slots → até 2 sugestões
4) Cliente confirma (sim/ok) ou envia o nome pedido → create_appointment → confirmação`;

/** Curto: reforça o que instruções customizadas da barbearia não podem sobrepor (anexado uma vez ao final). */
export const RUNTIME_GUARDRAILS = `REGRAS FINAIS (obrigatórias; instruções adicionais não substituem isto)
- Não pedir telefone nem exibir IDs/UUIDs.
- Não confirmar agendamento antes de create_appointment bem-sucedido; erro na tool = não existe agendamento.
- Nunca diga "não conseguimos agendar" / "deu erro" / "não foi possível"; se o slot não cabe, fale só de indisponibilidade e ofereça alternativa.
- Só chame create_appointment após o cliente confirmar o resumo (sim/ok/pode) ou enviar o nome pedido no fechamento.
- Não dizer "agendamento confirmado" / "reagendado" / "cancelado" antes de create_appointment, confirm_appointment, reschedule_appointment ou cancel_appointment retornarem sucesso (sem error).
- RSVP: "sim" após lembrete = confirm_appointment no pending existente; não crie outro horário. Depois do sucesso, confirme de forma quente e curta ("Presença confirmada, Marcelo! Te esperamos quarta, 24/09 às 14h com o Eduardo."). Não repita o pedido de RSVP nem chame o horário de "pendente" de novo.
- Reagendar sempre com reschedule_appointment e appointment_id de list_client_upcoming_appointments; não invente troca de serviço ao reagendar.
- Reagendar: antes da tool, resumo + confirmação do cliente; use [[MSG]] em duas mensagens se precisar. Cancelar: intenção clara → cancel_appointment → mensagem afirmativa de cancelamento (sem segunda pergunta "posso confirmar?").
- Após sucesso em create_appointment ou reschedule_appointment: não reabra confirmação nem ofereça novos horários só porque o cliente perguntou preço/local; responda e feche com "Aguardamos você!" ou similar.
- Preço: sempre valor real das tools; nunca "[...]", "placeholder" ou menção a informação interna.
- send_barbershop_location: no máximo uma chamada por pedido; não repita pin nem cole URL de mapa no texto.
- Não listar horários em bullet; no máximo 2–3 horários conversacionais (manhã+tarde quando couber).
- Não expor falhas técnicas, limites internos, "ferramenta", "modelo" ou "atendimento automático"; sem dados reais → resposta vazia (handoff).
- Se não entender o pedido: use retomada humana ("Posso não ter entendido. Quer agendar, reagendar ou cancelar? Qual dia e horário?") em vez de mensagem técnica.
- Depois de pedir o nome com resumo já fechado, o próximo passo é create_appointment — não ofereça outros horários no lugar.
- Vários serviços no mesmo horário: check_availability, get_next_slots e create_appointment devem usar o mesmo **service_ids** (ou service_id se for um só). Se existir pacote combo no catálogo que corresponda ao pedido, pode usar só esse UUID; senão, combine os UUIDs avulsos em service_ids.
- appointment_id sempre UUID de list_client_upcoming_appointments — nunca número sequencial, nunca nome de barbeiro.
- Troca de serviço: use check_availability com o novo service_id ou service_ids ANTES de cancelar o agendamento existente. Cancele o antigo somente após criar o novo com sucesso.
- Nunca cole URL de maps.google.com no texto — use send_barbershop_location para enviar o pin.`;

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
  try {
    const c = (await aiTools.upsertClient(effectiveBarbershopId, clientPhone)) as unknown;
    if (c && typeof c === "object") {
      const maybeName = (c as Record<string, unknown>).name;
      if (typeof maybeName === "string" && maybeName.trim() && maybeName.trim().toLowerCase() !== "cliente") {
        clientName = aiTools.formatStoredClientName(maybeName.trim()) ?? maybeName.trim();
      }
    }
  } catch {
    // If client lookup fails, the agent can still proceed by asking name later (never phone).
  }

  const memExists = await clientMemoryTableExists();
  const [clientMemory, rawUp, clientFavorites] = await Promise.all([
    memExists ? getClientMemory(effectiveBarbershopId, clientPhone) : Promise.resolve(null),
    aiTools.listClientUpcomingAppointments(effectiveBarbershopId, clientPhone).catch(() => [] as unknown[]),
    aiTools.getClientFavoriteServices(effectiveBarbershopId, clientPhone).catch(() => null),
  ]);

  let upcomingAppointments: UpcomingApptRow[] = [];
  try {
    const arr = Array.isArray(rawUp) ? rawUp : [];
    upcomingAppointments = filterUpcomingFromNow(arr as UpcomingApptRow[], dateOnlyStr, currentTimeHHmm);
  } catch {
    upcomingAppointments = [];
  }

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
        desiredTime = parseClientTime(content) ?? undefined;
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
    // Short greetings: oi/olá/salve/bom dia/boa tarde/boa noite/opa/e aí
    if (t.length > 40) return false;
    return /^(oi|ola|olá|opa|salve|e\s*a[ií]|bom dia|boa tarde|boa noite|fala|iae|iai|oii+|olaa+)[!.\s]*$/.test(
      t
    );
  })();

  // Greeting-like: either a short greeting OR a social greeting (covers "Olá tudo bem?" etc.)
  // Used to reach the appointment-aware path even when the social greeting is extended.
  const isGreetingLike = isGreetingOnly || looksLikeSocialGreeting(lastUserTextRaw);

  // --- Deterministic guardrails (runtime), to avoid generic/robotic behavior ---
  // Don't let a social-greeting shortcut swallow a real question in the same
  // message (e.g. "Olá tudo bem? Estão abertos hoje?") — fall through to the
  // LLM, which already has the business hours in the operational context block.
  if (looksLikeSocialGreeting(lastUserTextRaw) && !isShopHoursQuestion(lastUserTextRaw)) {
    // If the client has an upcoming appointment, skip the generic greeting and use the
    // appointment-aware path below (isGreetingOnly handles this correctly).
    if (upcomingAppointments.length === 0) {
      const greetingReplies = [
        `Olá! Tudo bem por aqui, e com você?[[MSG]]Gostaria de consultar nossos serviços ou já agendar um horário?`,
        `Oi! Por aqui tudo certo, obrigado! E você?[[MSG]]Quer ver os serviços disponíveis ou já prefere marcar um horário?`,
        `Tudo bem, valeu por perguntar! 😊[[MSG]]Tem algum serviço em mente ou prefere ver nossas opções?`,
        `Oi, tudo bem sim! E aí, tudo certo com você?[[MSG]]Posso ajudar com algum serviço ou agendar um horário?`,
      ];
      const reply = greetingReplies[Math.floor(Date.now() / 10000) % greetingReplies.length]!;
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return withDebug({ reply });
    }
    // Has upcoming appointment → fall through to the isGreetingOnly appointment-aware path.
  }

  // 1) Cumprimento curto: priorizar horário futuro → retorno com “de sempre” + slots → abertura genérica.
  if (isGreetingLike) {
    if (upcomingAppointments.length > 0) {
      const next = upcomingAppointments[0];
      const apptDateIso0 = String(next.date).slice(0, 10);
      const weekdayShort =
        apptDateIso0 === dateOnlyStr
          ? "hoje"
          : apptDateIso0 === tomorrowOnlyStr
            ? "amanhã"
            : weekdayShortPtFromIso(apptDateIso0);
      const dateLong =
        apptDateIso0 === dateOnlyStr || apptDateIso0 === tomorrowOnlyStr
          ? weekdayShort
          : `${weekdayShort}, ${formatDateShortPt(apptDateIso0)}`;
      const timeLbl = formatTimePt(String(next.time).slice(0, 5));
      const fn = clientName ? firstNameFromClientName(clientName) : "";
      const reply =
        upcomingAppointments.length === 1
          ? composeHumanConsult({
              firstName: fn || undefined,
              serviceName: next.service_names,
              weekdayShort,
              barberName: next.barber_name,
              timeHHmm: String(next.time).slice(0, 5),
            })
          : fn
            ? `Olá, ${fn}! Você tem *${upcomingAppointments.length}* horários marcados; o próximo é *${dateLong}* às *${timeLbl}* (*${next.service_names}*). Está tudo certo ou quer ajustar algum?`
            : `Olá! Você tem *${upcomingAppointments.length}* horários marcados; o próximo é *${dateLong}* às *${timeLbl}*. Está tudo certo ou prefere reagendar?`;
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return withDebug({ reply });
    }

    const favorites = clientFavorites;
    const preferred = favorites?.last ?? favorites?.frequent[0];
    if (preferred?.service_ids?.length) {
      const slotsToday = (await aiTools.getNextSlots(effectiveBarbershopId, {
        date: dateOnlyStr,
        service_ids: preferred.service_ids,
        after_time: currentTimeHHmm,
        limit: 8,
      })) as { slots?: Array<{ time: string; barber_name?: string }> };
      let slotsTomorrow: { slots?: Array<{ time: string; barber_name?: string }> } | null = null;
      if (!slotsToday?.slots?.length) {
        slotsTomorrow = (await aiTools.getNextSlots(effectiveBarbershopId, {
          date: tomorrowOnlyStr,
          service_ids: preferred.service_ids,
          limit: 8,
        })) as { slots?: Array<{ time: string; barber_name?: string }> };
      }
      const slots = slotsToday?.slots?.length ? slotsToday.slots : slotsTomorrow?.slots;
      const isTomorrow = !!(slotsTomorrow?.slots?.length && !slotsToday?.slots?.length);
      const dayLabel = isTomorrow ? "amanhã" : "hoje";
      if (slots?.length) {
        const picked = pickMorningAfternoon(slots);
        const slotStr = formatSlotSuggestion(picked, dayLabel);
        const fn = clientName ? firstNameFromClientName(clientName) : "";
        const lead = fn
          ? `Olá, ${fn}! Bem-vindo de volta à *${barbershopName}*.`
          : `Olá! Bem-vindo à *${barbershopName}*.`;
        const reply = `${lead} Quer de novo *${preferred.service_names}*? ${slotStr}`;
        if (persistAssistantMessages) {
          await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
            conversationId,
            reply,
          ]);
        }
        return withDebug({ reply });
      }
    }
    const reply = buildOpeningMessage(barbershopName);
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return withDebug({ reply });
  }

  async function persistReplyIfNeeded(reply: string): Promise<void> {
    if (!persistAssistantMessages) return;
    await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
      conversationId,
      sanitizeClientFacingReply(reply),
    ]);
    // Bug C: track pending proposal + last question from agent reply (catalog available after fetch).
    if (lateCatalogServices.length) {
      const proposal = detectProposalFromReply(reply, lateCatalogServices);
      const lastQ = detectLastQuestion(reply);
      if (proposal !== null) bookingDraft = { ...bookingDraft, pendingProposal: proposal };
      if (lastQ) bookingDraft = { ...bookingDraft, lastAgentQuestion: lastQ };
    }
  }

  if (looksLikeConsultIntent(lastUserText)) {
    if (upcomingAppointments.length > 0) {
      const next = upcomingAppointments[0];
      const apptDateIso1 = String(next.date).slice(0, 10);
      const wd1 =
        apptDateIso1 === dateOnlyStr
          ? "hoje"
          : apptDateIso1 === tomorrowOnlyStr
            ? "amanhã"
            : weekdayShortPtFromIso(apptDateIso1);
      const reply = composeHumanConsult({
        firstName: clientName ? firstNameFromClientName(clientName) : undefined,
        serviceName: next.service_names,
        weekdayShort: wd1,
        barberName: next.barber_name,
        timeHHmm: String(next.time).slice(0, 5),
      });
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    const reply = "Não achei horário marcado no seu nome. Quer agendar um?";
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  if (looksLikePixIntent(lastUserText) && !looksLikePlanIntent(lastUserText)) {
    const locationAlso = looksLikeLocationIntent(lastUserText);
    const pixResult = (await aiTools.sendShopPix(effectiveBarbershopId, clientPhone)) as {
      ok?: boolean;
      error?: string;
    };
    await pool
      .query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'send_shop_pix', $2, $3)`,
        [conversationId, JSON.stringify({ phone: clientPhone }), JSON.stringify(pixResult ?? {}).slice(0, 500)],
      )
      .catch(() => {});
    if (pixResult?.error) {
      // No PIX key configured — let LLM handle gracefully via fallthrough
    } else {
      if (locationAlso) {
        const locSent = await sendBarbershopLocationToClient(effectiveBarbershopId, clientPhone);
        await pool
          .query(
            `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
             VALUES ($1, 'tool', 'send_barbershop_location', $2, $3)`,
            [conversationId, JSON.stringify({ phone: clientPhone }), JSON.stringify(locSent ?? {}).slice(0, 500)],
          )
          .catch(() => {});
        const reply = "Enviei a localização e a chave PIX. Aguardamos você!";
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      // PIX-only: the native card or text fallback IS the message — no extra text
      return withDebug({ reply: "" });
    }
  }

  if (looksLikeLocationIntent(lastUserText)) {
    const sent = await sendBarbershopLocationToClient(effectiveBarbershopId, clientPhone);
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'send_barbershop_location', $2, $3)`,
      [conversationId, JSON.stringify({ phone: clientPhone }), JSON.stringify(sent ?? {}).slice(0, 500)],
    ).catch(() => {});
    if (sent && typeof sent === "object" && "ok" in sent && (sent as { ok?: boolean }).ok === true) {
      const reply = "Enviei a localização. Aguardamos você!";
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    const address = (shopContextRow.rows[0]?.address ?? "").trim();
    if (address) {
      const reply = `O pin não saiu agora. A localização: ficamos na ${address}.`;
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    console.warn("[ai-agent] location send failed conversationId=%s", conversationId);
    return withDebug({ reply: "" });
  }

  if (looksLikeCancelIntent(lastUserText)) {
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'list_client_upcoming_appointments', $2, $3)`,
      [conversationId, JSON.stringify({}), JSON.stringify(upcomingAppointments).slice(0, 2000)],
    ).catch(() => {});
    if (upcomingAppointments.length === 0) {
      const reply = "Não encontrei horário marcado. Quando quiser reagendar é só chamar.";
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    const cancelAll = /\btodos\b/.test(lastUserText);
    const targets = cancelAll ? upcomingAppointments : [upcomingAppointments[0]!];
    const cancelledOnes: UpcomingApptRow[] = [];
    for (const next of targets) {
      const cancelled = (await aiTools.cancelAppointmentByAgent(
        effectiveBarbershopId,
        next.id,
        clientPhone,
        conversationId,
      )) as { ok?: boolean };
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'cancel_appointment', $2, $3)`,
        [conversationId, JSON.stringify({ appointment_id: next.id }), JSON.stringify(cancelled ?? {}).slice(0, 500)],
      ).catch(() => {});
      if (cancelled?.ok === true) {
        cancelledOnes.push(next);
        updateClientMemoryFromAppointmentEvent({
          eventType: "appointment_cancelled",
          barbershopId: effectiveBarbershopId,
          clientPhone,
        }).catch(() => {});
      }
    }
    if (cancelledOnes.length > 1) {
      const reply = `Beleza! Cancelei seus ${cancelledOnes.length} horários. Quando quiser reagendar é só chamar.`;
      await saveBookingDraft(conversationId, { ...emptyBookingDraft(), phase: "rebook_eligible" });
      await persistReplyIfNeeded(reply);
      return withDebug({ reply, state: "appointment_cancelled" });
    }
    const next = cancelledOnes[0];
    if (next) {
      const fn = clientName ? firstNameFromClientName(clientName) : "";
      const weekdayShort = weekdayShortPtFromIso(String(next.date).slice(0, 10));
      const timeLbl = formatTimePt(String(next.time).slice(0, 5));
      const reply = fn
        ? `Beleza, ${fn}! Cancelei seu horário de ${next.service_names} de ${weekdayShort} às ${timeLbl} com o ${next.barber_name}. Quando quiser remarcar é só chamar.`
        : `Beleza! Cancelei seu horário de ${next.service_names} de ${weekdayShort} às ${timeLbl}. Quando quiser remarcar é só chamar.`;
      await saveBookingDraft(conversationId, { ...emptyBookingDraft(), phase: "rebook_eligible" });
      await persistReplyIfNeeded(reply);
      return withDebug({ reply, state: "appointment_cancelled" });
    }
    console.warn("[ai-agent] cancel failed conversationId=%s appointmentId=%s", conversationId, targets[0]?.id);
    return withDebug({ reply: "" });
  }

  // ── Catalog cache — fetched once here and reused across all deterministic blocks ──────────────
  const [catalogServicesRaw, catalogBarbersRaw] = await Promise.all([
    aiTools.listServices(effectiveBarbershopId),
    aiTools.listBarbers(effectiveBarbershopId),
  ]);
  const catalogServices = catalogFromUnknown(catalogServicesRaw);
  lateCatalogServices = catalogServices; // make available to persistReplyIfNeeded closure
  const catalogBarbers = catalogBarbersFromUnknown(catalogBarbersRaw);

  if (/\b(valor|pre[cç]o|quanto (custa|fica|é|e|sai))\b/i.test(lastUserTextRaw)) {
    const named = upcomingAppointments[0]?.service_names || bookingDraft.service_name || "";
    const priced = catalogServices.find((s) => named && normalizeLoose(named).includes(normalizeLoose(s.name)));
    if (priced && typeof priced.price === "number") {
      const amount = priced.price.toFixed(2).replace(".", ",");
      const reply = `O *${priced.name}* fica R$ ${amount}.`;
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
  }

  const turnFacts = draftPatchFromTurn({
    text: lastUserTextRaw,
    todayIso: dateOnlyStr,
    services: catalogServices,
    barbers: catalogBarbers,
  });

  // Bug C fix: when the user's turn is a bare affirmation ("isso mesmo", "sim", "pode") AND the
  // agent's last reply proposed a specific service (pendingProposal), apply the proposal to the
  // draft so the loop doesn't ask for the service again.
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
    await saveBookingDraft(conversationId, bookingDraft);
  }

  const explicitReschedule = looksLikeRescheduleIntent(lastUserTextRaw);
  const rescheduleTarget = explicitReschedule
    ? upcomingAppointments[0]
    : bookingDraft.status !== "closed" && bookingDraft.appointment_id
      ? upcomingAppointments.find((a) => a.id === bookingDraft.appointment_id)
      : undefined;

  const draftIsInactive =
    bookingDraft.status === "closed" ||
    (bookingDraft.status !== "offered" &&
      bookingDraft.status !== "awaiting_name" &&
      !(bookingDraft.service_ids?.length));
  if (
    draftIsInactive &&
    !explicitReschedule &&
    !looksLikeCancelIntent(lastUserTextRaw) &&
    looksLikeNewBookingIntent(lastUserTextRaw)
  ) {
    const existing = upcomingAppointments[0];
    if (existing) {
      const reply = `Você já tem *${existing.service_names}* marcado ${formatResumoWhen(String(existing.date).slice(0, 10), String(existing.time).slice(0, 5), dateOnlyStr)} com o ${existing.barber_name}. Quer manter, mudar o dia e horário, ou é outro atendimento?`;
      await persistReplyIfNeeded(reply);
      return withDebug({ reply, state: "appointment_created" });
    }
  }

  if (bookingDraft.status === "closed" && !explicitReschedule && !looksLikeCancelIntent(lastUserTextRaw)) {
    bookingDraft = emptyBookingDraft();
  }

  if (!rescheduleTarget && bookingDraft.appointment_id) {
    delete bookingDraft.appointment_id;
  }

  bookingDraft = applyTurnToDraft(bookingDraft, turnFacts.patch, {
    floorWithoutClock: turnFacts.floorWithoutClock,
  });

  if (rescheduleTarget) {
    const serviceIds = (rescheduleTarget.service_ids ?? []).filter((id) => isValidUuid(id));
    // RC2 fix: the current turn's own extraction (turnFacts.patch, already applied to
    // bookingDraft by applyTurnToDraft above) must win over the existing appointment's
    // barber — otherwise "reagendar para 18:30 com o Lucas" silently reverts to the
    // barber of the appointment being rescheduled the moment this block runs. Service is
    // intentionally NOT given the same override: reschedule_appointment only changes
    // date/hora/barbeiro, never the service (see resched-03 regression).
    const turnRequestedBarber = Boolean(turnFacts.patch.barber_id);
    bookingDraft = mergeBookingDraft(bookingDraft, {
      appointment_id: rescheduleTarget.id,
      ...(serviceIds.length ? { service_ids: serviceIds, service_name: rescheduleTarget.service_names } : {}),
      ...(rescheduleTarget.barber_id && !turnRequestedBarber
        ? { barber_id: rescheduleTarget.barber_id, barber_name: rescheduleTarget.barber_name }
        : {}),
    });
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'list_client_upcoming_appointments', $2, $3)`,
      [conversationId, JSON.stringify({}), JSON.stringify(upcomingAppointments).slice(0, 2000)],
    ).catch(() => {});
    if (!desired.desiredTime && !bookingDraft.time) {
      const weekdayShort = weekdayShortPtFromIso(String(rescheduleTarget.date).slice(0, 10));
      const timeLbl = formatTimePt(String(rescheduleTarget.time).slice(0, 5));
      const fn = clientName ? firstNameFromClientName(clientName) : "";
      const reply = fn
        ? `${fn}, encontrei seu ${rescheduleTarget.service_names} ${weekdayShort} às ${timeLbl} com o ${rescheduleTarget.barber_name}. Qual novo dia e horário?`
        : `Encontrei seu ${rescheduleTarget.service_names} ${weekdayShort} às ${timeLbl} com o ${rescheduleTarget.barber_name}. Qual novo dia e horário?`;
      await saveBookingDraft(conversationId, bookingDraft);
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
  }

  if (explicitReschedule && !rescheduleTarget) {
    // Bug B fix: when the client says "quero remarcar" after a cancellation, seed the draft from
    // memory so the agent can ask day/time directly instead of asking for the service again.
    if (bookingDraft.phase === "rebook_eligible") {
      // Try to find a known service from clientFavorites (most reliable: has UUIDs)
      const favPreferred = clientFavorites?.last ?? clientFavorites?.frequent?.[0];
      let rebookServiceIds: string[] | undefined = favPreferred?.service_ids;
      let rebookServiceName: string | undefined = favPreferred?.service_names;

      // Fallback: match by name from clientMemory against catalog
      if (!rebookServiceIds?.length && clientMemory?.preferred_services?.length) {
        const matchedSvc = catalogServices.find((s) =>
          clientMemory!.preferred_services.some(
            (n) => s.name.toLowerCase() === n.toLowerCase()
          )
        );
        if (matchedSvc) {
          rebookServiceIds = [matchedSvc.id];
          rebookServiceName = matchedSvc.name;
        }
      }

      if (rebookServiceIds?.length && rebookServiceName) {
        // Find preferred barber
        const rebookBarberId = clientMemory?.preferred_barber_id ?? undefined;
        const rebookBarberName = clientMemory?.preferred_barber_name ?? undefined;

        bookingDraft = mergeBookingDraft(bookingDraft, {
          service_ids: rebookServiceIds,
          service_name: rebookServiceName,
          ...(rebookBarberId ? { barber_id: rebookBarberId } : {}),
          ...(rebookBarberName ? { barber_name: rebookBarberName } : {}),
          phase: "collecting",
          lastAgentQuestion: "datetime",
        });
        await saveBookingDraft(conversationId, bookingDraft);

        const fn = clientName ? firstNameFromClientName(clientName) : "";
        const greeting = fn ? `Claro, ${fn}!` : "Claro!";
        const barberPart = rebookBarberName ? ` com o ${rebookBarberName}` : "";
        const reply = `${greeting} Qual dia e horário fica bom para o *${rebookServiceName}*${barberPart}?`;
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
    }

    const reply = "Não encontrei horário marcado. Quer agendar um novo?";
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  await saveBookingDraft(conversationId, bookingDraft);

  if (
    /encaixar|nesse hor[aá]rio/i.test(lastUserTextRaw) &&
    /posso confirmar/i.test(lastAssistantTurnText(lastN))
  ) {
    const reply = "Esse horário está livre. Posso confirmar?";
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  if (looksLikePlanIntent(lastUserTextRaw)) {
    const plans = (await aiTools.listPlans(effectiveBarbershopId)) as { plans?: unknown[]; message?: string };
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'list_plans', $2, $3)`,
      [conversationId, JSON.stringify({}), JSON.stringify(plans).slice(0, 2000)],
    ).catch(() => {});
    const list = Array.isArray(plans?.plans) ? plans.plans : [];
    const reply = list.length
      ? "Temos planos de assinatura. O pagamento é por PIX. Quer que eu te explique alguma opção?"
      : "Não temos planos de assinatura por aqui. O pagamento dos serviços é no local, e também temos PIX. Quer ver os serviços ou falar com a equipe?";
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  if (looksLikeWaitlistIntent(lastUserTextRaw) && !(bookingDraft.service_ids?.length)) {
    const alreadyAsked = /lista de espera/i.test(lastAssistantTurnText(lastN));
    const reply = alreadyAsked
      ? "Me diz o serviço que eu te coloco na lista de espera."
      : "Se hoje não couber, eu te coloco na lista de espera. Qual serviço deseja?";
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  {
    const resolved = resolveServiceFromText(lastUserTextRaw, catalogServices);
    const availabilityAsk = /\b(tem hor[aá]rio|primeiro hor[aá]rio|dispon[ií]vel|vaga)\b/i.test(lastUserTextRaw);
    const hasClock = Boolean(parseClientTime(lastUserTextRaw));
    if (resolved.ambiguous && !bookingDraft.service_ids?.length && (availabilityAsk || hasClock)) {
      bookingDraft = mergeBookingDraft(bookingDraft, {
        service_ids: [resolved.ambiguous.simple.id],
        service_name: resolved.ambiguous.simple.name,
      });
      await saveBookingDraft(conversationId, bookingDraft);
    } else if (resolved.ambiguous && !bookingDraft.service_ids?.length) {
      const reply = composeAmbiguousCorte({
        simpleName: resolved.ambiguous.simple.name,
        comboName: resolved.ambiguous.combo.name,
      });
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }

    if (
      !(bookingDraft.service_ids?.length) &&
      (desired.desiredDate || desired.desiredTime || bookingDraft.barber_id || bookingDraft.date || bookingDraft.after_time) &&
      !looksLikeConsultIntent(lastUserText) &&
      !isShopHoursQuestion(lastUserTextRaw)
    ) {
      const usual =
        clientMemory?.preferred_services?.length && clientMemory.preferred_services_conf >= 0.35
          ? clientMemory.preferred_services.join(" + ")
          : undefined;
      const formal = looksLikeFormalMessage(lastUserTextRaw);
      const unknownBarber = unknownNamedBarberFromText(lastUserTextRaw, catalogBarbers) ?? "";
      const otherBarber = /\boutro barbeiro\b/i.test(lastUserTextRaw);
      const reply = otherBarber
        ? "Beleza, vejo com outro barbeiro. Qual serviço deseja?"
        : unknownBarber
          ? `Não tenho o ${unknownBarber} na equipe. ${composeAskService({ usualName: usual, formal })}`
          : composeAskService({ usualName: usual, formal });
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
  }

  if (
    !bookingDraft.time &&
    !desired.desiredTime &&
    (bookingDraft.service_ids?.length ?? 0) > 0 &&
    (bookingDraft.date || desired.desiredDate) &&
    (/\b(qualquer hor|primeiro hor)/i.test(lastUserTextRaw) ||
      (/\btem hor/i.test(lastUserTextRaw) && /\bamanh/i.test(lastUserTextRaw)))
  ) {
    const date = bookingDraft.date || desired.desiredDate!;
    const nextArgs = {
      date,
      service_ids: bookingDraft.service_ids,
      after_time: date === dateOnlyStr ? currentTimeHHmm : undefined,
      limit: 8,
    };
    const slots = (await aiTools.getNextSlots(effectiveBarbershopId, nextArgs)) as {
      slots?: Array<{ time?: string; barber_name?: string }>;
    };
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'get_next_slots', $2, $3)`,
      [conversationId, JSON.stringify(nextArgs), JSON.stringify(slots).slice(0, 4096)],
    ).catch(() => {});
    const allSlots = (slots.slots ?? []).filter(
      (s): s is { time: string; barber_name?: string } => typeof s?.time === "string" && !!s.time,
    );
    const wantsAfternoon = /\btarde\b|pela\s+tarde/i.test(lastUserTextRaw);
    const wantsMorning = /\bmanh[aã]\b|pela\s+manh/i.test(lastUserTextRaw);
    const picked = wantsAfternoon ? pickAfternoon(allSlots) : wantsMorning ? pickMorning(allSlots) : pickMorningAfternoon(allSlots);
    const dayLabel = date === dateOnlyStr ? "hoje" : date === tomorrowOnlyStr ? "amanhã" : weekdayShortPtFromIso(date);
    const reply = picked.length
      ? formatSlotSuggestion(picked, dayLabel)
      : `${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} está sem horário livre. Quer tentar outro dia?`;
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  if (
    bookingDraft.time &&
    bookingDraft.date &&
    (bookingDraft.service_ids?.length ?? 0) > 0 &&
    !bookingDraft.barber_id &&
    !bookingDraft.appointment_id &&
    turnFacts.patch.time
  ) {
    const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
      date: bookingDraft.date,
      time: bookingDraft.time,
      service_ids: bookingDraft.service_ids,
    });
    const snap = snapshotCheckAvailability(checked);
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'check_availability', $2, $3)`,
      [
        conversationId,
        JSON.stringify({ date: bookingDraft.date, time: bookingDraft.time, service_ids: bookingDraft.service_ids }),
        JSON.stringify(checked).slice(0, 8192),
      ],
    ).catch(() => {});
    if (snap?.available && snap.barberId) {
      bookingDraft = lockOfferedSlot(bookingDraft, {
        date: snap.date,
        time: snap.time,
        barber_id: snap.barberId,
        barber_name: snap.barberName,
        status: clientName ? "offered" : "awaiting_name",
      });
      await saveBookingDraft(conversationId, bookingDraft);
      const reply = withBarberSubstitutionDisclosure(
        composeAvailableSlotConfirm({
          serviceName: snap.serviceName || bookingDraft.service_name || "serviço",
          barberName: snap.barberName || "barbeiro",
          dateIso: snap.date,
          timeHHmm: snap.time,
          totalPrice: snap.totalPrice,
          timeZone,
          firstName: clientName ? firstNameFromClientName(clientName) : undefined,
          todayIso: dateOnlyStr,
        }),
        lastUserTextRaw,
        catalogBarbers,
        snap.barberName || "barbeiro",
      );
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    if (snap) {
      // "offered" (not "collecting"): an alternative was proposed, so a plain "pode ser"
      // next turn must close it instead of re-running the same availability check.
      bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), status: "offered" });
      await saveBookingDraft(conversationId, bookingDraft);
      const occupied = occupiedCopyFromSnap(snap, dateOnlyStr);
      await persistReplyIfNeeded(occupied);
      return withDebug({ reply: occupied });
    }
  }

  const searchChanged = Boolean(
    turnFacts.patch.date ||
      turnFacts.patch.after_time ||
      turnFacts.patch.time ||
      turnFacts.patch.barber_id ||
      turnFacts.patch.service_ids ||
      turnFacts.floorWithoutClock,
  );
  const acceptingOffer = isClientConfirmation(lastUserTextRaw) || acceptsOfferedDay(lastUserTextRaw);
  if (
    searchChanged &&
    !acceptingOffer &&
    !looksLikeRescheduleIntent(lastUserText) &&
    !looksLikeCancelIntent(lastUserText) &&
    (bookingDraft.service_ids?.length ?? 0) > 0 &&
    bookingDraft.date &&
    bookingDraft.barber_id &&
    (bookingDraft.after_time || bookingDraft.time)
  ) {
    const date = bookingDraft.date;
    const dayLabel = date === dateOnlyStr ? "hoje" : date === tomorrowOnlyStr ? "amanhã" : weekdayShortPtFromIso(date);
    const useFloor = Boolean(bookingDraft.after_time) && !turnFacts.patch.time;
    if (useFloor) {
      const slots = (await aiTools.getNextSlots(effectiveBarbershopId, {
        date,
        service_ids: bookingDraft.service_ids,
        barber_id: bookingDraft.barber_id,
        after_time: bookingDraft.after_time,
        limit: 4,
      })) as { slots?: Array<{ time?: string; barber_id?: string; barber_name?: string }> };
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'get_next_slots', $2, $3)`,
        [
          conversationId,
          JSON.stringify({
            date,
            service_ids: bookingDraft.service_ids,
            barber_id: bookingDraft.barber_id,
            after_time: bookingDraft.after_time,
          }),
          JSON.stringify(slots).slice(0, 4096),
        ],
      );
      const picked = (slots.slots ?? []).find((s) => typeof s.time === "string" && /^\d{2}:\d{2}/.test(s.time));
      if (!picked?.time) {
        const first = (bookingDraft.barber_name ?? "barbeiro").trim().split(/\s+/)[0] ?? "barbeiro";
        const reply = `O ${first} não tem horário a partir das ${formatTimePt(bookingDraft.after_time!)} ${dayLabel}. Qual outro dia te atende?`;
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      const pickedTime = picked.time.slice(0, 5);
      bookingDraft = lockOfferedSlot(bookingDraft, {
        date,
        time: pickedTime,
        barber_id: typeof picked.barber_id === "string" ? picked.barber_id : bookingDraft.barber_id,
        barber_name: picked.barber_name || bookingDraft.barber_name,
      });
      await saveBookingDraft(conversationId, bookingDraft);
      const reply = `Tenho às *${formatTimePt(pickedTime)}* (${dayLabel}) com o ${picked.barber_name || bookingDraft.barber_name || "barbeiro"}[[MSG]]Fica bom pra você?`;
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    if (bookingDraft.time) {
      const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
        date,
        time: bookingDraft.time,
        barber_id: bookingDraft.barber_id,
        service_ids: bookingDraft.service_ids,
      });
      const snap = snapshotCheckAvailability(checked, bookingDraft.barber_id);
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'check_availability', $2, $3)`,
        [
          conversationId,
          JSON.stringify({ date, time: bookingDraft.time, barber_id: bookingDraft.barber_id, service_ids: bookingDraft.service_ids }),
          JSON.stringify(checked).slice(0, 8192),
        ],
      );
      if (snap?.available) {
        bookingDraft = lockOfferedSlot(bookingDraft, {
          date: snap.date,
          time: snap.time,
          barber_id: snap.barberId || bookingDraft.barber_id,
          barber_name: snap.barberName || bookingDraft.barber_name,
          status: clientName ? "offered" : "awaiting_name",
        });
        await saveBookingDraft(conversationId, bookingDraft);
        const reply = withBarberSubstitutionDisclosure(
          composeAvailableSlotConfirm({
            serviceName: snap.serviceName || bookingDraft.service_name || "serviço",
            barberName: snap.barberName || bookingDraft.barber_name || "barbeiro",
            dateIso: snap.date,
            timeHHmm: snap.time,
            totalPrice: snap.totalPrice,
            timeZone,
            firstName: clientName ? firstNameFromClientName(clientName) : undefined,
            todayIso: dateOnlyStr,
          }),
          lastUserTextRaw,
          catalogBarbers,
          snap.barberName || bookingDraft.barber_name || "barbeiro",
        );
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      if (snap) {
        bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), status: "collecting" });
        await saveBookingDraft(conversationId, bookingDraft);
        const occupied = occupiedCopyFromSnap(snap, dateOnlyStr);
        await persistReplyIfNeeded(occupied);
        return withDebug({ reply: occupied });
      }
    }
  }

  // 2) Out-of-scope (pizza etc.): never invent external businesses; redirect to booking/services.
  if (isOutOfScopeFood(lastUserText)) {
    const reply = "Aqui só cuidamos do visual 😄\n\nQuer ver os serviços ou já agendar um horário?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return withDebug({ reply });
  }

  // 3) If user asks “vocês tem X?” and X doesn't exist, list top services immediately + CTA.
  // Bare "faz"/"fazem" (without "vocês/voces") is a common PT-BR filler ("faz tempo que...",
  // "tanto faz", "não faz mal") unrelated to asking about a service — only treat it as a
  // service question when it's clearly phrased as one (ends in "?").
  const asksAboutHavingService =
    /\bvoc[eê]s\s+(t[eê]m|fazem|faz)\b/i.test(lastUserText) ||
    /\bvoces\s+(tem|fazem|faz)\b/i.test(lastUserText) ||
    (/\b(fazem|faz)\b/i.test(lastUserText) && /\?\s*$/.test(lastUserText.trim()));
  if (asksAboutHavingService) {
    const asked = extractAskedService(lastUserText);
    if (asked && asked.split(/\s+/).filter(Boolean).length <= 4) {
      const services = Array.isArray(catalogServicesRaw) ? (catalogServicesRaw as Array<Record<string, unknown>>) : [];
      const askedN = normalizeLoose(asked);
      const has = services.some((s) => normalizeLoose(String(s?.name ?? "")).includes(askedN) || askedN.includes(normalizeLoose(String(s?.name ?? ""))));
      if (!has) {
        const top = services
          .map((s) => ({
            name: String(s?.name ?? ""),
            price: Number(s?.price ?? 0),
            duration_minutes: Number(s?.duration_minutes ?? 0),
          }))
          .filter((s) => s.name);
        const reply =
          `Não temos *${asked}* aqui 😅\n\n` +
          `Mas a gente faz:\n` +
          `${formatTopServicesForWhatsapp(top, 4)}\n\n` +
          `Gostaria de agendar um horário ou ver outras opções?`;
        if (persistAssistantMessages) {
          await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
            conversationId,
            reply,
          ]);
        }
        return withDebug({ reply });
      }
    }
  }

  // 3.1) If user says "qualquer um" (or "sim" after options), assume no preference and advance when we already have date+time.
  const userSaidNoPreference = /(qualquer um|tanto faz|pode ser qualquer)/i.test(lastUserText);
  const userIsAffirmativeOnly = isClientConfirmation(lastUserText);
  const assistantAskedPreference = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(qual .*você prefere|qual .*prefere|prefere qual|quer qual)/i.test(t);
    }
    return false;
  })();

  const assistantAskedGenericBarberPreference = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(prefer[eê]ncia\s+por\s+barbeiro|tem\s+prefer[eê]ncia\s+por\s+barbeiro|qual\s+barbeiro\s+você\s+prefere|qual\s+barbeiro\s+prefere)/i.test(
        t
      );
    }
    return false;
  })();

  const assistantAskedNameEarly = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      return assistantMessageAskedForName(String(m.content ?? ""));
    }
    return false;
  })();

  // Minimal flow (example.txt): on availability ask for barber preference first.
  if (
    !assistantAskedGenericBarberPreference &&
    !assistantAskedNameEarly &&
    !desired.desiredTime &&
    !/\bamanh/i.test(lastUserText) &&
    !/\bhoje\b/i.test(lastUserText) &&
    /(hor[aá]rio|tem hor[aá]rio|dispon[ií]vel|vaga)/i.test(lastUserText) &&
    inferServiceKeyword(lastUserTextRaw) != null
  ) {
    // A message can name several distinct services at once ("corte, barba e
    // sobrancelha") — record all of them in the draft (service_ids/create_appointment
    // already support N services) and acknowledge the full list, instead of silently
    // keeping only one and asking for barber preference as if nothing else was said.
    const multiServices = resolveMultipleServicesFromText(lastUserTextRaw, catalogServices);
    if (multiServices.length >= 2 && !bookingDraft.service_ids?.length) {
      bookingDraft = mergeBookingDraft(bookingDraft, {
        service_ids: multiServices.map((s) => s.id),
        service_name: multiServices.map((s) => s.name).join(" + "),
      });
      await saveBookingDraft(conversationId, bookingDraft);
    }
    const reply = "Claro! Tem preferência por barbeiro?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return withDebug({ reply });
  }

  // If user says "qualquer um" after we asked barber preference, propose 2 concrete slots (no bullets).
  if (
    (userSaidNoPreference || userIsAffirmativeOnly) &&
    assistantAskedGenericBarberPreference &&
    !desired.desiredTime
  ) {
    const picked = pickServiceFromCatalog(
      normalizeLoose(lastUserTextRaw + " " + lastN.map((m) => String(m.content ?? "")).join(" ")),
      catalogServices,
    );
    if (picked && typeof picked.id === "string") {
      const nextArgs = {
        date: dateOnlyStr,
        service_id: String(picked.id),
        after_time: currentTimeHHmm,
        limit: 8,
      };
      const slots = (await aiTools.getNextSlots(effectiveBarbershopId, nextArgs)) as {
        slots?: Array<{ time?: string; barber_name?: string }>;
      };
      if (persistAssistantMessages) {
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
           VALUES ($1, 'tool', 'get_next_slots', $2, $3)`,
          [conversationId, nextArgs, JSON.stringify(slots).slice(0, 4096)]
        );
      }
      const allSlots: Array<{ time: string; barber_name?: string }> = Array.isArray(slots?.slots)
        ? slots.slots.filter(
            (s): s is { time: string; barber_name?: string } => typeof s?.time === "string" && !!s.time
          )
        : [];
      const wantsAfternoon = /\btarde\b|pela\s+tarde/i.test(lastUserText);
      const wantsMorning = /\bmanh[aã]\b|pela\s+manh/i.test(lastUserText);
      const picked2 = wantsAfternoon ? pickAfternoon(allSlots) : wantsMorning ? pickMorning(allSlots) : pickMorningAfternoon(allSlots);
      const reply = picked2.length
        ? formatSlotSuggestion(picked2, "hoje")
        : "Hoje tá bem corrido 😅 Posso te colocar na lista de espera pra hoje ou já ver o primeiro horário de amanhã. O que prefere?";
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return withDebug({ reply });
    }
  }

  if ((userSaidNoPreference || (userIsAffirmativeOnly && assistantAskedPreference)) && desired.desiredDate && desired.desiredTime) {
    const historyUserText = normalizeLoose(
      lastN
        .filter((m) => m.role === "user")
        .map((m) => String(m.content ?? ""))
        .join(" ")
    );
    // Use catalogServices (already typed CatalogService[]) to pick the service
    const pickedService =
      catalogServices.find((s) => {
        const n = normalizeLoose(s.name ?? "");
        if (!n) return false;
        if (historyUserText.includes(n)) return true;
        if (n === "corte barba" && (historyUserText.includes("corte e barba") || historyUserText.includes("corte barba"))) return true;
        return false;
      }) ??
      pickServiceFromCatalog(historyUserText, catalogServices);

    if (pickedService) {
      const checkArgs = {
        date: desired.desiredDate,
        time: desired.desiredTime,
        service_id: String(pickedService.id),
        after_time: desired.desiredDate === dateOnlyStr ? currentTimeHHmm : undefined,
      };
      const availability = (await aiTools.checkAvailability(effectiveBarbershopId, checkArgs)) as Record<string, unknown>;
      if (persistAssistantMessages) {
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
           VALUES ($1, 'tool', 'check_availability', $2, $3)`,
          [conversationId, checkArgs, JSON.stringify(availability).slice(0, 4096)]
        );
      }

      const requested = availability["requested"] as
        | { available?: boolean; barbers?: Array<{ barber_id?: string; barber_name?: string }> }
        | undefined;
      const barbers = Array.isArray(requested?.barbers) ? requested?.barbers ?? [] : [];
      if (requested?.available === true && barbers.length) {
        const chosen = barbers[0];
        const priceLabel = Number(availability["total_price"] ?? 0).toFixed(2).replace(".", ",");
        const whenLabel = formatResumoWhen(desired.desiredDate, desired.desiredTime, dateOnlyStr);
        const reply =
          `Show, vou te colocar com o *${chosen.barber_name}* para *${String(pickedService.name ?? "")}* ${whenLabel}. Fica *R$ ${priceLabel}* o total` +
          `[[MSG]]Pra salvar aqui, qual seu nome?`;
        if (persistAssistantMessages) {
          await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
            conversationId,
            reply,
          ]);
        }
        return withDebug({ reply });
      }
    }
    // If we can't resolve service or can't fit, fall back to the model flow.
  }

  // 4) When user asks for times “today” without a specific time, force get_next_slots with after_time.
  if (
    !/\bamanh/i.test(lastUserText) &&
    (/\bhoje\b/i.test(lastUserText) || /\bagora\b/i.test(lastUserText) || /\bmanh[aã]\b/i.test(lastUserText)) &&
    /(hor[aá]rio|tem hor[aá]rio|dispon[ií]vel|vaga)/i.test(lastUserText) &&
    !desired.desiredTime
  ) {
    const servicesUnknown = await aiTools.listServices(effectiveBarbershopId);
    const services = Array.isArray(servicesUnknown) ? (servicesUnknown as Array<Record<string, unknown>>) : [];
    const inferred = inferServiceKeyword(lastUserText);
    const findBy = (needle: string) => { const n = normalizeLoose(needle); return services.find((s) => normalizeLoose(String(s?.name ?? "")).includes(n)); };
    const picked =
      inferred === "combo"
        ? findBy("corte + barba") ?? findBy("corte") ?? services[0]
        : inferred === "barba"
          ? findBy("barba") ?? services[0]
          : inferred === "sobrancelha"
            ? findBy("sobrancelha") ?? services[0]
            : inferred === "corte"
              ? findBy("corte") ?? services[0]
              : null;

    if (!picked) {
      const usual =
        clientMemory?.preferred_services?.length && clientMemory.preferred_services_conf >= 0.35
          ? clientMemory.preferred_services.join(" + ")
          : undefined;
      const reply = composeAskService({ usualName: usual, formal: looksLikeFormalMessage(lastUserTextRaw) });
      if (persistAssistantMessages) {
        await persistReplyIfNeeded(reply);
      }
      return withDebug({ reply });
    }

    const nextArgs = {
      date: dateOnlyStr,
      service_id: String(picked.id),
      after_time: currentTimeHHmm,
      limit: 8,
    };
    const slots = (await aiTools.getNextSlots(effectiveBarbershopId, nextArgs)) as {
      slots?: Array<{ time?: string; barber_name?: string }>;
    };
    if (persistAssistantMessages) {
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'get_next_slots', $2, $3)`,
        [conversationId, nextArgs, JSON.stringify(slots).slice(0, 4096)]
      );
    }

    const allSlots: Array<{ time: string; barber_name?: string }> = Array.isArray(slots?.slots)
      ? slots.slots.filter(
          (s): s is { time: string; barber_name?: string } => typeof s?.time === "string" && !!s.time
        )
      : [];

    if (allSlots.length) {
      const wantsAfternoon = /\btarde\b|pela\s+tarde/i.test(lastUserText);
      const wantsMorning = /\bmanh[aã]\b|pela\s+manh/i.test(lastUserText);
      const picked2 = wantsAfternoon ? pickAfternoon(allSlots) : wantsMorning ? pickMorning(allSlots) : pickMorningAfternoon(allSlots);
      const reply = formatSlotSuggestion(picked2, "hoje");
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return withDebug({ reply });
    }

    const reply = "Hoje já tá bem corrido por aqui 😅 Posso te colocar na lista de espera pra hoje ou já ver o primeiro horário de amanhã. O que prefere?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return withDebug({ reply });
  }

  // 5) "Primeiro horário amanhã" should always be computed (never guessed).
  if (
    /\bamanh/i.test(lastUserText) &&
    /(primeiro|1o|primeira)\s+hor[aá]rio/i.test(lastUserText) &&
    !desired.desiredTime
  ) {
    const picked = pickServiceFromCatalog(lastUserText, catalogServices);

    if (!picked) {
      const usual =
        clientMemory?.preferred_services?.length && clientMemory.preferred_services_conf >= 0.35
          ? clientMemory.preferred_services.join(" + ")
          : undefined;
      const reply = composeAskService({ usualName: usual, formal: looksLikeFormalMessage(lastUserTextRaw) });
      if (persistAssistantMessages) {
        await persistReplyIfNeeded(reply);
      }
      return withDebug({ reply });
    }

    const nextArgs = {
      date: tomorrowOnlyStr,
      service_id: String(picked.id),
      limit: 4,
    };
    const slots = (await aiTools.getNextSlots(effectiveBarbershopId, nextArgs)) as {
      slots?: Array<{ time?: string; barber_name?: string }>;
    };
    if (persistAssistantMessages) {
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'get_next_slots', $2, $3)`,
        [conversationId, nextArgs, JSON.stringify(slots).slice(0, 4096)]
      );
    }
    const tomorrowSlots: Array<{ time: string; barber_name?: string }> = Array.isArray(slots?.slots)
      ? slots.slots.filter(
          (s): s is { time: string; barber_name?: string } => typeof s?.time === "string" && !!s.time
        )
      : [];
    const reply = tomorrowSlots.length
      ? formatSlotSuggestion(pickMorningAfternoon(tomorrowSlots), "amanhã")
      : "Amanhã tá bem cheio 😅 Quer tentar outro dia?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return withDebug({ reply });
  }

  // 6) Deterministic "slot pick" handler (real-world failure hardening)
  // When the user selects a time after we suggested slots, do NOT fall back to the model:
  // verify availability and proceed (ask name or create appointment if we already have it).
  {
    const lastAssistantTextRaw = ([...lastN].reverse().find((m) => m.role === "assistant")?.content ?? "").trim();
    const pickedTime = extractTimeFromText(lastUserTextRaw);
    const textNorm = normalizeLoose(lastUserTextRaw);
    const historyNorm = normalizeLoose(
      lastN
        .map((m) => String(m.content ?? ""))
        .join(" ")
    );

    const mentionsBookingContext =
      /\b(tenho|opç(ão|oes)|hor[aá]rios?\s+dispon[ií]veis|qual\s+(hor[aá]rio|desses\s+hor[aá]rios?)\s+você\s+prefere)\b/i.test(
        lastAssistantTextRaw
      ) ||
      /\bquer\s+esse\s+hor[aá]rio\b/i.test(lastAssistantTextRaw) ||
      (!!pickedTime && !!extractedName && inferServiceKeyword(lastUserTextRaw) != null);

    if (pickedTime && mentionsBookingContext && !looksLikeAfterTimeIntent(lastUserTextRaw)) {
      const resolved = resolveServiceFromText(lastUserTextRaw, catalogServices);
      if (resolved.ambiguous && !bookingDraft.service_ids?.length) {
        const reply = composeAmbiguousCorte({
          simpleName: resolved.ambiguous.simple.name,
          comboName: resolved.ambiguous.combo.name,
        });
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      const draftService = bookingDraft.service_ids?.[0]
        ? catalogServices.find((s) => s.id === bookingDraft.service_ids![0])
        : undefined;
      const pickedService: CatalogService | undefined =
        resolved.match ?? draftService;

      if (!pickedService || typeof pickedService.id !== "string") {
        const memHint =
          clientMemory?.preferred_services?.length && clientMemory.preferred_services_conf >= 0.35
            ? `O de sempre, *${clientMemory.preferred_services.join(" + ")}*? `
            : "";
        const reply = `${memHint}Qual serviço deseja?`;
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }

      if (pickedService && typeof pickedService.id === "string") {
        const barbers = Array.isArray(catalogBarbersRaw) ? (catalogBarbersRaw as Array<Record<string, unknown>>) : [];
        const barberByText = barbers.find((b) => {
          const n = normalizeLoose(String(b?.name ?? ""));
          return n && (textNorm.includes(n) || normalizeLoose(lastAssistantTextRaw).includes(n));
        });

        const date =
          resolveBookingDate() ||
          (/\bamanh/i.test(lastUserTextRaw) || /\bamanh/i.test(lastAssistantTextRaw) ? tomorrowOnlyStr : dateOnlyStr);

        const checkArgs = {
          date,
          time: pickedTime,
          service_ids: bookingDraft.service_ids?.length
            ? bookingDraft.service_ids
            : [String(pickedService.id)],
          barber_id: bookingDraft.barber_id || (barberByText && typeof barberByText.id === "string" ? String(barberByText.id) : undefined),
          after_time: date === dateOnlyStr ? currentTimeHHmm : undefined,
        };
        const availability = (await aiTools.checkAvailability(effectiveBarbershopId, checkArgs)) as Record<string, unknown>;
        const snap = snapshotCheckAvailability(availability, checkArgs.barber_id || bookingDraft.barber_id);
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
           VALUES ($1, 'tool', 'check_availability', $2, $3)`,
          [conversationId, JSON.stringify(checkArgs), JSON.stringify(availability).slice(0, 8192)],
        );

        if (snap?.available) {
          bookingDraft = mergeBookingDraft(bookingDraft, {
            ...draftPatchFromSnap(snap),
            status: clientName ? "offered" : "awaiting_name",
          });
          await saveBookingDraft(conversationId, bookingDraft);
          const reply = withBarberSubstitutionDisclosure(
            composeAvailableSlotConfirm({
              serviceName: snap.serviceName || bookingDraft.service_name || String(pickedService["name"] ?? "serviço"),
              barberName: snap.barberName || bookingDraft.barber_name || "barbeiro",
              dateIso: snap.date,
              timeHHmm: snap.time,
              totalPrice: snap.totalPrice,
              timeZone,
              firstName: clientName ? firstNameFromClientName(clientName) : undefined,
              todayIso: dateOnlyStr,
            }),
            lastUserTextRaw,
            catalogBarbers,
            snap.barberName || bookingDraft.barber_name || "barbeiro",
          );
          await persistReplyIfNeeded(reply);
          return withDebug({ reply });
        }
        if (snap) {
          bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), status: "collecting" });
          await saveBookingDraft(conversationId, bookingDraft);
          const occupied = occupiedCopyFromSnap(
            {
              ...snap,
              barberName: snap.barberName || bookingDraft.barber_name || "",
              barberId: snap.barberId || bookingDraft.barber_id || "",
            },
            dateOnlyStr,
          );
          await persistReplyIfNeeded(occupied);
          return withDebug({ reply: occupied });
        }
      }
    }
  }

  const isAffirmativeOnly = isClientConfirmation(lastUserText);

  {
    const offeredClock = offeredFitClockIfAccepted({
      lastAssistant: lastAssistantTurnText(lastN),
      lastUser: lastUserTextRaw,
    });
    if (
      offeredClock &&
      (bookingDraft.service_ids?.length ?? 0) > 0 &&
      (desired.desiredDate || bookingDraft.date)
    ) {
      // BUG-2 fix: if the last assistant message was an alt-barber offer, update the draft
      // before checking availability so we don't loop back to the same (occupied) barber.
      const lastAssistantForOffer = lastAssistantTurnText(lastN);
      const altBarberCatalog = catalogBarbers;
      const offeredAltBarber = offeredAltBarberFromText(lastAssistantForOffer, altBarberCatalog);
      if (offeredAltBarber) {
        bookingDraft = mergeBookingDraft(bookingDraft, {
          barber_id: offeredAltBarber.id,
          barber_name: offeredAltBarber.name,
        });
        await saveBookingDraft(conversationId, bookingDraft);
      }
      // BUG-3 fix: explicit current-turn date beats stale draft date
      const date = resolveBookingDate() ?? desired.desiredDate!;
      const checkArgs = {
        date,
        time: offeredClock,
        barber_id: bookingDraft.barber_id,
        service_ids: bookingDraft.service_ids,
        after_time: date === dateOnlyStr ? currentTimeHHmm : undefined,
      };
      const availability = (await aiTools.checkAvailability(effectiveBarbershopId, checkArgs)) as Record<
        string,
        unknown
      >;
      const snap = snapshotCheckAvailability(availability, bookingDraft.barber_id);
      await pool.query(
        `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
         VALUES ($1, 'tool', 'check_availability', $2, $3)`,
        [conversationId, JSON.stringify(checkArgs), JSON.stringify(availability).slice(0, 8192)],
      );
      if (snap?.available) {
        bookingDraft = mergeBookingDraft(bookingDraft, {
          ...draftPatchFromSnap(snap),
          status: clientName ? "offered" : "awaiting_name",
        });
        await saveBookingDraft(conversationId, bookingDraft);
        const reply = withBarberSubstitutionDisclosure(
          composeAvailableSlotConfirm({
            serviceName: snap.serviceName || bookingDraft.service_name || "serviço",
            barberName: snap.barberName || bookingDraft.barber_name || "barbeiro",
            dateIso: snap.date,
            timeHHmm: snap.time,
            totalPrice: snap.totalPrice,
            timeZone,
            firstName: clientName ? firstNameFromClientName(clientName) : undefined,
            todayIso: dateOnlyStr,
          }),
          lastUserTextRaw,
          catalogBarbers,
          snap.barberName || bookingDraft.barber_name || "barbeiro",
        );
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      if (snap) {
        bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), status: "collecting" });
        await saveBookingDraft(conversationId, bookingDraft);
        const occupied = occupiedCopyFromSnap(snap, dateOnlyStr);
        await persistReplyIfNeeded(occupied);
        return withDebug({ reply: occupied });
      }
    }
  }

  const assistantAskedConfirmation = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      if (assistantAskedReminderRsvp(m.content ?? "")) return false;
      return /(fecho assim|confirma|posso fechar|posso confirmar|t[aá] tudo certo|pode prosseguir|posso prosseguir|confirma pra mim)/i.test(t);
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

  {
    const lastAssistantPref = [...lastN].reverse().find((m) => m.role === "assistant")?.content ?? "";
    if (assistantAskedBarberPreference(lastAssistantPref)) {
      const catalog = catalogBarbers;
      if (prefersNamedBarberOverTime(lastUserTextRaw)) {
        const named =
          resolveBarberFromText(lastUserTextRaw, catalog) ??
          resolveBarberFromText(lastAssistantPref, catalog) ??
          (bookingDraft.barber_id
            ? catalog.find((b) => b.id === bookingDraft.barber_id)
            : undefined);
        if (named) {
          await setExplicitPreferredBarberByPhone(effectiveBarbershopId, clientPhone, named.id);
          const date = resolveBookingDate();
          bookingDraft = mergeBookingDraft(bookingDraft, {
            barber_id: named.id,
            barber_name: named.name,
            ...(date ? { date } : {}),
            status: "collecting",
          });
          await saveBookingDraft(conversationId, bookingDraft);
          const serviceIds = bookingDraft.service_ids;
          if (date && serviceIds?.length) {
            const slots = (await aiTools.getNextSlots(effectiveBarbershopId, {
              date,
              service_ids: serviceIds,
              barber_id: named.id,
              after_time: bookingDraft.after_time,
              limit: 4,
            })) as { slots?: Array<{ time?: string; barber_name?: string }> };
            const times = (slots.slots ?? [])
              .map((s) => (typeof s.time === "string" ? s.time.slice(0, 5) : ""))
              .filter((t) => /^\d{2}:\d{2}$/.test(t))
              .slice(0, 2);
            const first = named.name.trim().split(/\s+/)[0] ?? named.name;
            const reply = times.length
              ? `Tenho às ${times.map((t) => `*${formatTimePt(t)}*`).join(" ou às ")} com o ${first}. Qual prefere?`
              : `Qual outro dia ou horário te atende com o ${first}?`;
            await persistReplyIfNeeded(reply);
            return withDebug({ reply });
          }
        }
      } else if (
        (isAffirmativeOnly || acceptsOfferedDay(lastUserTextRaw)) &&
        assistantOfferedAltBarberSlot(lastAssistantPref)
      ) {
        const alt = offeredAltBarberFromText(lastAssistantPref, catalog);
        const clock = parseClientTime(lastAssistantPref);
        const date = resolveBookingDate();
        if (alt && clock && date && (bookingDraft.service_ids?.length ?? 0) > 0) {
          await setExplicitPreferredBarberByPhone(effectiveBarbershopId, clientPhone, alt.id);
          bookingDraft = mergeBookingDraft(bookingDraft, {
            barber_id: alt.id,
            barber_name: alt.name,
            date,
            time: clock,
            status: "collecting",
          });
          await saveBookingDraft(conversationId, bookingDraft);
          const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
            date,
            time: clock,
            barber_id: alt.id,
            service_ids: bookingDraft.service_ids,
          });
          const snap = snapshotCheckAvailability(checked, alt.id);
          await pool.query(
            `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
             VALUES ($1, 'tool', 'check_availability', $2, $3)`,
            [
              conversationId,
              JSON.stringify({ date, time: clock, barber_id: alt.id, service_ids: bookingDraft.service_ids }),
              JSON.stringify(checked).slice(0, 8192),
            ],
          );
          if (snap?.available && bookingDraft.appointment_id && clientName && snap.barberId) {
            const moved = (await aiTools.rescheduleAppointmentByAgent(
              effectiveBarbershopId,
              bookingDraft.appointment_id,
              clientPhone,
              { date: snap.date, time: snap.time, barber_id: snap.barberId },
              conversationId,
            )) as { ok?: boolean };
            await pool.query(
              `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
               VALUES ($1, 'tool', 'reschedule_appointment', $2, $3)`,
              [
                conversationId,
                JSON.stringify({ appointment_id: bookingDraft.appointment_id, date: snap.date, time: snap.time }),
                JSON.stringify(moved ?? {}).slice(0, 500),
              ],
            ).catch(() => {});
            if (moved?.ok === true) {
              const fn = firstNameFromClientName(clientName);
              const reply = `Pronto, ${fn}! Seu horário ficou na ${weekdayShortPtFromIso(snap.date)} às ${formatTimePt(snap.time)} com o ${snap.barberName || alt.name}.`;
              bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed", appointment_id: bookingDraft.appointment_id });
              await saveBookingDraft(conversationId, bookingDraft);
              await persistReplyIfNeeded(reply);
              updateClientMemoryFromAppointmentEvent({
                eventType: "appointment_rescheduled",
                barbershopId: effectiveBarbershopId,
                clientPhone,
                barberId: snap.barberId,
              }).catch(() => {});
              return withDebug({ reply, state: "appointment_rescheduled" });
            }
          }
          if (snap?.available) {
            bookingDraft = lockOfferedSlot(bookingDraft, {
              date: snap.date,
              time: snap.time,
              barber_id: snap.barberId || alt.id,
              barber_name: snap.barberName || alt.name,
              status: clientName ? "offered" : "awaiting_name",
            });
            await saveBookingDraft(conversationId, bookingDraft);
            const reply = withBarberSubstitutionDisclosure(
              composeAvailableSlotConfirm({
                serviceName: snap.serviceName || bookingDraft.service_name || "serviço",
                barberName: snap.barberName || alt.name,
                dateIso: snap.date,
                timeHHmm: snap.time,
                totalPrice: snap.totalPrice,
                timeZone,
                firstName: clientName ? firstNameFromClientName(clientName) : undefined,
                todayIso: dateOnlyStr,
              }),
              lastUserTextRaw,
              catalogBarbers,
              snap.barberName || alt.name,
            );
            await persistReplyIfNeeded(reply);
            return withDebug({ reply });
          }
          if (snap) {
            const occupied = occupiedCopyFromSnap(snap, dateOnlyStr);
            await persistReplyIfNeeded(occupied);
            return withDebug({ reply: occupied });
          }
        }
      } else if (isAffirmativeOnly || acceptsOfferedDay(lastUserTextRaw)) {
        await setExplicitPreferredBarberByPhone(effectiveBarbershopId, clientPhone, null);
      } else if (acceptsAnyBarber(lastUserTextRaw)) {
        await setExplicitPreferredBarberByPhone(effectiveBarbershopId, clientPhone, null);
      }
    }
  }

  const isLikelyNameOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    if (t.length < 2 || t.length > 40) return false;
    // avoid treating affirmations as names
    if (isAffirmativeOnly) return false;
    if (isGreetingOnly) return false;
    // mostly letters/spaces (allow accents)
    return /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(t) && t.split(" ").filter(Boolean).length <= 4;
  })();

  if (isLikelyNameOnly && /qual outro hor[aá]rio te atende/i.test(lastAssistantTurnText(lastN))) {
    const who = lastUserTextRaw.trim().split(/\s+/)[0] ?? "";
    const reply = `${who}, anotei seu nome. Me diz outro horário, ou prefere amanhã?`;
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  /** Nome explícito ("me chamo X") ou apenas o nome após pedido (ex.: "Mateus"). */
  const nameFromUserForBooking = (() => {
    if (acceptsAnyBarber(lastUserTextRaw)) return "";
    const raw = extractedName ?? (isLikelyNameOnly && lastUserText.trim() ? lastUserText.trim() : "");
    if (!raw) return "";
    return aiTools.formatStoredClientName(raw) ?? raw;
  })();

  // Reagendar: um resumo + sim → UPDATE. Nunca cancelar e criar de novo.
  if (
    looksLikeRescheduleIntent(lastUserText) &&
    upcomingAppointments.length > 0 &&
    desired.desiredDate &&
    desired.desiredTime &&
    !isAffirmativeOnly
  ) {
    const next = upcomingAppointments[0];
    const serviceIds = (next.service_ids ?? []).filter((id) => isValidUuid(id));
    // RC2 fix: if the current turn named a different barber (bookingDraft.barber_id was
    // just set by applyTurnToDraft from this turn's text), check THAT barber's
    // availability — not the barber of the appointment being rescheduled. Without this,
    // "reagendar para 18:30 com o Lucas" checked Eduardo's (the old barber's) calendar,
    // producing a reply about a barber/slot the client never asked about.
    const requestedBarberId = bookingDraft.barber_id || next.barber_id;
    if (serviceIds.length > 0) {
      const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
        date: desired.desiredDate,
        time: desired.desiredTime,
        barber_id: requestedBarberId,
        service_ids: serviceIds,
      });
      const snap = snapshotCheckAvailability(checked, requestedBarberId);
      if (snap?.available) {
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
           VALUES ($1, 'tool', 'check_availability', $2, $3)`,
          [
            conversationId,
            JSON.stringify({
              date: snap.date,
              time: snap.time,
              barber_id: snap.barberId,
              service_ids: snap.serviceIds,
            }),
            JSON.stringify(checked).slice(0, 8192),
          ],
        );
        const reply = withBarberSubstitutionDisclosure(
          composeAvailableSlotConfirm({
            serviceName: snap.serviceName || next.service_names,
            barberName: snap.barberName || next.barber_name,
            dateIso: snap.date,
            timeHHmm: snap.time,
            totalPrice: snap.totalPrice,
            timeZone,
            firstName: clientName ? firstNameFromClientName(clientName) : undefined,
            todayIso: dateOnlyStr,
          }),
          lastUserTextRaw,
          catalogBarbers,
          snap.barberName || next.barber_name,
        );
        bookingDraft = mergeBookingDraft(bookingDraft, {
          ...draftPatchFromSnap(snap),
          appointment_id: next.id,
          status: clientName ? "offered" : "awaiting_name",
        });
        await saveBookingDraft(conversationId, bookingDraft);
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      const occupied = snap ? occupiedCopyFromSnap(snap, dateOnlyStr) : "Esse horário não está disponível. Posso ver outro dia ou horário?";
      if (snap) {
        bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), appointment_id: next.id, status: "collecting" });
        await saveBookingDraft(conversationId, bookingDraft);
      }
      await persistReplyIfNeeded(occupied);
      return withDebug({ reply: occupied });
    }
  }

  const slotTimeUpdate = parseClientTime(lastUserTextRaw);
  if (
    slotTimeUpdate &&
    !isAffirmativeOnly &&
    !looksLikeConsultIntent(lastUserText) &&
    !looksLikeRescheduleIntent(lastUserText) &&
    (bookingDraft.service_ids?.length ?? 0) > 0 &&
    (bookingDraft.barber_id || bookingDraft.appointment_id) &&
    (desired.desiredDate || bookingDraft.date)
  ) {
    // BUG-3 fix: explicit current-turn date beats stale draft date
    const date = resolveBookingDate() ?? bookingDraft.date!;

    // Round 4: "após as X" / "depois das X" — intent is "from X onwards", not exactly X
    if (looksLikeAfterTimeIntent(lastUserTextRaw)) {
      const slotsAfter = (await aiTools.getNextSlots(effectiveBarbershopId, {
        date,
        service_ids: bookingDraft.service_ids,
        barber_id: bookingDraft.barber_id,
        after_time: slotTimeUpdate,
        limit: 4,
      })) as { slots?: Array<{ time?: string; barber_name?: string }> };
      const allSlots = (slotsAfter?.slots ?? []).filter((s) => typeof s?.time === "string");
      if (allSlots.length > 0) {
        const picked = allSlots[0]!;
        const pickedTime = String(picked.time ?? "").slice(0, 5);
        const dayLabel = date === dateOnlyStr ? "hoje" : "amanhã";
        const reply = `Tenho às *${formatTimePt(pickedTime)}* (${dayLabel}) com o ${picked.barber_name || bookingDraft.barber_name || "barbeiro"}[[MSG]]Fica bom pra você?`;
        await persistReplyIfNeeded(reply);
        return withDebug({ reply });
      }
      // fallthrough to check_availability if no slots found
    }

    const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
      date,
      time: slotTimeUpdate,
      barber_id: bookingDraft.barber_id,
      service_ids: bookingDraft.service_ids,
    });
    const snap = snapshotCheckAvailability(checked, bookingDraft.barber_id);
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
       VALUES ($1, 'tool', 'check_availability', $2, $3)`,
      [
        conversationId,
        JSON.stringify({
          date,
          time: slotTimeUpdate,
          barber_id: bookingDraft.barber_id,
          service_ids: bookingDraft.service_ids,
        }),
        JSON.stringify(checked).slice(0, 8192),
      ],
    );
    if (snap?.available) {
      bookingDraft = mergeBookingDraft(bookingDraft, {
        ...draftPatchFromSnap(snap),
        status: clientName ? "offered" : "awaiting_name",
      });
      await saveBookingDraft(conversationId, bookingDraft);
      const reply = withBarberSubstitutionDisclosure(
        composeAvailableSlotConfirm({
          serviceName: snap.serviceName || bookingDraft.service_name || "serviço",
          barberName: snap.barberName || bookingDraft.barber_name || "barbeiro",
          dateIso: snap.date,
          timeHHmm: snap.time,
          totalPrice: snap.totalPrice,
          timeZone,
          firstName: clientName ? firstNameFromClientName(clientName) : undefined,
          todayIso: dateOnlyStr,
        }),
        lastUserTextRaw,
        catalogBarbers,
        snap.barberName || bookingDraft.barber_name || "barbeiro",
      );
      await persistReplyIfNeeded(reply);
      return withDebug({ reply });
    }
    if (snap) {
      bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), status: "collecting" });
      await saveBookingDraft(conversationId, bookingDraft);
      const occupied = occupiedCopyFromSnap(snap, dateOnlyStr);
      await persistReplyIfNeeded(occupied);
      return withDebug({ reply: occupied });
    }
  }

  // Happy-path: cliente confirmou o rascunho offered (sim) ou enviou o nome pedido.
  const bookingName = (nameFromUserForBooking || clientName || "").trim();
  const hasUsableBookingName = isUsableClientName(bookingName);
  // Guard: when the client is responding to a reminder RSVP (pending appointment + affirmative),
  // never let a stale "offered" draft override the RSVP path.
  const pendingRsvpGuard = isAffirmativeOnly && upcomingBooked === "pending";
  const shouldCloseFromDraft =
    !pendingRsvpGuard &&
    hasUsableBookingName &&
    ((Boolean(nameFromUserForBooking) &&
      (assistantAskedName ||
        bookingDraft.status === "awaiting_name" ||
        (assistantAskedConfirmation && !resolveBarberFromText(lastUserTextRaw, catalogBarbers)))) ||
      (isAffirmativeOnly && (assistantAskedConfirmation || draftIsCloseable(bookingDraft))));
  if (shouldCloseFromDraft && draftIsCloseable(bookingDraft)) {
    const checked = await aiTools.checkAvailability(effectiveBarbershopId, {
      date: bookingDraft.date!,
      time: bookingDraft.time!,
      barber_id: bookingDraft.barber_id,
      service_ids: bookingDraft.service_ids,
    });
    const snap = snapshotCheckAvailability(checked, bookingDraft.barber_id);
    if (snap?.available && snap.barberId && snap.serviceIds.length > 0 && snap.date && snap.time) {
      const existingId = bookingDraft.appointment_id;
      if (existingId) {
        const moved = (await aiTools.rescheduleAppointmentByAgent(
          effectiveBarbershopId,
          existingId,
          clientPhone,
          { date: snap.date, time: snap.time, barber_id: snap.barberId },
          conversationId,
        )) as { ok?: boolean };
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
           VALUES ($1, 'tool', 'reschedule_appointment', $2, $3)`,
          [
            conversationId,
            JSON.stringify({ appointment_id: existingId, date: snap.date, time: snap.time, barber_id: snap.barberId }),
            JSON.stringify(moved ?? {}).slice(0, 500),
          ],
        ).catch(() => {});
        if (moved?.ok === true) {
          bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed", appointment_id: existingId });
          await saveBookingDraft(conversationId, bookingDraft);
          const fn = firstNameFromClientName(bookingName);
          const weekdayShort = weekdayShortPtFromIso(snap.date);
          const timePt = formatTimePt(snap.time);
          const reply = fn
            ? `Pronto, ${fn}! Seu ${snap.serviceName || bookingDraft.service_name || ""} com o ${snap.barberName || bookingDraft.barber_name || ""} ficou na ${weekdayShort} às ${timePt}. Te esperamos lá.`
            : `Pronto! Ficou na ${weekdayShort} às ${timePt}. Te esperamos lá.`;
          await persistReplyIfNeeded(reply);
          updateClientMemoryFromAppointmentEvent({
            eventType: "appointment_rescheduled",
            barbershopId: effectiveBarbershopId,
            clientPhone,
            barberId: snap.barberId,
          }).catch(() => {});
          return withDebug({ reply, state: "appointment_rescheduled" });
        }
      } else {
        const created = (await aiTools.createAppointment(effectiveBarbershopId, {
          client_phone: clientPhone,
          client_name: bookingName,
          barber_id: snap.barberId,
          ...(snap.serviceIds.length === 1
            ? { service_id: snap.serviceIds[0] }
            : { service_ids: snap.serviceIds }),
          date: snap.date,
          time: snap.time,
        }, conversationId)) as Record<string, unknown>;

        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
           VALUES ($1, 'tool', 'create_appointment', $2, $3)`,
          [
            conversationId,
            JSON.stringify({ date: snap.date, time: snap.time, barber_id: snap.barberId, service_ids: snap.serviceIds }),
            JSON.stringify(created ?? {}).slice(0, 500),
          ],
        ).catch(() => {});
        if (typeof created?.id === "string" && created.id) {
          bookingDraft = mergeBookingDraft(bookingDraft, { status: "closed" });
          await saveBookingDraft(conversationId, bookingDraft);
          const services = Array.isArray(created.services) ? (created.services as Array<{ name?: string; service_name?: string }>) : [];
          const serviceName =
            services.map((s) => s?.name ?? s?.service_name ?? "").filter(Boolean).join(" + ") || snap.serviceName;
          const totalPrice = Number(snap.totalPrice || created.total_price || created.price || 0);
          const timePt = formatTimePt(snap.time);
          const whenPhrase =
            snap.date === dateOnlyStr
              ? `hoje às ${timePt}`
              : snap.date === tomorrowOnlyStr
                ? `amanhã às ${timePt}`
                : formatResumoWhen(snap.date, snap.time, dateOnlyStr);
          const reply =
            `Agendado, ${bookingName}! ${serviceName} fica R$ ${Number.isFinite(totalPrice) ? totalPrice.toFixed(0) : "0"}. ` +
            `${snap.barberName ? `${snap.barberName} aguarda você` : "Te aguardamos"} ${whenPhrase}.`;
          await persistReplyIfNeeded(reply);
          updateClientMemoryFromAppointmentEvent({
            eventType: "appointment_created",
            barbershopId: effectiveBarbershopId,
            clientPhone,
            barberId: snap.barberId,
            serviceNames: services.map((s) => s?.name ?? s?.service_name ?? "").filter(Boolean),
          }).catch(() => {});
          return withDebug({ reply, state: "appointment_created" });
        }
      }
    } else if (snap) {
      bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(snap), status: "collecting" });
      await saveBookingDraft(conversationId, bookingDraft);
      const occupied = occupiedCopyFromSnap(snap, dateOnlyStr);
      await persistReplyIfNeeded(occupied);
      return withDebug({ reply: occupied });
    }
  }

  if (isAffirmativeOnly && draftIsCloseable(bookingDraft) && !hasUsableBookingName && !pendingRsvpGuard) {
    bookingDraft = mergeBookingDraft(bookingDraft, { status: "awaiting_name" });
    await saveBookingDraft(conversationId, bookingDraft);
    const reply = askClientNameReply();
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
  }

  if (
    looksLikeZeroIntentUnknown(lastUserTextRaw) &&
    !(bookingDraft.service_ids?.length) &&
    bookingDraft.status !== "offered" &&
    bookingDraft.status !== "awaiting_name" &&
    !(upcomingBooked === "pending" && isAffirmativeOnly)
  ) {
    const reply = "Posso não ter entendido. Quer agendar, reagendar ou cancelar?";
    await persistReplyIfNeeded(reply);
    return withDebug({ reply });
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

  // Proactively persist the client name as soon as we detect it was provided.
  // This prevents re-triggering the "FECHAMENTO EM 2 MENSAGENS" block on the
  // next turn (when clientName would otherwise still be empty).
  if (isLikelyNameOnly && assistantAskedName && lastUserText.trim()) {
    aiTools.upsertClient(effectiveBarbershopId, clientPhone, lastUserText.trim()).catch(() => {});
  }

  let recentReminderSent = false;
  const pendingForRsvp = upcomingAppointments.filter((a) => a.status === "pending");
  if (upcomingBooked === "pending" && isAffirmativeOnly && pendingForRsvp.length > 0) {
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

  const lastAssistantForRsvp = [...lastN].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const reminderRsvpTurn =
    isAffirmativeOnly &&
    upcomingBooked === "pending" &&
    !assistantAskedConfirmation &&
    (assistantAskedReminderRsvp(lastAssistantForRsvp) || recentReminderSent);
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
              "Chame get_next_slots com a data correta e limit=1, SEM after_time. " +
              "Use slots[0] como proposta. Não adivinhe nem use check_availability.",
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
  let toolErrorCount = 0;
  let currentBarbershopId = effectiveBarbershopId;
  let lastCheckThisTurn: CheckAvailabilitySnapshot | null = null;

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
      return {
        reply: "Desculpe, não consegui processar. Tente de novo em instantes.",
        usage: totalUsage,
      };
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
            const time = pickExecutedToolTime({
              desiredTime: desired.desiredTime,
              toolTime: tRaw,
            });
            const isToday = date === dateOnlyStr;
            const servicesUnknown = await aiTools.listServices(currentBarbershopId);
            const catalog = catalogFromUnknown(servicesUnknown);
            const named = resolveServiceFromText(lastUserTextRaw, catalog);
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
            const named = resolveServiceFromText(lastUserTextRaw, catalog);
            if (!bookingDraft.service_ids?.length && !named.match) {
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
                  : bookingDraft.service_ids;
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
              barber_id: idKnownToCatalog(args.barber_id, catalogBarbers) ?? bookingDraft.barber_id,
              limit: typeof args.limit === "number" ? args.limit : undefined,
            });
          }
          if (name === "upsert_client")
            return aiTools.upsertClient(
              currentBarbershopId,
              (args.phone as string) ?? "",
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
              (userIsAffirmativeOnly &&
                (assistantAskedConfirmation || assistantAskedName || draftIsCloseable(bookingDraft))) ||
              ((assistantAskedName || bookingDraft.status === "awaiting_name") &&
                (isLikelyNameOnly || Boolean(extractedName)));
            const createName = [args.client_name, bookingName, clientName]
              .map((n) => (typeof n === "string" ? n.trim() : ""))
              .find((n) => isUsableClientName(n));
            if (!bookingConfirmedThisTurn || !draftIsCloseable(bookingDraft) || !createName) {
              if (draftIsCloseable(bookingDraft) && bookingConfirmedThisTurn && !createName) {
                return {
                  deferred: true,
                  reason: "awaiting_client_name",
                  instruction:
                    "Não crie o agendamento neste turno. Peça o nome do cliente com 'Qual é o seu nome?'. Não envie outro resumo nem pergunte 'Posso confirmar?' de novo.",
                };
              }
              return {
                deferred: true,
                reason: "awaiting_client_confirmation",
                instruction:
                  "Não crie o agendamento neste turno. Envie um resumo (serviço, barbeiro, dia da semana, data, hora, valor) e pergunte 'Posso confirmar?'. Só chame create_appointment depois do sim/ok ou do nome pedido no resumo.",
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
          if (name === "list_client_upcoming_appointments")
            return aiTools.listClientUpcomingAppointments(
              currentBarbershopId,
              ((args.client_phone as string) ?? clientPhone) || ""
            );
          if (name === "cancel_appointment") {
            if (assistantAskedConfirmation && !looksLikeCancelIntent(lastUserText)) {
              return {
                error:
                  "Não cancele para reagendar. Use reschedule_appointment com o appointment_id do horário atual.",
              };
            }
            const r = await aiTools.cancelAppointmentByAgent(
              currentBarbershopId,
              (args.appointment_id as string) ?? "",
              ((args.client_phone as string) ?? clientPhone) || "",
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
              ((args.client_phone as string) ?? clientPhone) || "",
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
            if (assistantAskedConfirmation && upcomingAppointments.length > 0) {
              return {
                error:
                  "Cliente confirmou o novo horário. Use reschedule_appointment com o appointment_id atual; não use confirm_appointment.",
              };
            }
            const r = await aiTools.confirmAppointmentByAgent(
              currentBarbershopId,
              (args.appointment_id as string) ?? "",
              ((args.client_phone as string) ?? clientPhone) || "",
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
              ((args.client_phone as string) ?? clientPhone) || "",
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
          if (name === "send_shop_pix") return aiTools.sendShopPix(currentBarbershopId, clientPhone);
          if (name === "update_client_notes")
            return aiTools.updateClientNotes(currentBarbershopId, clientPhone, (args.note as string) ?? "");
          if (name === "add_to_waitlist")
            return aiTools.addToWaitlist(currentBarbershopId, {
              client_phone: ((args.client_phone as string) ?? clientPhone) || "",
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
        // This confirm card is a deterministic template (never LLM-authored), so a
        // prompt-only instruction can't make it disclose a barber substitution —
        // if the client asked for a specific barber who isn't on the roster and we
        // picked someone else, say that first, as its own bubble, before the card.
        reply = withBarberSubstitutionDisclosure(reply, lastUserTextRaw, catalogBarbers, lastCheckThisTurn.barberName);
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
      );
      bookingDraft = mergeBookingDraft(bookingDraft, { ...draftPatchFromSnap(lastCheckThisTurn), status: "collecting" });
      await saveBookingDraft(conversationId, bookingDraft);
    } else if (containsAiExposure(reply)) {
      if (lastCheckThisTurn && !lastCheckThisTurn.available) {
        reply = "Infelizmente não está disponível. Podemos ver outro dia ou horário?";
      } else {
        console.warn("[ai-agent] suppressed AI-exposure reply for handoff, conversationId=%s", conversationId);
        reply = "";
      }
    }
    if (state === "appointment_confirmed" && !lastCheckThisTurn) {
      const next = upcomingAppointments.find((a) => a.status === "pending") ?? upcomingAppointments[0];
      if (next) {
        const fn = clientName ? firstNameFromClientName(clientName) : "";
        const when = formatResumoWhen(String(next.date).slice(0, 10), String(next.time).slice(0, 5), dateOnlyStr);
        const who = next.barber_name ? ` com o ${next.barber_name}` : "";
        reply = fn
          ? `Presença confirmada, ${fn}! Te esperamos ${when}${who}.`
          : `Presença confirmada! Te esperamos ${when}${who}.`;
      }
    }
    await persistAssistant(reply);

    // Fire-and-forget: extract conversation signals and update client memory
    updateClientMemoryFromConversation(effectiveBarbershopId, clientPhone, {
      messages: lastN.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
      finalState: state,
    }).catch(() => {});

    return withDebug({ reply, usage: totalUsage, state });
  }

  return withDebug({
    reply:
      "Posso não ter entendido bem. Você gostaria de agendar, reagendar ou cancelar um horário?",
    usage: totalUsage,
    state,
  });
}
