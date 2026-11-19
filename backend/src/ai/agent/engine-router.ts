/**
 * Escolhe o motor do turno. A barbearia define o padrão e cada conversa fica no motor em que começou.
 */
import type OpenAI from "openai";
import { pool } from "../../db.js";
import { runAgent, type AgentResult, type RunAgentOptions } from "../agent.js";
import { runAgentV2 } from "./v2/engine.js";

export type AgentEngine = "legacy" | "v2";

export async function resolveAgentEngine(barbershopId: string, conversationId: string): Promise<AgentEngine> {
  const row = await pool.query<{ engine: AgentEngine | null }>(
    `INSERT INTO public.ai_conversation_runtime (conversation_id, agent_engine, updated_at)
     SELECT $1, COALESCE((SELECT agent_engine FROM public.barbershop_ai_settings WHERE barbershop_id = $2), 'legacy'), now()
     ON CONFLICT (conversation_id) DO UPDATE
       SET agent_engine = COALESCE(public.ai_conversation_runtime.agent_engine, EXCLUDED.agent_engine)
     RETURNING agent_engine AS engine`,
    [conversationId, barbershopId],
  );
  return row.rows[0]?.engine === "v2" ? "v2" : "legacy";
}

export async function runConversationTurn(
  barbershopId: string,
  conversationId: string,
  clientPhone: string,
  openai: OpenAI,
  options: RunAgentOptions = {},
): Promise<AgentResult> {
  const engine = await resolveAgentEngine(barbershopId, conversationId);
  if (engine === "v2") {
    return runAgentV2(barbershopId, conversationId, clientPhone, openai, {
      ...(options.persistAssistantMessages !== undefined ? { persistAssistantMessages: options.persistAssistantMessages } : {}),
    });
  }
  return runAgent(barbershopId, conversationId, clientPhone, openai, options);
}
