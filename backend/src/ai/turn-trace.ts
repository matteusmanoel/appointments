/**
 * Structured turn trace.
 *
 * One JSON line per boundary, joined by conversationId + providerEventId + jobId.
 * The API process logs phase "inbound". The AI worker logs phase "agent"
 * after OpenAI and the Evolution send. Neither line includes the system prompt,
 * tool arguments, tokens/secrets, or the full phone number.
 */

export type TurnTraceOpenAiRound = {
  round: number;
  model: string;
  latencyMs: number;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  toolsRequested: string[];
};

export type TurnTraceTool = {
  name: string;
  ok: boolean;
};

export type TurnTraceIntent = {
  primary: string;
  intents: string[];
  confidence: number;
  service: string | null;
  barber: string | null;
  date: string | null;
  time: string | null;
};

export type TurnTraceRouting = {
  primaryIntent: string;
  triggerHandoff: boolean;
  handoffReason: string | null;
  clearPlanOffered: boolean;
  requiresBarberDisclosure: boolean;
  unknownBarberName: string | null;
  /** Intents handled in this turn, highest priority first. */
  handleNow: string[];
  /** Intents acknowledged but postponed until the primary action finishes. */
  deferred: string[];
  /** Rules from this routing object that actually changed the turn. */
  applied: string[];
  /** Closed list of tools this turn may execute. */
  allowedTools?: string[];
};

/** A tool argument that referenced an id outside the shop catalog and was dropped before execution. */
export type TurnTraceCatalogRejection = {
  tool: string;
  field: "service_id" | "service_ids" | "barber_id";
};

export type AgentTurnTrace = {
  /** Who decided the action — LLM loop by default; orchestrator when it blocks or constrains. */
  decisionOwner: "llm_tool_loop" | "orchestrator";
  conversationState: string;
  canonicalState: string | null;
  intent: TurnTraceIntent | null;
  routing: TurnTraceRouting | null;
  /** Whether a usable client name was known before the reply (memory, profile or this turn). */
  nameKnown: boolean;
  /** Where the name used for booking came from this turn, when captured now. */
  nameSource: "explicit" | "leading_address" | null;
  openai: TurnTraceOpenAiRound[];
  toolsExecuted: TurnTraceTool[];
  catalogRejections: TurnTraceCatalogRejection[];
  /** Output guard that wiped a non-empty reply. Silence beats a wrong answer. */
  silencedBy?: string;
};

export type TurnTraceOutbound = {
  status: string;
  bubbles?: number;
  providerMessageIds?: string[];
  error?: string;
};

const PREVIEW_MAX = 120;
const ERROR_MAX = 180;

export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***${digits.slice(-4)}`;
}

export function previewText(text: string | null | undefined): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  return `${flat.slice(0, PREVIEW_MAX)}…`;
}

export function previewError(error: string | null | undefined): string {
  return previewText(error).slice(0, ERROR_MAX);
}

export function logTurnTrace(fields: Record<string, unknown>): void {
  const record = {
    trace: "turn",
    at: new Date().toISOString(),
    ...fields,
  };
  console.info(JSON.stringify(record));
}
