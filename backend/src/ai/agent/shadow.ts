/**
 * Roda o interpretador por LLM ao lado do agente atual e registra as divergências.
 * Nada aqui muda a resposta ao cliente. Liga por AI_AGENT_SHADOW_BARBERSHOPS (ids separados por vírgula ou *).
 */
import type OpenAI from "openai";
import { pool } from "../../db.js";
import * as aiTools from "../tools.js";
import { addDaysIso, formatWeekCalendarForTools } from "../date-calendar.js";
import {
  interpretTurnWithOpenAI,
  type InterpretTurnInput,
  type InterpretTurnResult,
  type TurnInterpreter,
} from "./turn-interpreter.js";

export const SHADOW_RETENTION_DAYS = 30;
const SHADOW_PURGE_RATE = 0.01;

export function shadowEnabled(barbershopId: string, raw = process.env.AI_AGENT_SHADOW_BARBERSHOPS ?? ""): boolean {
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  return ids.includes("*") || ids.includes(barbershopId);
}

export type RulesVerdict = { primary: string; intents: string[] } | null;

export function verdictsAgree(rules: RulesVerdict, llm: { primary: string; intents: string[] } | null): boolean | null {
  if (!rules || !llm) return null;
  return rules.primary === llm.primary;
}

function asNamedRows(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const item = row as { id?: unknown; name?: unknown };
    return typeof item.id === "string" && typeof item.name === "string" ? [{ id: item.id, name: item.name }] : [];
  });
}

async function loadShadowInput(barbershopId: string, conversationId: string): Promise<InterpretTurnInput | null> {
  const [messages, runtime, settings, services, barbers] = await Promise.all([
    pool.query<{ role: string; content: string | null }>(
      `SELECT role, content FROM public.ai_messages
       WHERE conversation_id = $1 AND role IN ('user', 'assistant')
       ORDER BY created_at DESC LIMIT 13`,
      [conversationId],
    ),
    pool.query<{ booking_draft: { status?: string } | null }>(
      `SELECT booking_draft FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
      [conversationId],
    ),
    pool.query<{ timezone: string | null }>(
      `SELECT timezone FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
      [barbershopId],
    ),
    aiTools.listServices(barbershopId),
    aiTools.listBarbers(barbershopId),
  ]);
  const rows = messages.rows.reverse().filter((row) => row.content?.trim());
  const current = rows.at(-1);
  if (current?.role !== "user") return null;
  const timeZone = settings.rows[0]?.timezone?.includes("/") ? settings.rows[0].timezone : "America/Sao_Paulo";
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const [todayIso = addDaysIso(new Date().toISOString().slice(0, 10), 0), nowHHmm = "00:00"] = local.split(" ");
  const status = runtime.rows[0]?.booking_draft?.status;
  return {
    text: String(current.content),
    history: rows.slice(0, -1).map((row) => ({
      role: row.role === "user" ? ("user" as const) : ("assistant" as const),
      content: String(row.content),
    })),
    state: status === "offered" ? "slot_offered" : status === "awaiting_name" ? "awaiting_name" : status === "collecting" ? "collecting" : "idle",
    openFacts: [],
    todayIso,
    nowHHmm,
    calendar: formatWeekCalendarForTools(todayIso),
    services: asNamedRows(services),
    barbers: asNamedRows(barbers),
  };
}

export type TurnShadow = { finish: (rules: RulesVerdict) => Promise<void> };

const NO_SHADOW: TurnShadow = { finish: async () => undefined };

export function startTurnShadow(params: {
  barbershopId: string;
  conversationId: string;
  openai: OpenAI;
  interpret?: TurnInterpreter;
}): TurnShadow {
  if (!shadowEnabled(params.barbershopId)) return NO_SHADOW;
  const running: Promise<{ input: InterpretTurnInput; result: InterpretTurnResult } | null> = (async () => {
    const input = await loadShadowInput(params.barbershopId, params.conversationId);
    if (!input) return null;
    const interpret = params.interpret ?? ((value: InterpretTurnInput) => interpretTurnWithOpenAI(params.openai, value));
    return { input, result: await interpret(input) };
  })().catch((error) => {
    console.warn("[shadow] interpretação falhou:", error instanceof Error ? error.message : error);
    return null;
  });

  return {
    finish: async (rules) => {
      try {
        const done = await running;
        if (!done) return;
        const { input, result } = done;
        await pool.query(
          `INSERT INTO public.ai_turn_shadow
             (barbershop_id, conversation_id, user_text, conversation_state, rules, interpretation, agrees, error,
              latency_ms, prompt_tokens, completion_tokens)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            params.barbershopId,
            params.conversationId,
            input.text.slice(0, 2000),
            String(input.state),
            JSON.stringify(rules),
            JSON.stringify(result.interpretation),
            verdictsAgree(rules, result.interpretation),
            result.error ?? null,
            result.latencyMs,
            result.usage?.prompt_tokens ?? 0,
            result.usage?.completion_tokens ?? 0,
          ],
        );
        if (Math.random() < SHADOW_PURGE_RATE) {
          await pool.query(
            `DELETE FROM public.ai_turn_shadow WHERE created_at < now() - make_interval(days => $1)`,
            [SHADOW_RETENTION_DAYS],
          );
        }
      } catch (error) {
        console.warn("[shadow] registro falhou:", error instanceof Error ? error.message : error);
      }
    },
  };
}
