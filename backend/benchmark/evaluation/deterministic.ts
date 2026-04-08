/**
 * Deterministic evaluation layer.
 *
 * These checks are rule-based, reproducible without LLM calls, and fast.
 * They are the first line of defense for catching objective violations.
 *
 * Design principles:
 * - False-negative tolerance over false-positive: we'd rather miss a subtle violation
 *   than flag a correct reply
 * - Each check is independent and composable
 * - Patterns are PT-BR aware
 */

import type {
  TurnResult,
  ViolationOccurrence,
  ViolationType,
  ViolationSeverity,
} from "../types.js";
import { VIOLATION_SEVERITY } from "../types.js";

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const MARKDOWN_BOLD_RE = /\*\*[^*]+\*\*/g;

/** Patterns that expose the automated/AI nature of the system */
const AI_EXPOSURE_PATTERNS: RegExp[] = [
  /como\s+(ia|robô|bot|inteligência\s+artificial)\b/i,
  /\bsou\s+um?\s+(bot|robô|assistente\s+virtual|ia|modelo)\b/i,
  /\bfui\s+programad[oa]\b/i,
  /\bsistema\s+(de\s+)?ia\b/i,
  /\bnão\s+tenho\s+acesso\s+(a|ao|aos|às)\b/i,
  /\bminhas\s+informações\s+(estão|são)\s+limitadas\b/i,
  /\bnão\s+consegui\s+(checar|verificar|acessar|obter)\b/i,
  /\bcomo\s+assistente\b/i,
  /\bchatbot\b/i,
];

/** Patterns indicating the agent claims to have booked before confirming */
const PRE_BOOKING_CLAIM_PATTERNS: RegExp[] = [
  /agendei\s+(para|pra|o)/i,
  /\bmarquei\s+(para|pra|o)\b/i,
  // NOTE: "está marcado" removed — it fires falsely when informing existing appointments
  /\bagendamento\s+(feito|criado|realizado|confirmado)\b/i,
  /\bconfirmei\s+(o\s+)?seu\s+(horário|agendamento)\b/i,
  // Catch actual confirmation message format (only when state is NOT a real success state)
  /^agendamento\s+confirmado[:\n]/im,
  /\baguardamos\s+você\b/i,
];

/** Patterns requesting phone number (which the agent already has via WhatsApp) */
const PHONE_ASK_PATTERNS: RegExp[] = [
  /(me\s+passa|pode\s+me\s+passar|manda|informe?|qual\s+[eé]|me\s+diga).{0,30}(telefone|celular|whatsapp|número)/i,
  /\bseu\s+(telefone|celular|número)\b/i,
  /\bnúmero\s+de\s+(telefone|celular|contato)\b/i,
];

/** Technical/apologetic phrases that shouldn't reach the client */
const TECHNICAL_APOLOGY_PATTERNS: RegExp[] = [
  /\berro\s+(intern[ao]|no\s+sistema|técnico)\b/i,
  /\bfalha\s+técnica\b/i,
  /\bnão\s+consigo\s+(processar|conectar|acessar)\b/i,
  /\btente\s+novamente\s+mais\s+tarde\b/i,
  /\bserviço\s+(temporariamente\s+)?indisponível\b/i,
  /\bdesculpe.*\b(problema|erro|falha)\b/i,
];

/** Patterns that may indicate undesired slang (configurable per barbershop) */
const UNDESIRED_SLANG_PATTERNS: RegExp[] = [
  /\bmano[,\s!]/i,
  /\bvei[,\s!]/i,
  /\bcaramba\b/i,
  /\bporra\b/i,
  /\bcaralh[oa]\b/i,
];

/** Patterns for false closure — agent says goodbye before booking is done */
const FALSE_CLOSURE_PATTERNS: RegExp[] = [
  /\bqualquer\s+(outra\s+)?(coisa|dúvida|ajuda)\b.*\b(estou|fico)\s+à\s+disposição\b/i,
  /\bfoi\s+um\s+prazer\s+atender\b/i,
  /\baté\s+(logo|mais|próxima)\b.*\b(agend|serviç)/i,
];

// ---------------------------------------------------------------------------
// Individual check functions
// ---------------------------------------------------------------------------

function checkAiExposure(reply: string): boolean {
  return AI_EXPOSURE_PATTERNS.some((re) => re.test(reply));
}

function checkUuidLeak(reply: string): boolean {
  UUID_RE.lastIndex = 0;
  return UUID_RE.test(reply);
}

function checkPhoneAsk(reply: string): boolean {
  return PHONE_ASK_PATTERNS.some((re) => re.test(reply));
}

function checkPreBookingClaim(reply: string): boolean {
  return PRE_BOOKING_CLAIM_PATTERNS.some((re) => re.test(reply));
}

function checkPastTimeSuggestion(reply: string): boolean {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  // Only relevant if the reply mentions "hoje" or no date context
  const mentionsToday = /\bhoje\b/i.test(reply);
  if (!mentionsToday) return false;
  const matches = reply.match(/\b(\d{1,2}):(\d{2})\b/g) ?? [];
  return matches.some((m) => {
    const [h, min] = m.split(":").map(Number);
    const slotMins = h * 60 + min;
    // More than 30 minutes in the past is a violation
    return slotMins < nowMins - 30;
  });
}

function checkMarkdownOveruse(reply: string): boolean {
  const boldMatches = reply.match(MARKDOWN_BOLD_RE) ?? [];
  // More than 5 bold segments in a single reply is considered overuse
  return boldMatches.length > 5;
}

function checkExcessiveEmojis(reply: string): boolean {
  EMOJI_RE.lastIndex = 0;
  const emojis = reply.match(EMOJI_RE) ?? [];
  return emojis.length > 4;
}

function checkMessageTooLong(reply: string): boolean {
  // More than 1200 chars is flagged — WhatsApp messages should be concise
  return reply.length > 1200;
}

function checkEmptyMessage(reply: string): boolean {
  return reply.trim().length < 5;
}

function checkTechnicalApology(reply: string): boolean {
  return TECHNICAL_APOLOGY_PATTERNS.some((re) => re.test(reply));
}

function checkUndesiredSlang(reply: string): boolean {
  return UNDESIRED_SLANG_PATTERNS.some((re) => re.test(reply));
}

function checkFalseClosure(reply: string): boolean {
  return FALSE_CLOSURE_PATTERNS.some((re) => re.test(reply));
}

// ---------------------------------------------------------------------------
// Multi-turn checks (require conversation history)
// ---------------------------------------------------------------------------

/**
 * Detects duplicate confirmation — agent asks the same confirmation question
 * twice in a row.
 */
export function checkDuplicateConfirmation(turns: string[]): boolean {
  if (turns.length < 2) return false;
  const last = turns[turns.length - 1].toLowerCase().trim();
  const prev = turns[turns.length - 2].toLowerCase().trim();
  const confirmPhrases = [
    "posso confirmar",
    "confirmo o agendamento",
    "fecho assim",
    "confirma",
    "está certo",
    "pode confirmar",
  ];
  return confirmPhrases.some(
    (p) => last.includes(p) && prev.includes(p) && similarity(last, prev) > 0.7
  );
}

/**
 * Detects redundant info request — agent asks for something the user already provided.
 */
export function checkRedundantInfoRequest(
  userMessages: string[],
  agentReplies: string[]
): boolean {
  if (userMessages.length < 2 || agentReplies.length < 1) return false;

  const fullUserContext = userMessages.slice(0, -1).join(" ").toLowerCase();
  const lastReply = agentReplies[agentReplies.length - 1].toLowerCase();

  // If user mentioned a name and agent asks for name again
  const nameInContext = /\bsou\s+o?\s*\w+|\bmeu\s+nome\s+[eé]\s+\w+/i.test(fullUserContext);
  const asksForName = /qual\s+[eé]\s+(o\s+)?seu\s+nome|como\s+(você\s+)?se\s+chama/i.test(
    lastReply
  );
  if (nameInContext && asksForName) return true;

  // If user mentioned date/time and agent asks again
  const dateInContext =
    /\b(segunda|terça|quarta|quinta|sexta|sábado|domingo|amanhã|hoje)\b|\b\d{1,2}\/\d{1,2}|\b\d{1,2}:\d{2}\b/i.test(
      fullUserContext
    );
  const asksDate =
    /para quando|que dia|qual dia|qual data|quando você quer|que horário/i.test(lastReply);
  if (dateInContext && asksDate) return true;

  return false;
}

/**
 * Simple loop detection: agent repeats virtually the same reply twice in a row.
 */
export function checkLoopDetected(agentReplies: string[]): boolean {
  if (agentReplies.length < 2) return false;
  const a = agentReplies[agentReplies.length - 1].trim();
  const b = agentReplies[agentReplies.length - 2].trim();
  return a.length > 20 && similarity(a, b) > 0.85;
}

/**
 * Detects that the agent asked for the client's name more than once in the
 * same conversation when the user already provided it.
 */
export function checkRepeatedNameRequest(
  userMessages: string[],
  agentReplies: string[]
): boolean {
  const nameAskedCount = agentReplies.filter((r) =>
    /(qual\s+(o\s+)?seu\s+nome|para\s+confirmar.*nome|me\s+diz(e)?\s+seu\s+nome|informe?\s+seu\s+nome)/i.test(r)
  ).length;
  const nameGivenCount = userMessages.filter((m) =>
    /^[A-Za-zÀ-ÖØ-öø-ÿ' ]{2,30}$/.test(m.trim())
  ).length;
  // If name was asked more than once after the user already provided it, it's a violation
  return nameAskedCount >= 2 && nameGivenCount >= 1;
}

/**
 * Após pedido de nome (resumo fechado), o agente não deve oferecer de novo duas opções de horário
 * (falha típica do chat 13).
 */
export function checkSlotReopenAfterName(userMessages: string[], agentReplies: string[]): boolean {
  if (userMessages.length < 2 || agentReplies.length < 2) return false;
  const lastUser = userMessages[userMessages.length - 1]?.trim() ?? "";
  const prevAgent = agentReplies[agentReplies.length - 2] ?? "";
  const lastAgent = agentReplies[agentReplies.length - 1] ?? "";
  const bareName =
    /^[A-Za-zÀ-ÖØ-öø-ÿ' ]{2,30}$/.test(lastUser) && lastUser.split(/\s+/).filter(Boolean).length <= 4;
  const askedName = /(qual\s+(o\s+)?seu\s+nome|para\s+confirmar.*qual\s+o\s+seu\s+nome|pra\s+salvar.*nome)/i.test(
    prevAgent
  );
  if (!bareName || !askedName) return false;
  const timeMatches = lastAgent.match(/\b\d{1,2}h\d{0,2}\b|\b\d{1,2}:\d{2}\b/g) ?? [];
  const offersSlotChoice =
    /(qual\s+você\s+prefere|qual\s+prefere|ou\s+às|também\s+com)/i.test(lastAgent) && timeMatches.length >= 2;
  const alreadyConfirmed = /Agendado\b|^Agendamento\s+confirmado/i.test(lastAgent);
  return offersSlotChoice && !alreadyConfirmed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough string similarity using Jaccard on word sets */
function similarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function excerpt(reply: string, maxLen = 120): string {
  const clean = reply.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
}

// ---------------------------------------------------------------------------
// Main single-turn evaluator
// ---------------------------------------------------------------------------

interface SingleTurnCheckResult {
  type: ViolationType;
  found: boolean;
}

export function evaluateSingleTurn(reply: string, agentState?: string): ViolationOccurrence[] {
  const isRealSuccess = agentState === "appointment_created" ||
    agentState === "appointment_rescheduled" ||
    agentState === "appointment_cancelled";
  const checks: SingleTurnCheckResult[] = [
    { type: "ai_exposure", found: checkAiExposure(reply) },
    { type: "uuid_leak", found: checkUuidLeak(reply) },
    { type: "phone_ask", found: checkPhoneAsk(reply) },
    // Only fire pre_booking_claim when the booking is NOT actually done
    { type: "pre_booking_claim", found: isRealSuccess ? false : checkPreBookingClaim(reply) },
    { type: "past_time_suggestion", found: checkPastTimeSuggestion(reply) },
    { type: "markdown_overuse", found: checkMarkdownOveruse(reply) },
    { type: "excessive_emojis", found: checkExcessiveEmojis(reply) },
    { type: "message_too_long", found: checkMessageTooLong(reply) },
    { type: "empty_message", found: checkEmptyMessage(reply) },
    { type: "technical_apology", found: checkTechnicalApology(reply) },
    { type: "undesired_slang", found: checkUndesiredSlang(reply) },
    { type: "false_closure", found: checkFalseClosure(reply) },
  ];

  return checks
    .filter((c) => c.found)
    .map((c) => ({
      type: c.type,
      severity: VIOLATION_SEVERITY[c.type] as ViolationSeverity,
      turnIndex: -1, // caller fills this in
      excerpt: excerpt(reply),
    }));
}

// ---------------------------------------------------------------------------
// Full conversation evaluator
// ---------------------------------------------------------------------------

export interface ConversationEvalInput {
  turnResults: TurnResult[];
  userMessages: string[];
  agentReplies: string[];
}

export function evaluateConversation(input: ConversationEvalInput): ViolationOccurrence[] {
  const { turnResults, userMessages, agentReplies } = input;
  const allViolations: ViolationOccurrence[] = [];

  // Per-turn single checks (already run in runner, but we can re-evaluate here)
  for (const turn of turnResults) {
    const v = evaluateSingleTurn(turn.agentReply, turn.agentState).map((occ) => ({
      ...occ,
      turnIndex: turn.turnIndex,
    }));
    allViolations.push(...v);
  }

  // Multi-turn checks
  if (checkDuplicateConfirmation(agentReplies)) {
    allViolations.push({
      type: "duplicate_confirmation",
      severity: VIOLATION_SEVERITY["duplicate_confirmation"],
      turnIndex: agentReplies.length - 1,
      excerpt: excerpt(agentReplies[agentReplies.length - 1]),
    });
  }

  if (checkRedundantInfoRequest(userMessages, agentReplies)) {
    allViolations.push({
      type: "redundant_info_request",
      severity: VIOLATION_SEVERITY["redundant_info_request"],
      turnIndex: agentReplies.length - 1,
      excerpt: excerpt(agentReplies[agentReplies.length - 1]),
    });
  }

  if (checkLoopDetected(agentReplies)) {
    allViolations.push({
      type: "loop_detected",
      severity: VIOLATION_SEVERITY["loop_detected"],
      turnIndex: agentReplies.length - 1,
      excerpt: excerpt(agentReplies[agentReplies.length - 1]),
    });
  }

  if (checkRepeatedNameRequest(userMessages, agentReplies)) {
    allViolations.push({
      type: "redundant_info_request",
      severity: VIOLATION_SEVERITY["redundant_info_request"],
      turnIndex: agentReplies.length - 1,
      excerpt: "Agent asked for client name more than once after it was provided",
    });
  }

  if (checkSlotReopenAfterName(userMessages, agentReplies)) {
    allViolations.push({
      type: "ignored_context",
      severity: VIOLATION_SEVERITY["ignored_context"],
      turnIndex: agentReplies.length - 1,
      excerpt: "Reabriu escolha de horários após pedido de nome (fluxo deveria ir para create_appointment)",
    });
  }

  // Deduplicate by (type, turnIndex)
  return deduplicateViolations(allViolations);
}

function deduplicateViolations(violations: ViolationOccurrence[]): ViolationOccurrence[] {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.type}:${v.turnIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tool-usage checks (called after run, uses tool call log)
// ---------------------------------------------------------------------------

/**
 * Check if required tools were called given the scenario expectations.
 */
export function checkMissingRequiredTools(
  calledTools: string[],
  requiredTools: string[]
): { missing: string[] } {
  const calledSet = new Set(calledTools);
  const missing = requiredTools.filter((t) => !calledSet.has(t));
  return { missing };
}
