/**
 * LLM-as-judge evaluation layer — v2.0.0
 *
 * Foca em resultado operacional: o agente executou as ações certas, usou as ferramentas corretas,
 * devolveu resposta com contexto real da situação, e não criou loops ou violações de estado.
 *
 * Métricas de tom e naturalidade foram removidas — essas são qualidades do LLM base, não do sistema.
 * O que testamos aqui é se o SISTEMA funcionou corretamente como orquestrador de ações.
 *
 * Qualquer mudança neste prompt deve incrementar JUDGE_VERSION para invalidar comparações antigas.
 */

import OpenAI from "openai";
import type { JudgeMetric, JudgeResult, TurnResult } from "../types.js";

/** Increment this whenever the judge prompt changes. Used to invalidate stale comparisons. */
export const JUDGE_VERSION = "v2.0.0";

/** Model used for judging. Deliberately pinned and not tenant-configurable. */
const JUDGE_MODEL = "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Fixed rubric prompt — NEVER change without bumping JUDGE_VERSION
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `Você é um avaliador de sistemas de atendimento conversacional para barbearias.
Seu papel é avaliar se o AGENTE operou corretamente do ponto de vista funcional, não estilístico.

IMPORTANTE:
- Avalie apenas o comportamento operacional do AGENTE, nunca o CLIENTE.
- Não avalie tom, naturalidade, simpatia ou estilo de escrita — isso não é medido aqui.
- Seja criterioso: notas 4-5 devem ser merecidas.
- Avalie com base nas AÇÕES tomadas e no RESULTADO entregue, não nas palavras usadas.

## Métricas operacionais (escala 1-5):

1. **tool_correctness** — O agente chamou as ferramentas corretas para a situação?
   - 1: Chamou ferramentas erradas, não chamou ferramentas necessárias, ou chamou sem necessidade
   - 3: Chamou as ferramentas principais, mas faltou alguma ou chamou extra sem justificativa
   - 5: Conjunto de ferramentas exatamente correto para a situação

2. **operational_accuracy** — O resultado entregue ao cliente está correto com base no estado do sistema?
   - 1: Respondeu com informação incorreta (horário errado, serviço errado, status errado, cliente não encontrado)
   - 3: Parcialmente correto — acertou o principal mas errou detalhe
   - 5: 100% correto: data, horário, serviço, barbeiro, status, valor, nome — todos batendo com o estado real

3. **context_use** — O agente usou o contexto da conversa e do estado do sistema corretamente?
   - 1: Ignorou informações que já estavam disponíveis (horário ativo, serviço já dito, nome já capturado)
   - 3: Usou parte do contexto, perdeu algo relevante
   - 5: Aproveitou todo o contexto disponível sem perguntar nada redundante

4. **state_compliance** — O agente respeitou as regras de estado do sistema?
   - 1: Criou appointment sem confirmação, cancelou sem pedido, mudou status indevidamente
   - 3: Maioria ok, mas alguma ação prematura ou omitida
   - 5: Criou / cancelou / confirmou apenas quando devia, com as confirmações corretas

5. **loop_free** — O agente evitou loops e redundâncias?
   - 1: Perguntou a mesma coisa mais de uma vez, repetiu resposta anterior sem motivo
   - 3: Alguma repetição, mas progresso visível
   - 5: Fluxo limpo, sem redundância, cada turno avançou o estado

6. **constraint_respect** — O agente respeitou as restrições operacionais (horário de funcionamento, barbeiro pedido, serviço pedido, slot disponível)?
   - 1: Ofereceu slot inválido, trocou barbeiro sem pedido, ignorou fechamento, agendou fora do horário
   - 3: Respeitou a maioria das restrições, falhou em caso específico
   - 5: Respeitou todas as restrições: disponibilidade real, barbeiro pedido, horário de funcionamento

## Instrução de saída:

Responda APENAS com um JSON válido no seguinte formato (sem markdown, sem texto antes ou depois):

{
  "scores": {
    "tool_correctness": <1-5>,
    "operational_accuracy": <1-5>,
    "context_use": <1-5>,
    "state_compliance": <1-5>,
    "loop_free": <1-5>,
    "constraint_respect": <1-5>
  },
  "rationale": "<2-4 frases descrevendo o principal resultado operacional e onde o sistema acertou ou falhou>",
  "overall": <number 0-100>
}

O campo "overall" deve refletir a qualidade operacional da conversa (0 = falha crítica de sistema, 100 = tudo funcionou perfeitamente).`;

// ---------------------------------------------------------------------------
// Conversation formatter
// ---------------------------------------------------------------------------

function formatConversation(turns: TurnResult[]): string {
  return turns
    .map((t) => {
      const lines = [`[TURNO ${t.turnIndex + 1}]`, `CLIENTE: ${t.userMessage}`];
      if (t.toolsCalled.length > 0) {
        lines.push(`[ferramentas chamadas: ${t.toolsCalled.join(", ")}]`);
      }
      lines.push(`AGENTE: ${t.agentReply}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Judge call
// ---------------------------------------------------------------------------

export interface JudgeOptions {
  /** Pass an existing OpenAI client to avoid creating a new one */
  openai?: OpenAI;
  /** Override the default judge model */
  model?: string;
  /** Timeout in ms for the judge call */
  timeoutMs?: number;
}

export async function judgeConversation(
  turns: TurnResult[],
  options: JudgeOptions = {}
): Promise<JudgeResult> {
  const client = options.openai ?? new OpenAI();
  const model = options.model ?? JUDGE_MODEL;
  const conversationText = formatConversation(turns);

  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Avalie o resultado operacional da seguinte conversa:\n\n${conversationText}`,
        },
      ],
      response_format: { type: "json_object" },
    },
    { timeout: options.timeoutMs ?? 30_000 }
  );

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: { scores?: Record<string, number>; rationale?: string; overall?: number };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Judge returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const scores = validateScores(parsed.scores ?? {});
  const overall =
    typeof parsed.overall === "number" ? Math.max(0, Math.min(100, parsed.overall)) : computeOverall(scores);
  const rationale = parsed.rationale ?? "";

  return {
    scores,
    overall,
    rationale,
    judgeModel: model,
    judgeVersion: JUDGE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_METRICS: JudgeMetric[] = [
  "tool_correctness",
  "operational_accuracy",
  "context_use",
  "state_compliance",
  "loop_free",
  "constraint_respect",
];

function validateScores(raw: Record<string, unknown>): Record<JudgeMetric, number> {
  const scores = {} as Record<JudgeMetric, number>;
  for (const metric of ALL_METRICS) {
    const val = raw[metric];
    if (typeof val === "number" && val >= 1 && val <= 5) {
      scores[metric] = val;
    } else {
      // Default to 3 (neutral) if missing or invalid
      scores[metric] = 3;
    }
  }
  return scores;
}

/** Fallback overall score: equal-weighted average of all metrics, mapped to 0-100 */
function computeOverall(scores: Record<JudgeMetric, number>): number {
  const weights: Record<JudgeMetric, number> = {
    tool_correctness: 2.0,
    operational_accuracy: 2.0,
    context_use: 1.5,
    state_compliance: 2.0,
    loop_free: 1.0,
    constraint_respect: 1.5,
  };
  let weighted = 0;
  let totalWeight = 0;
  for (const metric of ALL_METRICS) {
    weighted += scores[metric] * weights[metric];
    totalWeight += weights[metric];
  }
  const avg = weighted / totalWeight; // 1-5
  return Math.round(((avg - 1) / 4) * 100);
}

/** Returns true if the environment is configured for live judging */
export function isJudgeAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
