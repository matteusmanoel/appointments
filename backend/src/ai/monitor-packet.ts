/**
 * Agrupa fichas antes de qualquer modelo ver o texto.
 * A assinatura é estado, intenção, regras aplicadas e tools — não a frase.
 */

export type MonitorTool = { name: string; ok: boolean };

export function monitorSheetFromRow(row: {
  jobId: string;
  conversationId: string;
  at: string;
  inboundPreview: string;
  replyPreview: string;
  phoneMask: string;
  decisionOwner: string | null;
  canonicalState: string | null;
  conversationState: string | null;
  intent: { primary: string; service: string | null; time: string | null; barber: string | null } | null;
  routing: { applied: string[]; allowedTools: string[] } | null;
  toolsRequested: string[];
  toolsExecuted: MonitorTool[];
  silencedBy: string | null;
}): MonitorSheet {
  return {
    jobId: row.jobId,
    conversationId: row.conversationId,
    at: row.at,
    inboundPreview: row.inboundPreview,
    replyPreview: row.replyPreview,
    phoneMask: row.phoneMask,
    decisionOwner: row.decisionOwner,
    canonicalState: row.canonicalState,
    conversationState: row.conversationState,
    intentPrimary: row.intent?.primary ?? null,
    intentService: row.intent?.service ?? null,
    intentTime: row.intent?.time ?? null,
    intentBarber: row.intent?.barber ?? null,
    applied: row.routing?.applied ?? [],
    allowedTools: row.routing?.allowedTools ?? [],
    toolsRequested: row.toolsRequested,
    toolsExecuted: row.toolsExecuted,
    silencedBy: row.silencedBy,
  };
}

export type MonitorSheet = {
  jobId: string;
  conversationId: string;
  at: string;
  inboundPreview: string;
  replyPreview: string;
  phoneMask: string;
  decisionOwner: string | null;
  canonicalState: string | null;
  conversationState: string | null;
  intentPrimary: string | null;
  intentService: string | null;
  intentTime: string | null;
  intentBarber: string | null;
  applied: string[];
  allowedTools: string[];
  toolsRequested: string[];
  toolsExecuted: MonitorTool[];
  silencedBy: string | null;
  scenarioId?: string | null;
  priorState?: string | null;
  simulatedNow?: string | null;
};

export type LabTurn = { user: string; reply?: string };

export type LabScenario = {
  id: string;
  startedAt: string;
  turns: Array<string | LabTurn>;
  priorState?: string | null;
  simulatedNow?: string | null;
};

export type MonitorGroup = {
  signature: string;
  recurrence: "recorrente" | "pontual";
  turnCount: number;
  conversationCount: number;
  scenarioIds: string[];
  priorState: string | null;
  simulatedNow: string | null;
  realClock: string | null;
  exemplar: MonitorSheet[];
  counterexample: MonitorSheet | null;
};

export type MonitorPacket = {
  generatedAt: string;
  groupCount: number;
  omittedGroups: number;
  omitted: { signature: string; turnCount: number; conversationCount: number }[];
  groups: MonitorGroup[];
};

const MAX_GROUPS = 8;
const MAX_EXEMPLAR_TURNS = 12;

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function followsCheck(previous: MonitorSheet | undefined): boolean {
  if (!previous) return false;
  return previous.toolsExecuted.length > 0 || Boolean(previous.intentService);
}

function turnUser(turn: string | LabTurn): string {
  return typeof turn === "string" ? turn : turn.user;
}

function turnReply(turn: string | LabTurn): string {
  return typeof turn === "string" ? "" : (turn.reply ?? "");
}

export function isContractBreak(sheet: MonitorSheet, previous: MonitorSheet | undefined): boolean {
  if (sheet.silencedBy) return true;
  if (sheet.applied.includes("tool_not_in_plan")) return true;
  if (sheet.toolsExecuted.some((tool) => !tool.ok)) return true;
  return (
    followsCheck(previous) &&
    (sheet.canonicalState ?? "idle") === "idle" &&
    sheet.allowedTools.length === 0 &&
    sheet.toolsExecuted.length === 0 &&
    sheet.toolsRequested.length === 0
  );
}

export function isCandidate(sheet: MonitorSheet, previous: MonitorSheet | undefined): boolean {
  if (sheet.silencedBy) return true;
  if (sheet.applied.some((rule) => rule !== "no_recording")) return true;
  if (sheet.toolsRequested.length > 0 || sheet.toolsExecuted.length > 0) return true;
  if (
    followsCheck(previous) &&
    (sheet.canonicalState ?? "idle") === "idle" &&
    sheet.allowedTools.length === 0 &&
    sheet.toolsExecuted.length === 0 &&
    sheet.toolsRequested.length === 0
  ) {
    return true;
  }
  return false;
}

export function sheetSignature(sheet: MonitorSheet, previous: MonitorSheet | undefined): string {
  const requested = sorted(sheet.toolsRequested).join(",");
  const executed = sheet.toolsExecuted.map((tool) => `${tool.name}:${tool.ok ? "ok" : "fail"}`).join(",");
  return [
    sheet.canonicalState ?? "none",
    sheet.intentPrimary ?? "none",
    sorted(sheet.applied).join(",") || "none",
    sheet.silencedBy ?? "none",
    requested || "none",
    executed || "none",
    followsCheck(previous) ? "after_check" : "fresh",
  ].join("|");
}

export function attachLabContext(sheets: MonitorSheet[], scenarios: LabScenario[]): MonitorSheet[] {
  const ordered = [...scenarios].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return sheets.map((sheet) => {
    const index = ordered.findIndex((scenario, position) => {
      const next = ordered[position + 1];
      if (sheet.at < scenario.startedAt) return false;
      if (next && sheet.at >= next.startedAt) return false;
      return scenario.turns.some((turn) => turnUser(turn).trim() === sheet.inboundPreview.trim());
    });
    const scenario = index >= 0 ? ordered[index] : undefined;
    if (!scenario) return sheet;
    const matched = scenario.turns.find((turn) => turnUser(turn).trim() === sheet.inboundPreview.trim());
    const recoveredReply = matched ? turnReply(matched) : "";
    return {
      ...sheet,
      replyPreview: sheet.replyPreview || recoveredReply,
      scenarioId: scenario.id,
      priorState: scenario.priorState ?? null,
      simulatedNow: scenario.simulatedNow ?? null,
    };
  });
}

function threadOf(sheets: MonitorSheet[], conversationId: string): MonitorSheet[] {
  return sheets
    .filter((sheet) => sheet.conversationId === conversationId)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, MAX_EXEMPLAR_TURNS);
}

export function selectMonitorPacket(sheets: MonitorSheet[], now = new Date().toISOString()): MonitorPacket {
  const ordered = [...sheets].sort((a, b) => a.at.localeCompare(b.at));
  const previousByJob = new Map<string, MonitorSheet | undefined>();
  const lastByConversation = new Map<string, MonitorSheet>();
  for (const sheet of ordered) {
    previousByJob.set(sheet.jobId, lastByConversation.get(sheet.conversationId));
    lastByConversation.set(sheet.conversationId, sheet);
  }

  const buckets = new Map<string, MonitorSheet[]>();
  for (const sheet of ordered) {
    const previous = previousByJob.get(sheet.jobId);
    if (!isCandidate(sheet, previous)) continue;
    const key = sheetSignature(sheet, previous);
    const list = buckets.get(key) ?? [];
    list.push(sheet);
    buckets.set(key, list);
  }

  const ranked = [...buckets.entries()]
    .map(([signature, turns]) => {
      const conversations = new Set(turns.map((turn) => turn.conversationId));
      const breaks = turns.filter((turn) => isContractBreak(turn, previousByJob.get(turn.jobId))).length;
      const silenced = turns.filter((turn) => turn.silencedBy).length;
      return { signature, turns, conversationCount: conversations.size, breaks, silenced };
    })
    .sort(
      (a, b) =>
        b.breaks - a.breaks ||
        b.silenced - a.silenced ||
        b.conversationCount - a.conversationCount ||
        b.turns.length - a.turns.length ||
        a.signature.localeCompare(b.signature),
    );

  const kept = ranked.slice(0, MAX_GROUPS);
  const candidates = new Set(kept.flatMap((group) => group.turns.map((turn) => turn.jobId)));

  const groups: MonitorGroup[] = kept.map((group) => {
    const exemplarConversation = group.turns[0]?.conversationId ?? "";
    const scenarios = [...new Set(group.turns.map((turn) => turn.scenarioId).filter((id): id is string => Boolean(id)))];
    const withPrior = group.turns.find((turn) => turn.priorState);
    const intent = group.turns[0]?.intentPrimary ?? null;
    const counterexample =
      ordered.find(
        (sheet) =>
          !candidates.has(sheet.jobId) &&
          sheet.intentPrimary === intent &&
          sheet.conversationId !== exemplarConversation &&
          !isCandidate(sheet, previousByJob.get(sheet.jobId)),
      ) ?? null;
    return {
      signature: group.signature,
      recurrence: group.conversationCount >= 2 ? "recorrente" : "pontual",
      turnCount: group.turns.length,
      conversationCount: group.conversationCount,
      scenarioIds: scenarios,
      priorState: withPrior?.priorState ?? null,
      simulatedNow: withPrior?.simulatedNow ?? null,
      realClock: group.turns[0]?.at ?? null,
      exemplar: threadOf(ordered, exemplarConversation),
      counterexample,
    };
  });

  return {
    generatedAt: now,
    groupCount: groups.length,
    omittedGroups: Math.max(0, ranked.length - groups.length),
    omitted: ranked.slice(MAX_GROUPS).map((group) => ({
      signature: group.signature,
      turnCount: group.turns.length,
      conversationCount: group.conversationCount,
    })),
    groups,
  };
}
