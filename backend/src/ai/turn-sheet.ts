import { maskPhone, previewText, type TurnTraceIntent, type TurnTraceOutbound, type TurnTraceTool } from "./turn-trace.js";

/** Campos que a ficha pode carregar. Prompt, argumento de tool e telefone cru não entram. */
export type TurnSheetRow = {
  barbershopId: string;
  conversationId: string;
  jobId: string;
  providerEventId: string | null;
  at: string;
  inboundPreview: string;
  replyPreview: string;
  phoneMask: string;
  decisionOwner: string | null;
  canonicalState: string | null;
  conversationState: string | null;
  intent: TurnTraceIntent | null;
  routing: {
    primaryIntent: string | null;
    applied: string[];
    allowedTools: string[];
  } | null;
  toolsRequested: string[];
  toolsExecuted: TurnTraceTool[];
  silencedBy: string | null;
  outbound: TurnTraceOutbound | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim() && !out.includes(item)) out.push(item);
  }
  return out;
}

function intentOf(value: unknown): TurnTraceIntent | null {
  const row = asRecord(value);
  if (!row) return null;
  const primary = asString(row.primary);
  if (!primary) return null;
  return {
    primary,
    intents: stringList(row.intents).length ? stringList(row.intents) : [primary],
    confidence: typeof row.confidence === "number" ? row.confidence : 0,
    service: asString(row.service),
    barber: asString(row.barber),
    date: asString(row.date),
    time: asString(row.time),
  };
}

function routingOf(value: unknown): TurnSheetRow["routing"] {
  const row = asRecord(value);
  if (!row) return null;
  return {
    primaryIntent: asString(row.primaryIntent),
    applied: stringList(row.applied),
    allowedTools: stringList(row.allowedTools),
  };
}

function toolsExecutedOf(value: unknown): TurnTraceTool[] {
  if (!Array.isArray(value)) return [];
  const out: TurnTraceTool[] = [];
  for (const item of value) {
    const row = asRecord(item);
    const name = row ? asString(row.name) : null;
    if (!name) continue;
    out.push({ name, ok: row?.ok === true });
  }
  return out;
}

function toolsRequestedOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const round of value) {
    const row = asRecord(round);
    for (const name of stringList(row?.toolsRequested)) {
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

function outboundOf(value: unknown): TurnTraceOutbound | null {
  const row = asRecord(value);
  if (!row) return null;
  const status = asString(row.status);
  if (!status) return null;
  const outbound: TurnTraceOutbound = { status };
  if (typeof row.bubbles === "number") outbound.bubbles = row.bubbles;
  if (Array.isArray(row.providerMessageIds)) {
    outbound.providerMessageIds = row.providerMessageIds.filter((id): id is string => typeof id === "string");
  }
  const error = asString(row.error);
  if (error) outbound.error = previewText(error);
  return outbound;
}

/**
 * Monta a linha que vai ao banco. Ignora prompt, mensagens do modelo,
 * argumentos de tool e qualquer telefone que não seja a máscara.
 */
export function buildTurnSheetRow(input: Record<string, unknown>): TurnSheetRow | null {
  const jobId = asString(input.jobId);
  const conversationId = asString(input.conversationId);
  const barbershopId = asString(input.barbershopId);
  if (!jobId || !conversationId || !barbershopId) return null;
  const at = asString(input.at) ?? new Date().toISOString();
  return {
    barbershopId,
    conversationId,
    jobId,
    providerEventId: asString(input.providerEventId),
    at,
    inboundPreview: previewText(asString(input.inboundPreview) ?? asString(input.inbound) ?? ""),
    replyPreview: previewText(asString(input.replyPreview) ?? asString(input.reply) ?? ""),
    phoneMask: maskPhone(asString(input.phone) ?? asString(input.phoneMask) ?? ""),
    decisionOwner: asString(input.decisionOwner),
    canonicalState: asString(input.canonicalState),
    conversationState: asString(input.conversationState),
    intent: intentOf(input.intent),
    routing: routingOf(input.routing),
    toolsRequested: toolsRequestedOf(input.openai),
    toolsExecuted: toolsExecutedOf(input.toolsExecuted),
    silencedBy: asString(input.silencedBy),
    outbound: outboundOf(input.outbound),
  };
}

/** Linhas `trace:turn` do worker, fase agent. O resto do log é ignorado. */
export function parseWorkerTraceLines(text: string): TurnSheetRow[] {
  const rows: TurnSheetRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const start = line.indexOf("{");
    if (start < 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(start));
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (!record || record.trace !== "turn" || record.phase !== "agent") continue;
    const row = buildTurnSheetRow(record);
    if (row) rows.push(row);
  }
  return rows;
}
