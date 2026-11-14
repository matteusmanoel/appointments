import { pool } from "../../db.js";

export const SIMULATOR_TRACE_FLAG = "AI_SIMULATOR_TRACE_ENABLED";

export type SimulatorToolTrace = {
  name: string;
  ok: boolean;
  args?: unknown;
  result?: unknown;
};

export type SimulatorExposureTrace = {
  before: string;
  after: string;
  changed: boolean;
};

export type SimulatorTurnTrace = {
  barbershopId: string;
  conversationId: string;
  turnIndex: number;
  simulatedNow?: string | null;
  userMessage: string;
  intent: unknown;
  draft: unknown;
  tools: SimulatorToolTrace[];
  finalReply: string;
  aiExposure: SimulatorExposureTrace | null;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export function isSimulatorTraceEnabled(): boolean {
  const raw = (process.env[SIMULATOR_TRACE_FLAG] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function setSimulatorTraceEnabled(on: boolean): void {
  if (on) process.env[SIMULATOR_TRACE_FLAG] = "true";
  else delete process.env[SIMULATOR_TRACE_FLAG];
}

function truncateJson(value: unknown, max = 8000): unknown {
  try {
    const text = JSON.stringify(value);
    if (text && text.length > max) return { truncated: true, preview: text.slice(0, max) };
    return value ?? null;
  } catch {
    return { unserializable: true };
  }
}

export async function saveSimulatorTurnTrace(trace: SimulatorTurnTrace): Promise<string | null> {
  if (!isSimulatorTraceEnabled()) return null;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_simulator_turn_traces (
       barbershop_id, conversation_id, turn_index, simulated_now,
       user_message, intent, draft, tools, final_reply, ai_exposure,
       latency_ms, prompt_tokens, completion_tokens, total_tokens
     ) VALUES (
       $1, $2, $3, $4::timestamptz,
       $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb,
       $11, $12, $13, $14
     ) RETURNING id`,
    [
      trace.barbershopId,
      trace.conversationId,
      trace.turnIndex,
      trace.simulatedNow ?? null,
      trace.userMessage,
      JSON.stringify(truncateJson(trace.intent)),
      JSON.stringify(truncateJson(trace.draft)),
      JSON.stringify(truncateJson(trace.tools)),
      trace.finalReply,
      trace.aiExposure ? JSON.stringify(truncateJson(trace.aiExposure)) : null,
      trace.latencyMs,
      trace.promptTokens,
      trace.completionTokens,
      trace.totalTokens,
    ],
  );
  return r.rows[0]?.id ?? null;
}

export function formatSimulatorTurn(trace: SimulatorTurnTrace, phoneMasked: string): string {
  const when = trace.simulatedNow ? ` · ${trace.simulatedNow}` : "";
  const intent =
    trace.intent && typeof trace.intent === "object"
      ? JSON.stringify(trace.intent)
      : String(trace.intent ?? "—");
  const draft =
    trace.draft && typeof trace.draft === "object"
      ? JSON.stringify(trace.draft)
      : String(trace.draft ?? "—");
  const tools = (trace.tools ?? [])
    .map((t) => {
      const args = t.args !== undefined ? `  args=${JSON.stringify(t.args)}` : "";
      const result = t.result !== undefined ? `  result=${JSON.stringify(t.result)}` : "";
      return `  - ${t.name} ${t.ok ? "ok" : "erro"}${args}${result}`;
    })
    .join("\n");
  const exposure = !trace.aiExposure
    ? "  (sem alteração)"
    : trace.aiExposure.changed
      ? `  antes: ${trace.aiExposure.before}\n  depois: ${trace.aiExposure.after}`
      : "  (sem alteração)";
  const reply = (trace.finalReply || "(vazio)").replace(/\[\[MSG\]\]/g, "\n  ");
  return [
    `── turno ${trace.turnIndex}${when} · ${phoneMasked}`,
    `cliente: ${trace.userMessage}`,
    `intent:  ${intent}`,
    `rascunho: ${draft}`,
    `tools:`,
    tools || "  (nenhuma)",
    `resposta:`,
    `  ${reply}`,
    `ai_exposure:`,
    exposure,
    `latência: ${trace.latencyMs} ms · tokens: ${trace.promptTokens}/${trace.completionTokens} (total ${trace.totalTokens})`,
  ].join("\n");
}
