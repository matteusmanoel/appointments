import { pool } from "../../db.js";
import { maskPhone } from "../turn-trace.js";

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


export const SIMULATOR_TRACE_TTL_DAYS = 7;

function maskPhonesInText(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{8,}\d/g, (match) => maskPhone(match));
}

export function maskSimulatorTraceValue(value: unknown): unknown {
  if (typeof value === "string") return maskPhonesInText(value);
  if (Array.isArray(value)) return value.map(maskSimulatorTraceValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/(phone|telefone|external_thread)/i.test(key) && typeof val === "string") {
        out[key] = maskPhone(val);
      } else {
        out[key] = maskSimulatorTraceValue(val);
      }
    }
    return out;
  }
  return value;
}

export async function purgeExpiredSimulatorTurnTraces(
  olderThanDays = SIMULATOR_TRACE_TTL_DAYS,
): Promise<number> {
  const days = Number.isFinite(olderThanDays) && olderThanDays > 0 ? olderThanDays : SIMULATOR_TRACE_TTL_DAYS;
  const r = await pool.query(
    `DELETE FROM public.ai_simulator_turn_traces WHERE created_at < now() - ($1::int * interval '1 day')`,
    [days],
  );
  return r.rowCount ?? 0;
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
      maskPhonesInText(trace.userMessage),
      JSON.stringify(truncateJson(maskSimulatorTraceValue(trace.intent))),
      JSON.stringify(truncateJson(maskSimulatorTraceValue(trace.draft))),
      JSON.stringify(truncateJson(maskSimulatorTraceValue(trace.tools))),
      maskPhonesInText(trace.finalReply ?? ""),
      trace.aiExposure ? JSON.stringify(truncateJson(maskSimulatorTraceValue(trace.aiExposure))) : null,
      trace.latencyMs,
      trace.promptTokens,
      trace.completionTokens,
      trace.totalTokens,
    ],
  );
  const id = r.rows[0]?.id ?? null;
  await purgeExpiredSimulatorTurnTraces().catch(() => undefined);
  return id;
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
    `cliente: ${maskPhonesInText(trace.userMessage)}`,
    `intent:  ${intent}`,
    `rascunho: ${draft}`,
    `tools:`,
    tools || "  (nenhuma)",
    `resposta:`,
    `  ${maskPhonesInText(reply)}`,
    `ai_exposure:`,
    exposure,
    `latência: ${trace.latencyMs} ms · tokens: ${trace.promptTokens}/${trace.completionTokens} (total ${trace.totalTokens})`,
  ].join("\n");
}
