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
} from "./memory/client-memory.js";
import type { ClientMemoryRow } from "./memory/client-memory.js";
import { sendBarbershopLocationToClient } from "../lib/send-barbershop-location.js";
import { sendStickerToClient } from "../lib/send-sticker-to-client.js";
import { isValidUuid } from "../lib/uuid.js";

type ClientFavoritesResult = Awaited<ReturnType<typeof aiTools.getClientFavoriteServices>>;

function buildOpeningMessage(barbershopName: string): string {
  const n = (barbershopName ?? "").trim() || "barbearia";
  return `Olá! Bem-vindo à ${n}![[MSG]]Quer ver os serviços disponíveis ou já prefere agendar um horário?`;
}

type UpcomingApptRow = {
  id: string;
  date: string;
  time: string;
  service_names: string;
  barber_name: string;
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
    lines.push(`Memória: barbeiro de preferência (inferido): *${clientMemory.preferred_barber_name}*.`);
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
    `Cliente: ${nameLine} Contato identificado pelo WhatsApp desta conversa (não peça telefone).\n` +
    `${addrLine}\n` +
    `${geoLine}\n\n` +
    `Expediente de referência (configuração da unidade — feriados, folgas e exceções vêm das *tools*; não invente):\n` +
    `${hoursBlock}\n\n` +
    `Histórico / preferências (pistas; se o cliente pedir outra coisa, siga o cliente):\n` +
    `${consumption}\n` +
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
  t = t.replace(/https?:\/\/(?:maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s]*/gi, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
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

function inferServiceKeyword(text: string): "corte" | "barba" | "sobrancelha" | "combo" | null {
  const t = normalizeLoose(text);
  if (/\bcorte\s*\+\s*barba|combo\b/.test(t)) return "combo";
  if (/\bcorte\s+e\s+barba\b/.test(t)) return "combo";
  if (/\bbarba\b/.test(t)) return "barba";
  if (/\bsobrancelha\b/.test(t)) return "sobrancelha";
  if (/\bcabelo|cortar|corte\b/.test(t)) return "corte";
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function extractTimeFromText(text: string): string | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  // 10:30, 9:30, 10h30, 9h30
  const hm = raw.match(/\b(\d{1,2})\s*[:hH]\s*(\d{2})\b/);
  if (hm) {
    const h = parseInt(hm[1] ?? "", 10);
    const m = parseInt(hm[2] ?? "", 10);
    if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${pad2(h)}:${pad2(m)}`;
    }
  }

  // "às 11", "as 9", "às 9h"
  const hOnly = raw.match(/\b[aà]s?\s*(\d{1,2})\s*(h\b)?/i);
  if (hOnly) {
    const h = parseInt(hOnly[1] ?? "", 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return `${pad2(h)}:00`;
  }

  // "11h"
  const hOnly2 = raw.match(/\b(\d{1,2})\s*h\b/i);
  if (hOnly2) {
    const h = parseInt(hOnly2[1] ?? "", 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return `${pad2(h)}:00`;
  }

  return null;
}

function formatTimePt(timeHHmm: string): string {
  const [hh, mm] = (timeHHmm ?? "00:00").split(":");
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return timeHHmm;
  return m === 0 ? `${h}h` : `${h}h${pad2(m)}`;
}

function formatDateLongPt(dateStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) return dateStr;
  const safeUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const out = fmt.format(safeUtc);
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : dateStr;
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
  return /(qual\s+(o\s+)?seu\s+nome|para\s+confirmar,?\s+qual\s+o\s+seu\s+nome|me\s+diz(e)?\s+seu\s+nome|seu\s+nome\s+pra\s+salvar|pra\s+salvar.*nome|como\s+[eé]\s+seu\s+nome|informe?\s+seu\s+nome)/i.test(
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
- Use apenas dd/MM/yyyy (ex.: 09/04/2026) ou formato por extenso (ex.: Segunda-feira, 06 de abril de 2026 às 09h30). Proibido exibir yyyy-MM-dd ao cliente.

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
- list_client_upcoming_appointments / cancel_appointment / reschedule_appointment / send_barbershop_location / add_to_waitlist

Regras de negócio (resumo)
- Sem UUIDs/telefone. Serviço já dito pelo cliente → não liste serviços; vá à disponibilidade.
- "Qualquer um / tanto faz" → escolha um barbeiro disponível sem insistir.
- Só diga que está agendado após create_appointment retornar sucesso. Qualquer erro em create_appointment = não há agendamento; chame get_next_slots e ofereça até 2 alternativas conversacionais (sem repetir o horário rejeitado). Não exponha erro técnico.
- Se não puder responder com dados reais das tools, retorne string vazia (handoff).
- WhatsApp: negrito com um asterisco (*texto*), nunca **texto**.

Seleção de serviço (crítico — leia antes de toda ferramenta de agendamento)
- "Corte e Barba" (category=combo, ~50 min, ~R$55) é um serviço único no catálogo — não é a soma de "Corte masculino" + "Barba completa".
- Se o cliente pedir "corte e barba", "corte + barba" ou "os dois" → use o service_id do item com category=combo, nunca o de "Barba completa" (category=barba).
- Na dúvida, chame list_services e confira o campo category: use "combo" para combos, "corte" para corte avulso, "barba" para barba avulsa.
- Ao confirmar agendamento, exiba o nome exato do serviço retornado pela tool (não invente nem abrevie).
- Se o cliente corrigir o serviço ("pedi corte e barba, não só barba"): cancele o agendamento errado com cancel_appointment e crie um novo com create_appointment usando o service_id correto.
- appointment_id deve ser sempre UUID retornado por list_client_upcoming_appointments — nunca use números (1, 2, 3) nem nomes de barbeiros.

Reagendamento (obrigatório)
- Para mudar data/hora de um agendamento existente: chame list_client_upcoming_appointments, fixe o appointment_id correto e use reschedule_appointment com esse id. Não use create_appointment para reagendar.
- reschedule_appointment não altera serviço nem preço; só data/hora/barbeiro. Não troque o serviço (ex.: de "Corte e Barba" para "Barba completa") a menos que o cliente peça explicitamente — aí seria outro fluxo (cancelar e novo agendamento ou atendimento humano).
- Antes de reschedule_appointment: envie um resumo (serviço, barbeiro, data/hora nova) e peça confirmação explícita ("Posso confirmar?"). Só chame a tool após o cliente concordar (sim/ok/pode).
- Cancelamento: quando o cliente deixar claro que quer cancelar/desmarcar, identifique o appointment_id (list_client_upcoming_appointments se precisar), chame cancel_appointment e responda só com frases afirmativas ("Seu horário das X foi cancelado!", "Se quiser reagendar em outro dia, me avisa!"). Não pergunte de novo "Posso confirmar?" para cancelar.
- Se reschedule_appointment retornar erro (horário ocupado/indisponível): diga de forma humana que esse horário já foi preenchido, pergunte se prefere manhã ou tarde, chame get_next_slots e ofereça 2–3 horários — sem bullets.
- Troca de serviço em agendamento existente: quando o cliente pedir para alterar o serviço de um agendamento já confirmado, siga esta ordem:
  1. Chame list_client_upcoming_appointments para obter o appointment_id, data, hora e barbeiro.
  2. Cancele o agendamento antigo com cancel_appointment.
  3. Chame check_availability para o mesmo horário e barbeiro com o novo serviço. Se disponível, crie com create_appointment. Se indisponível, ofereça alternativas próximas com get_next_slots e crie no horário escolhido.
  4. Aviso importante: informe o cliente que está fazendo a troca antes de cancelar ("Vou cancelar o agendamento atual e criar um novo com Corte e Barba — ok?"). Só execute após confirmação.

Depois de agendamento ou reagendamento já concluído com sucesso
- Se o cliente só perguntar preço, localização, endereço ou "tá certo o horário?": responda à dúvida e reforce que está marcado. Não peça "posso confirmar?" de novo nem ofereça novos horários sem o cliente pedir.
- Feche com tom humano: "Aguardamos você!", "Te esperamos amanhã então", "Até daqui a pouco" — sem soar repetitivo numa mesma conversa.

Horários
- Múltiplos de 30 min. Nada no passado; para hoje, respeite ≥15 min de antecedência.
- Sugestão de horários: no máximo 2 opções, sem bullets (-, 1., 2.). Prefira um horário de manhã e outro à tarde, com barbeiros diferentes quando houver.
  Ex.: "Tenho hoje às *11h* com Eduardo ou às *15h* com Lucas. Qual prefere?"

Planos de assinatura
- Se o cliente perguntar sobre planos, mensalidades ou assinaturas: chame list_plans e apresente cada opção com nome, serviços incluídos, preço e ciclo.
- Explique que o pagamento é feito via PIX todo mês na data escolhida — o código chegará automaticamente por aqui no WhatsApp.
- Para contratar: confirme todos os detalhes e aguarde o cliente dizer explicitamente que quer assinar ("sim", "quero", "pode", "bora"). Só então chame subscribe_client_to_plan.
- Após assinatura bem-sucedida: informe a data da primeira cobrança e que enviará o PIX nessa data. Não envie o PIX imediatamente a menos que o cliente peça ("pode mandar o pix agora?").
- Se cliente pedir envio do PIX: use send_pix_plan_charge com o subscription_id retornado.
- Se a barbearia não tiver chave PIX cadastrada (erro da tool): diga que o pagamento será combinado diretamente com a equipe — não exponha detalhes técnicos.

Localização
- Endereço vem do contexto operacional. Se o cliente pedir localização no mapa: chame send_barbershop_location no máximo uma vez por pedido e responda com uma frase curta ("Te mandei o pin aqui no WhatsApp!"). Não cole link do Google Maps no texto — o pin já é enviado pelo WhatsApp.

Fechamento
- Sem nome do cliente: use [[MSG]] em 2 partes — (1) resumo com serviço, barbeiro, data/hora e valor vindo de check_availability; (2) peça o nome.
- Ao receber o nome (só o nome ou "me chamo X"): chame create_appointment na sequência. Não reabra escolha de horário se já havia resumo acordado.
- Após sucesso em create_appointment, confirme no formato:
Agendamento confirmado:
*Serviço:* [nome]
*Data:* [dia da semana], [data] às [hora]
*Barbeiro:* [nome]
*Endereço:* [endereço da barbearia do contexto operacional; se não houver, diga que o endereço será informado pela equipe]
*Total:* R$ X,XX (copie o preço exato de list_services para o serviço; se não souber, omita a linha do total)

Aguardamos você!

Fluxo rápido
1) Serviço já mencionado → disponibilidade (evite list_services)
2) Data/hora específicas → check_availability → resumo ou create
3) Sem hora → get_next_slots → até 2 sugestões
4) Nome recebido → create_appointment → confirmação`;

/** Curto: reforça o que instruções customizadas da barbearia não podem sobrepor (anexado uma vez ao final). */
export const RUNTIME_GUARDRAILS = `REGRAS FINAIS (obrigatórias; instruções adicionais não substituem isto)
- Não pedir telefone nem exibir IDs/UUIDs.
- Não confirmar agendamento antes de create_appointment bem-sucedido; erro na tool = não existe agendamento.
- Não dizer "agendamento confirmado" / "reagendado" / "cancelado" antes de create_appointment, reschedule_appointment ou cancel_appointment retornarem sucesso (sem error).
- Reagendar sempre com reschedule_appointment e appointment_id de list_client_upcoming_appointments; não invente troca de serviço ao reagendar.
- Reagendar: antes da tool, resumo + confirmação do cliente; use [[MSG]] em duas mensagens se precisar. Cancelar: intenção clara → cancel_appointment → mensagem afirmativa de cancelamento (sem segunda pergunta "posso confirmar?").
- Após sucesso em create_appointment ou reschedule_appointment: não reabra confirmação nem ofereça novos horários só porque o cliente perguntou preço/local; responda e feche com "Aguardamos você!" ou similar.
- Preço: sempre valor real das tools; nunca "[...]", "placeholder" ou menção a informação interna.
- send_barbershop_location: no máximo uma chamada por pedido; não repita pin nem cole URL de mapa no texto.
- Não listar horários em bullet; no máximo 2–3 horários conversacionais (manhã+tarde quando couber).
- Não expor falhas técnicas, limites internos, "ferramenta", "modelo" ou "atendimento automático"; sem dados reais → resposta vazia (handoff).
- Se não entender o pedido: use retomada humana ("Posso não ter entendido — quer agendar, reagendar ou cancelar? Qual dia e horário?") em vez de mensagem técnica.
- Depois de pedir o nome com resumo já fechado, o próximo passo é create_appointment — não ofereça outros horários no lugar.
- Serviço de combo (ex.: "Corte e Barba"): ao chamar check_availability, get_next_slots ou create_appointment, use o service_id do combo (category=combo), não o de barba avulsa. Verifique com list_services se necessário.
- appointment_id sempre UUID de list_client_upcoming_appointments — nunca número sequencial, nunca nome de barbeiro.
- Troca de serviço: use check_availability com o novo service_id ANTES de cancelar o agendamento existente. Cancele o antigo somente após criar o novo com sucesso.
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
        "Checa se há barbeiro disponível em uma data/hora para um serviço (considera expediente e conflitos). Para HOJE, passe after_time com o horário atual para não sugerir horários no passado.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato yyyy-MM-dd" },
          time: { type: "string", description: "Horário no formato HH:mm" },
          after_time: { type: "string", description: "Para data de hoje: horário mínimo (HH:mm). Use o horário atual do contexto." },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          service_id: { type: "string", description: "UUID do serviço (opcional)" },
          service_ids: { type: "array", items: { type: "string" }, description: "UUIDs de serviços (opcional, para múltiplos)" },
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
        "Retorna os próximos horários disponíveis em uma data (slots em múltiplos de 30 min). Use para 'primeiro horário', 'hoje' ou 'amanhã' sem hora específica. Para HOJE passe after_time com o horário atual. Retorne limit=8 para garantir opções de manhã e tarde.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data yyyy-MM-dd" },
          service_id: { type: "string", description: "UUID do serviço (ou use service_ids)" },
          service_ids: { type: "array", items: { type: "string" }, description: "UUIDs de serviços (opcional)" },
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
      description: "Cria um novo agendamento. Só chame após confirmação explícita do cliente.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do topo)" },
          client_name: { type: "string", description: "Nome do cliente (opcional)" },
          barber_id: { type: "string", description: "ID do barbeiro (UUID)" },
          service_id: { type: "string", description: "ID do serviço (UUID)" },
          service_ids: { type: "array", items: { type: "string" }, description: "IDs de serviços (opcional, use para múltiplos)" },
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
      description: "Lista os próximos agendamentos do cliente (pelo telefone). Use quando o cliente quiser cancelar ou reagendar.",
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
        "Envia cobrança PIX de plano para o cliente via WhatsApp. Chame quando o cliente solicitar envio do PIX ou quando a assinatura precisar de cobrança imediata.",
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
      name: "add_to_waitlist",
      description: "Adiciona cliente na lista de espera quando nao houver horario adequado.",
      parameters: {
        type: "object",
        properties: {
          client_phone: { type: "string", description: "Telefone do cliente (use o do contexto)" },
          client_name: { type: "string", description: "Nome do cliente (opcional)" },
          desired_date: { type: "string", description: "Data desejada yyyy-MM-dd" },
          service_id: { type: "string", description: "UUID do servico (opcional)" },
          barber_id: { type: "string", description: "UUID do barbeiro (opcional)" },
          notes: { type: "string", description: "Observacoes extras (opcional)" },
        },
        required: ["client_phone", "desired_date"],
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
  return `${dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} tenho às *${formatTimePt(a.time)}*${barberA} ou às *${formatTimePt(b.time)}*${barberB}. Qual prefere?`;
}

export type AgentResult = {
  reply: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  state?:
    | "appointment_created"
    | "appointment_rescheduled"
    | "appointment_cancelled"
    | "handoff_requested"
    | "plan_subscribed";
};

export type RunAgentOptions = {
  /** When set, use this profile/instructions instead of DB (e.g. for sandbox simulation). */
  sandboxDraft?: { agent_profile: unknown; additional_instructions?: string | null };
  /** When false, do not persist assistant messages (e.g. ai-worker persists after sending to WhatsApp). Default true. */
  persistAssistantMessages?: boolean;
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
  const now = new Date();
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
  const tomorrowOnlyStr = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + 24 * 60 * 60 * 1000));
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
      .map(
        (a) =>
          `- ${formatDateShortPt(String(a.date).slice(0, 10))} às ${formatTimePt(String(a.time).slice(0, 5))}: ${a.service_names} (com ${a.barber_name})`
      )
      .join("\n");
    contactContextBlock =
      `\n\n--- Próximos agendamentos deste contato ---\n${lines}\n` +
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
  const lastUserMsg = [...lastN].reverse().find((m) => m.role === "user");
  const lastUserTextRaw = (lastUserMsg?.content ?? "").trim();
  const lastUserText = lastUserTextRaw.toLowerCase().trim();

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
        return { reply, state: "handoff_requested" };
      }
    }
  } catch {
    // Table may not exist or handoff disabled
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
    let desiredTime: string | undefined;
    const year = dateOnlyStr.slice(0, 4);

    function normalizeTime(hRaw: string, mRaw?: string): string | undefined {
      const h = parseInt(hRaw, 10);
      const m = mRaw == null || mRaw === "" ? 0 : parseInt(mRaw, 10);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;
      if (h < 0 || h > 23 || m < 0 || m > 59) return;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    for (const m of [...lastN].reverse()) {
      if (m.role !== "user") continue;
      const t = (m.content ?? "").toLowerCase();

      if (!desiredDate) {
        if (t.includes("amanh")) desiredDate = tomorrowOnlyStr;
        else if (t.includes("hoje")) desiredDate = dateOnlyStr;
        else if (t.includes("agora")) desiredDate = dateOnlyStr;
        else {
          const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
          if (iso?.[1]) desiredDate = iso[1];
          else {
            const br = t.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
            if (br?.[1] && br?.[2]) {
              const dd = String(parseInt(br[1], 10)).padStart(2, "0");
              const mm = String(parseInt(br[2], 10)).padStart(2, "0");
              desiredDate = `${year}-${mm}-${dd}`;
            }
          }
        }
      }

      if (!desiredTime) {
        const as = t.match(/\b(?:às|as|a)\s*(\d{1,2})(?::(\d{2}))?\b/);
        const h = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*h\b/);
        const direct = t.match(/\b(\d{1,2}):(\d{2})\b/);
        if (as?.[1]) desiredTime = normalizeTime(as[1], as[2]);
        else if (h?.[1]) desiredTime = normalizeTime(h[1], h[2]);
        else if (direct?.[1] && direct?.[2]) desiredTime = normalizeTime(direct[1], direct[2]);
      }

      if (desiredDate && desiredTime) break;
    }

    // If user gave only a time, assume today if it's still in the future; otherwise tomorrow.
    if (!desiredDate && desiredTime) {
      const tm = (() => {
        const [hh, mm] = desiredTime.split(":");
        return parseInt(hh, 10) * 60 + parseInt(mm, 10);
      })();
      const nowM = (() => {
        const [hh, mm] = currentTimeHHmm.split(":");
        return parseInt(hh, 10) * 60 + parseInt(mm, 10);
      })();
      desiredDate = tm >= nowM + 15 ? dateOnlyStr : tomorrowOnlyStr;
    }

    // Horários sempre múltiplos de 5 (ex.: 16:07 -> 16:10).
    if (desiredTime) {
      const totalMins = parseInt(desiredTime.slice(0, 2), 10) * 60 + parseInt(desiredTime.slice(3, 5), 10);
      const rounded = Math.ceil(totalMins / 5) * 5;
      const rh = Math.floor(rounded / 60) % 24;
      const rm = rounded % 60;
      desiredTime = `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
    }

    return { desiredDate, desiredTime };
  })();

  const bookingGuard =
    desired.desiredDate || desired.desiredTime
      ? `\n\nDADOS JÁ INFORMADOS PELO CLIENTE (não invente e não mude):\n- date=${desired.desiredDate ?? "(não informado)"}\n- time=${desired.desiredTime ?? "(não informado)"}\nSe precisar sugerir alternativa, só faça isso se o horário estiver ocupado após checar disponibilidade.`
      : "";

  systemPrompt = systemPrompt + bookingGuard;
  const shouldPreferNameStep =
    !clientName && !!desired.desiredDate && !!desired.desiredTime
      ? `\n\nFECHAMENTO EM 2 MENSAGENS (obrigatório quando não há nome):\n` +
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

  // --- Deterministic guardrails (runtime), to avoid generic/robotic behavior ---
  // 1) Cumprimento curto: priorizar horário futuro → retorno com “de sempre” + slots → abertura genérica.
  if (isGreetingOnly) {
    if (upcomingAppointments.length > 0) {
      const next = upcomingAppointments[0];
      const dateLong = formatDateLongPt(String(next.date).slice(0, 10), timeZone);
      const timeLbl = formatTimePt(String(next.time).slice(0, 5));
      const fn = clientName ? firstNameFromClientName(clientName) : "";
      const reply =
        upcomingAppointments.length === 1
          ? fn
            ? `Olá, ${fn}! Tudo certo com seu horário às *${timeLbl}* (${dateLong}) — *${next.service_names}* com *${next.barber_name}*? Se preferir reagendar, me diga o novo dia/horário.`
            : `Olá! Seu horário às *${timeLbl}* (${dateLong}) — *${next.service_names}* com *${next.barber_name}*. Está tudo certo ou prefere reagendar?`
          : fn
            ? `Olá, ${fn}! Você tem *${upcomingAppointments.length}* horários marcados; o próximo é *${dateLong}* às *${timeLbl}* (*${next.service_names}*). Está tudo certo ou quer ajustar algum?`
            : `Olá! Você tem *${upcomingAppointments.length}* horários marcados; o próximo é *${dateLong}* às *${timeLbl}*. Está tudo certo ou prefere reagendar?`;
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return { reply };
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
        return { reply };
      }
    }
    const reply = buildOpeningMessage(barbershopName);
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return { reply };
  }

  // 2) Out-of-scope (pizza etc.): never invent external businesses; redirect to booking/services.
  if (isOutOfScopeFood(lastUserText)) {
    const reply = "Aqui eu só cuido do visual 😄\n\nQuer ver os serviços ou já quer agendar um horário?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return { reply };
  }

  // 3) If user asks “vocês tem X?” and X doesn't exist, list top services immediately + CTA.
  if (/(voc[eê]s\s+t[eê]m|voces\s+tem|fazem|faz)\b/i.test(lastUserText)) {
    const asked = extractAskedService(lastUserText);
    if (asked) {
      const servicesUnknown = await aiTools.listServices(effectiveBarbershopId);
      const services = Array.isArray(servicesUnknown) ? (servicesUnknown as Array<Record<string, unknown>>) : [];
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
        return { reply };
      }
    }
  }

  // 3.1) If user says "qualquer um" (or "sim" after options), assume no preference and advance when we already have date+time.
  const userSaidNoPreference = /(qualquer um|tanto faz|pode ser qualquer)/i.test(lastUserText);
  const userIsAffirmativeOnly =
    /^(sim|s|pode|ok|okay|beleza|confirmo|isso|fechado|combinado|manda ver|top|show)[!.\s]*$/i.test((lastUserText ?? "").trim());
  const assistantAskedPreference = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(qual .*você prefere|qual .*prefere|prefere qual|quer qual)/i.test(t);
    }
    return false;
  })();

  const assistantAskedBarberPreference = (() => {
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
    !assistantAskedBarberPreference &&
    !assistantAskedNameEarly &&
    !desired.desiredTime &&
    !/\bamanh/i.test(lastUserText) &&
    /(hor[aá]rio|tem hor[aá]rio|dispon[ií]vel|vaga)/i.test(lastUserText) &&
    inferServiceKeyword(lastUserTextRaw) != null
  ) {
    const reply = "Claro! Tem preferência por barbeiro?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return { reply };
  }

  // If user says "qualquer um" after we asked barber preference, propose 2 concrete slots (no bullets).
  if (
    (userSaidNoPreference || userIsAffirmativeOnly) &&
    assistantAskedBarberPreference &&
    !desired.desiredTime
  ) {
    const servicesUnknown = await aiTools.listServices(effectiveBarbershopId);
    const services = Array.isArray(servicesUnknown) ? (servicesUnknown as Array<Record<string, unknown>>) : [];
    const inferred = inferServiceKeyword(
      normalizeLoose(lastUserTextRaw + " " + lastN.map((m) => String(m.content ?? "")).join(" "))
    );
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
              : services[0];
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
      const reply = picked2.length ? formatSlotSuggestion(picked2, "hoje") : "Hoje tá bem corrido 😅 Quer que eu veja o primeiro horário de amanhã?";
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return { reply };
    }
  }

  if ((userSaidNoPreference || (userIsAffirmativeOnly && assistantAskedPreference)) && desired.desiredDate && desired.desiredTime) {
    const servicesUnknown = await aiTools.listServices(effectiveBarbershopId);
    const services = Array.isArray(servicesUnknown) ? (servicesUnknown as Array<Record<string, unknown>>) : [];
    const historyUserText = normalizeLoose(
      lastN
        .filter((m) => m.role === "user")
        .map((m) => String(m.content ?? ""))
        .join(" ")
    );
    const inferred = inferServiceKeyword(historyUserText);
    const findBy = (needle: string) => { const n = normalizeLoose(needle); return services.find((s) => normalizeLoose(String(s?.name ?? "")).includes(n)); };
    const pickedService =
      services.find((s) => {
        const n = normalizeLoose(String(s?.name ?? ""));
        if (!n) return false;
        // tolerant match: allow "corte e barba" to match "corte + barba"
        if (historyUserText.includes(n)) return true;
        if (n === "corte barba" && (historyUserText.includes("corte e barba") || historyUserText.includes("corte barba"))) return true;
        return false;
      }) ??
      (inferred === "combo"
        ? findBy("corte + barba") ?? findBy("corte") ?? services[0]
        : inferred === "barba"
          ? findBy("barba") ?? services[0]
          : inferred === "sobrancelha"
            ? findBy("sobrancelha") ?? services[0]
            : inferred === "corte"
              ? findBy("corte") ?? services[0]
              : null);

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
        const reply =
          `Show — vou te colocar com o *${chosen.barber_name}* então.\n\n` +
          `*${String(pickedService.name ?? "")}* • ${desired.desiredDate} ${desired.desiredTime} • *R$ ${Number(availability["total_price"] ?? 0).toFixed(2).replace(".", ",")}*` +
          `\n\n[[MSG]]Pra salvar aqui, qual seu nome?`;
        if (persistAssistantMessages) {
          await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
            conversationId,
            reply,
          ]);
        }
        return { reply };
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
      const top = services
        .map((s) => ({ name: String(s?.name ?? ""), price: Number(s?.price ?? 0), duration_minutes: Number(s?.duration_minutes ?? 0) }))
        .filter((s) => s.name);
      const reply =
        `Fechou — pra qual serviço você quer? 👀\n\n` +
        `Aqui os principais:\n` +
        `${formatTopServicesForWhatsapp(top, 4)}\n\n` +
        `Me diz qual você quer que eu já puxo os horários de hoje.`;
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return { reply };
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
      return { reply };
    }

    const reply = "Hoje já tá bem corrido por aqui 😅 Quer que eu veja o primeiro horário de amanhã?";
    if (persistAssistantMessages) {
      await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
        conversationId,
        reply,
      ]);
    }
    return { reply };
  }

  // 5) "Primeiro horário amanhã" should always be computed (never guessed).
  if (
    /\bamanh/i.test(lastUserText) &&
    /(primeiro|1o|primeira)\s+hor[aá]rio/i.test(lastUserText) &&
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
      const top = services
        .map((s) => ({ name: String(s?.name ?? ""), price: Number(s?.price ?? 0), duration_minutes: Number(s?.duration_minutes ?? 0) }))
        .filter((s) => s.name);
      const reply =
        `Pra qual serviço você quer marcar amanhã?\n\n` +
        `Aqui os principais:\n` +
        `${formatTopServicesForWhatsapp(top, 4)}`;
      if (persistAssistantMessages) {
        await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
          conversationId,
          reply,
        ]);
      }
      return { reply };
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
    return { reply };
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

    if (pickedTime && mentionsBookingContext) {
      const servicesUnknown = await aiTools.listServices(effectiveBarbershopId);
      const services = Array.isArray(servicesUnknown) ? (servicesUnknown as Array<Record<string, unknown>>) : [];

      const inferred = inferServiceKeyword(lastUserTextRaw + " " + lastAssistantTextRaw + " " + historyNorm);
      const findBy = (needle: string) => { const n = normalizeLoose(needle); return services.find((s) => normalizeLoose(String(s?.name ?? "")).includes(n)); };
      const serviceByText = services.find((s) => {
        const n = normalizeLoose(String(s?.name ?? ""));
        return n && (textNorm.includes(n) || historyNorm.includes(n));
      });
      const pickedService =
        serviceByText ??
        (inferred === "combo"
          ? findBy("corte + barba") ?? findBy("corte") ?? services[0]
          : inferred === "barba"
            ? findBy("barba") ?? services[0]
            : inferred === "sobrancelha"
              ? findBy("sobrancelha") ?? services[0]
              : inferred === "corte"
                ? findBy("corte") ?? services[0]
                : null);

      if (pickedService && typeof pickedService.id === "string") {
        const barbersUnknown = await aiTools.listBarbers(effectiveBarbershopId);
        const barbers = Array.isArray(barbersUnknown) ? (barbersUnknown as Array<Record<string, unknown>>) : [];
        const barberByText = barbers.find((b) => {
          const n = normalizeLoose(String(b?.name ?? ""));
          return n && (textNorm.includes(n) || normalizeLoose(lastAssistantTextRaw).includes(n));
        });

        const date =
          desired.desiredDate ||
          (/\bamanh/i.test(lastUserText) || /\bamanh/i.test(lastAssistantTextRaw) ? tomorrowOnlyStr : dateOnlyStr);

        const checkArgs = {
          date,
          time: pickedTime,
          service_id: String(pickedService.id),
          barber_id: barberByText && typeof barberByText.id === "string" ? String(barberByText.id) : undefined,
          after_time: date === dateOnlyStr ? currentTimeHHmm : undefined,
        };
        const availability = (await aiTools.checkAvailability(effectiveBarbershopId, checkArgs)) as Record<string, unknown>;
        if (persistAssistantMessages) {
          await pool.query(
            `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
             VALUES ($1, 'tool', 'check_availability', $2, $3)`,
            [conversationId, checkArgs, JSON.stringify(availability).slice(0, 4096)]
          );
        }

        const requested = (availability as { requested?: unknown }).requested as
          | { available?: boolean; barbers?: Array<{ barber_id?: string; barber_name?: string }> }
          | undefined;
        const availBarbers = Array.isArray(requested?.barbers) ? requested?.barbers ?? [] : [];
        const isAvailable = requested?.available === true && availBarbers.length > 0;

        if (isAvailable) {
          const chosen = availBarbers[0]!;
          const serviceName = String(pickedService["name"] ?? "Serviço");
          const totalPrice = Number((availability as Record<string, unknown>)["total_price"] ?? pickedService["price"] ?? 0);
          const dateLong = formatDateLongPt(date, timeZone);
          const timePt = formatTimePt(pickedTime);

          // If we already have the client name, create immediately. Otherwise, ask once.
          if (clientName) {
            const createArgs = {
              client_phone: clientPhone,
              client_name: clientName,
              barber_id: String(chosen.barber_id ?? ""),
              service_id: String(pickedService.id),
              date,
              time: pickedTime,
            };
            const created = (await aiTools.createAppointment(effectiveBarbershopId, createArgs)) as Record<string, unknown>;
            if (persistAssistantMessages) {
              await pool.query(
                `INSERT INTO public.ai_messages (conversation_id, role, tool_name, tool_payload, content)
                 VALUES ($1, 'tool', 'create_appointment', $2, $3)`,
                [conversationId, createArgs, JSON.stringify(created).slice(0, 4096)]
              );
            }

            if (typeof created?.id === "string" && created.id) {
              const addrLine = shopAddress
                ? `*Endereço:* ${shopAddress}\n`
                : `*Endereço:* cadastre o endereço em Configurações\n`;
              const reply =
                `Agendamento confirmado:\n` +
                `*Serviço:* ${serviceName}\n` +
                `*Data:* ${dateLong} às ${timePt}\n` +
                `*Barbeiro:* ${String(chosen.barber_name ?? "").trim()}\n` +
                addrLine +
                `*Total:* R$ ${Number.isFinite(totalPrice) ? totalPrice.toFixed(2).replace(".", ",") : "0,00"}\n\n` +
                `Aguardamos você!`;
              if (persistAssistantMessages) {
                await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
                  conversationId,
                  reply,
                ]);
              }
              return { reply, state: "appointment_created" };
            }
          }

          const addrLine = shopAddress
            ? `*Endereço:* ${shopAddress}\n`
            : `*Endereço:* cadastre o endereço em Configurações\n`;
          const reply =
            `Resumo:\n` +
            `*Serviço:* ${serviceName}\n` +
            `*Barbeiro:* ${String(chosen.barber_name ?? "").trim()}\n` +
            `*Data:* ${dateLong} às ${timePt}\n` +
            addrLine +
            `*Total:* R$ ${Number.isFinite(totalPrice) ? totalPrice.toFixed(2).replace(".", ",") : "0,00"}\n\n` +
            `[[MSG]]Para confirmar, qual o seu nome?`;
          if (persistAssistantMessages) {
            await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
              conversationId,
              reply,
            ]);
          }
          return { reply };
        }

        // Unavailable → offer two fresh options (no bullets)
        const nextArgs = {
          date,
          service_id: String(pickedService.id),
          after_time: date === dateOnlyStr ? currentTimeHHmm : undefined,
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
        const picked2 = pickMorningAfternoon(allSlots.filter((s) => s.time !== pickedTime));
        const dayLabel = date === dateOnlyStr ? "hoje" : "amanhã";
        const reply = picked2.length
          ? formatSlotSuggestion(picked2, dayLabel)
          : "Nesse horário não tá rolando 😅 Quer que eu veja outros horários pra você?";
        if (persistAssistantMessages) {
          await pool.query(`INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [
            conversationId,
            reply,
          ]);
        }
        return { reply };
      }
    }
  }

  const isAffirmativeOnly = (() => {
    const t = (lastUserText ?? "").trim();
    if (!t) return false;
    if (t.length > 40) return false;
    return /^(sim|s|pode|ok|okay|beleza|confirmo|isso|fechado|combinado|manda ver|pode agendar|pode marcar|top|show)[!.\s]*$/i.test(t);
  })();

  const assistantAskedConfirmation = (() => {
    for (const m of [...lastN].reverse()) {
      if (m.role !== "assistant") continue;
      const t = (m.content ?? "").toLowerCase();
      return /(fecho assim|confirma|posso fechar|t[aá] tudo certo|pode prosseguir|posso prosseguir|confirma pra mim)/i.test(t);
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
    // avoid treating affirmations as names
    if (isAffirmativeOnly) return false;
    if (isGreetingOnly) return false;
    // mostly letters/spaces (allow accents)
    return /^[A-Za-zÀ-ÖØ-öø-ÿ' ]+$/.test(t) && t.split(" ").filter(Boolean).length <= 4;
  })();

  /** Nome explícito ("me chamo X") ou apenas o nome após pedido (ex.: "Mateus"). */
  const nameFromUserForBooking = (() => {
    const raw = extractedName ?? (isLikelyNameOnly && lastUserText.trim() ? lastUserText.trim() : "");
    if (!raw) return "";
    return aiTools.formatStoredClientName(raw) ?? raw;
  })();

  // Happy-path: após pedir nome, finalizar com create_appointment usando último check_availability.
  if (assistantAskedName && nameFromUserForBooking) {
    const lastAvailTool = [...lastN]
      .reverse()
      .find((m) => m.role === "tool" && m.tool_name === "check_availability");
    const lastAvailPayload = (lastAvailTool?.tool_payload ?? null) as
      | { date?: string; time?: string; service_id?: string; barber_id?: string }
      | null;
    const lastAvailResult = (() => {
      try {
        const c = String(lastAvailTool?.content ?? "");
        return c ? (JSON.parse(c) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    })();

    const date = (lastAvailPayload?.date ?? desired.desiredDate ?? dateOnlyStr) as string;
    const time = (lastAvailPayload?.time ?? desired.desiredTime ?? "") as string;
    const serviceId = (lastAvailPayload?.service_id ?? "") as string;
    const requested = (lastAvailResult?.requested ?? null) as
      | { available?: boolean; barbers?: Array<{ barber_id?: string; barber_name?: string }> }
      | null;
    const slotActuallyAvailable = requested?.available === true && Array.isArray(requested?.barbers) && requested.barbers.length > 0;
    const chosenBarberId = slotActuallyAvailable
      ? (requested?.barbers?.[0]?.barber_id ?? lastAvailPayload?.barber_id ?? "")
      : (lastAvailPayload?.barber_id ?? "");
    const chosenBarberName = slotActuallyAvailable
      ? (requested?.barbers?.[0]?.barber_name ?? "")
      : "";

    if (slotActuallyAvailable && serviceId && date && time && chosenBarberId) {
      const created = (await aiTools.createAppointment(effectiveBarbershopId, {
        client_phone: clientPhone,
        client_name: nameFromUserForBooking,
        barber_id: String(chosenBarberId),
        service_id: String(serviceId),
        date,
        time,
      })) as Record<string, unknown>;

      if (typeof created?.id === "string" && created.id) {
        const services = Array.isArray(created.services) ? (created.services as Array<{ name?: string; service_name?: string }>) : [];
        const serviceName =
          services.map((s) => s?.name ?? s?.service_name ?? "").filter(Boolean).join(" + ") || "";
        const totalPrice = Number(
          (lastAvailResult as Record<string, unknown> | null)?.["total_price"] ??
            created.total_price ??
            created.price ??
            0
        );
        const dateLong = formatDateLongPt(date, timeZone);
        const timePt = formatTimePt(time);
        const whenPhrase =
          date === dateOnlyStr
            ? `hoje às ${timePt}`
            : date === tomorrowOnlyStr
              ? `amanhã às ${timePt}`
              : `${dateLong} às ${timePt}`;
        const reply =
          `Agendado, ${nameFromUserForBooking}! ${serviceName} fica R$ ${Number.isFinite(totalPrice) ? totalPrice.toFixed(0) : "0"}. ` +
          `${chosenBarberName ? `${chosenBarberName} aguarda você` : "Te aguardamos"} ${whenPhrase}.`;

        if (persistAssistantMessages) {
          await pool.query(
            `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
            [conversationId, reply]
          );
        }
        return { reply, state: "appointment_created" };
      }
    }
    // If we can't resolve the last availability context, fall through to model.
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
    ...(isAffirmativeOnly && assistantAskedConfirmation
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

  /** Menos criatividade quando o próximo passo é fechar agendamento (nome ou confirmação explícita). */
  const bookingCritical =
    (assistantAskedName && isLikelyNameOnly) || (isAffirmativeOnly && assistantAskedConfirmation);
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
            const date = desired.desiredDate || dRaw;
            const time = desired.desiredTime || tRaw;
            const isToday = date === dateOnlyStr;
            return aiTools.checkAvailability(currentBarbershopId, {
              date,
              time,
              after_time: isToday ? ((args.after_time as string) || currentTimeHHmm) : undefined,
              barber_id: args.barber_id as string | undefined,
              service_id: args.service_id as string | undefined,
              service_ids: args.service_ids as string[] | undefined,
            });
          }
          if (name === "get_next_slots") {
            const dRaw = (args.date as string) ?? "";
            const date = desired.desiredDate || dRaw;
            const isToday = date === dateOnlyStr;
            return aiTools.getNextSlots(currentBarbershopId, {
              date,
              service_id: args.service_id as string | undefined,
              service_ids: args.service_ids as string[] | undefined,
              after_time: isToday ? ((args.after_time as string) || currentTimeHHmm) : undefined,
              barber_id: args.barber_id as string | undefined,
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
            const payload: Parameters<typeof aiTools.createAppointment>[1] = {
              client_phone: (args.client_phone as string) ?? clientPhone,
              client_name: args.client_name as string | undefined,
              barber_id: args.barber_id as string,
              service_id: args.service_id as string | undefined,
              service_ids: args.service_ids as string[] | undefined,
              date: (() => {
                const raw = (args.date as string) ?? "";
                const d = raw || desired.desiredDate || "";
                if (desired.desiredDate && d !== desired.desiredDate) return desired.desiredDate;
                if (lastUserText.includes("amanh") && d && d !== tomorrowOnlyStr) return tomorrowOnlyStr;
                if (lastUserText.includes("hoje") && d && d !== dateOnlyStr) return dateOnlyStr;
                return d;
              })(),
              time: (() => {
                const raw = (args.time as string) ?? "";
                const t = raw || desired.desiredTime || "";
                if (desired.desiredTime && t !== desired.desiredTime) return desired.desiredTime;
                return t;
              })(),
              notes: args.notes as string | undefined,
            };
            if (typeof args.client_id === "string" && args.client_id) payload.client_id = args.client_id;
            const r = await aiTools.createAppointment(currentBarbershopId, payload);
            // Fire-and-forget: update client memory from the newly created appointment
            if ((r as Record<string, unknown>)?.id) {
              state = "appointment_created";
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
            const r = await aiTools.cancelAppointmentByAgent(
              currentBarbershopId,
              (args.appointment_id as string) ?? "",
              ((args.client_phone as string) ?? clientPhone) || ""
            );
            if (r && typeof r === "object" && (r as { ok?: boolean }).ok === true) {
              state = "appointment_cancelled";
              updateClientMemoryFromAppointmentEvent({
                eventType: "appointment_cancelled",
                barbershopId: currentBarbershopId,
                clientPhone,
              }).catch(() => {});
            }
            return r;
          }
          if (name === "reschedule_appointment") {
            const r = await aiTools.rescheduleAppointmentByAgent(
              currentBarbershopId,
              (args.appointment_id as string) ?? "",
              ((args.client_phone as string) ?? clientPhone) || "",
              {
                date: (args.date as string) ?? "",
                time: (args.time as string) ?? "",
                barber_id: args.barber_id as string | undefined,
              }
            );
            if (r && typeof r === "object" && (r as { ok?: boolean }).ok === true) {
              state = "appointment_rescheduled";
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
          if (name === "add_to_waitlist")
            return aiTools.addToWaitlist(currentBarbershopId, {
              client_phone: ((args.client_phone as string) ?? clientPhone) || "",
              client_name: args.client_name as string | undefined,
              desired_date: (args.desired_date as string) ?? "",
              service_id: args.service_id as string | undefined,
              barber_id: args.barber_id as string | undefined,
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
          loopMessages.push({
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
          loopMessages.push({
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
    const replyRaw = (msg.content ?? "").trim() || "Desculpe, não consegui responder. Pode repetir?";
    let reply = sanitizeClientFacingReply(replyRaw);
    if (looksLikePhoneRequest(reply)) {
      reply = "Me diz qual serviço você quer e pra qual dia/horário — que já te encaixo.";
    }
    // If the reply exposes AI/technical limitations, suppress it for human handoff
    if (containsAiExposure(reply)) {
      console.warn("[ai-agent] suppressed AI-exposure reply for handoff, conversationId=%s", conversationId);
      reply = "";
    }
    await persistAssistant(reply);

    // Fire-and-forget: extract conversation signals and update client memory
    updateClientMemoryFromConversation(effectiveBarbershopId, clientPhone, {
      messages: lastN.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
      finalState: state,
    }).catch(() => {});

    return { reply, usage: totalUsage, state };
  }

  return {
    reply:
      "Posso não ter entendido bem — me diz de forma direta: quer agendar, reagendar ou cancelar? Qual dia e horário?",
    usage: totalUsage,
    state,
  };
}
