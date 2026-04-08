/**
 * LLM-as-judge evaluation layer.
 *
 * Uses a fixed, versionable prompt to score agent conversations on qualitative dimensions.
 * The prompt is part of the codebase and must be updated deliberately — any change
 * should increment JUDGE_VERSION to ensure result comparability.
 *
 * This module is skipped when running in mock mode (no OpenAI key).
 */

import OpenAI from "openai";
import type { JudgeMetric, JudgeResult, TurnResult } from "../types.js";

/** Increment this whenever the judge prompt changes. Used to invalidate stale comparisons. */
export const JUDGE_VERSION = "v1.0.0";

/** Model used for judging. Deliberately pinned and not tenant-configurable. */
const JUDGE_MODEL = "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Fixed rubric prompt — NEVER change without bumping JUDGE_VERSION
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `Você é um avaliador especialista em qualidade de atendimento conversacional via WhatsApp para barbearias.

Sua tarefa é avaliar a qualidade do atendimento do AGENTE em uma conversa com um CLIENTE.

IMPORTANTE:
- Avalie apenas o comportamento do AGENTE, nunca o CLIENTE.
- Use critérios objetivos com base nas métricas definidas abaixo.
- Seja criterioso: notas 4-5 devem ser merecidas, não o padrão.
- Ignore erros do cliente ou mensagens ambíguas do cliente ao avaliar.

## Métricas de avaliação (escala 1-5):

1. **naturalness** — A conversa soa natural, como um atendente humano, ou parece robótica/engessada?
   - 1: Claramente robótico, com frases formulaicas ou padrões artificiais
   - 3: Aceitável, mas com marcadores artificiais
   - 5: Totalmente natural, indistinguível de um humano educado

2. **human_feel** — O agente cria sensação de atenção real ao cliente?
   - 1: Genérico, impessoal, poderia ser qualquer bot
   - 3: Alguma personalização ou atenção
   - 5: O cliente se sente verdadeiramente atendido

3. **tone_fit** — O tom é adequado ao perfil do cliente?
   - 1: Tom completamente inadequado (formal demais, informal demais, frio, agressivo)
   - 3: Tom ok mas não personalizado
   - 5: Tom perfeitamente calibrado ao estilo do cliente

4. **objectivity** — O agente vai ao ponto sem enrolação?
   - 1: Respostas longas, divagação, respostas irrelevantes
   - 3: Ok, às vezes prolixo
   - 5: Direto e eficiente, sem desperdício de palavras

5. **warmth** — O agente transmite calor humano e simpatia?
   - 1: Frio, mecânico
   - 3: Cordial mas sem calor
   - 5: Genuinamente simpático e acolhedor

6. **closing_drive** — O agente conduz ativamente para o fechamento (agendamento)?
   - 1: Passivo, não conduz para nada
   - 3: Às vezes conduz, às vezes perde o fio
   - 5: Conduz ativamente para o fechamento sem pressionar

7. **memory_use** — O agente usa bem o contexto da conversa sem repetir perguntas já respondidas?
   - 1: Ignora contexto, repete perguntas
   - 3: Usa contexto parcialmente
   - 5: Usa contexto de forma fluida e conveniente

8. **friction_reduction** — O agente reduz atrito e facilita o processo para o cliente?
   - 1: Cria barreiras, pede informações desnecessárias
   - 3: Neutro
   - 5: Torna tudo fácil, antecipa necessidades

9. **clarity** — As respostas são claras e fáceis de entender?
   - 1: Confuso, ambíguo, difícil de seguir
   - 3: Razoavelmente claro
   - 5: Cristalino, sem ambiguidade

10. **commercial_quality** — A conversa tem qualidade comercial? O agente valoriza os serviços?
    - 1: Sem valor comercial, neutro demais ou negativo
    - 3: Comercialmente ok
    - 5: Excelente presentação comercial sem ser invasivo

11. **conversion_probability** — Qual a probabilidade de o cliente finalizar o agendamento com base nessa interação?
    - 1: Muito improvável (cliente saiu sem clareza ou frustrado)
    - 3: Moderada
    - 5: Alta (cliente claramente comprometido)

12. **message_pacing** — O agente divide as mensagens de forma adequada? Nem muito longas nem fragmentadas demais?
    - 1: Mensagens mal dimensionadas (muito longas ou muitos fragmentos curtos)
    - 3: Dimensionamento ok
    - 5: Fracionamento perfeito para WhatsApp

## Instrução de saída:

Responda APENAS com um JSON válido no seguinte formato (sem markdown, sem texto antes ou depois):

{
  "scores": {
    "naturalness": <1-5>,
    "human_feel": <1-5>,
    "tone_fit": <1-5>,
    "objectivity": <1-5>,
    "warmth": <1-5>,
    "closing_drive": <1-5>,
    "memory_use": <1-5>,
    "friction_reduction": <1-5>,
    "clarity": <1-5>,
    "commercial_quality": <1-5>,
    "conversion_probability": <1-5>,
    "message_pacing": <1-5>
  },
  "rationale": "<2-4 frases explicando os pontos mais relevantes da avaliação>",
  "overall": <number 0-100>
}

O campo "overall" deve refletir sua avaliação holística da qualidade da conversa (0 = desastrosa, 100 = perfeita).`;

// ---------------------------------------------------------------------------
// Conversation formatter
// ---------------------------------------------------------------------------

function formatConversation(turns: TurnResult[]): string {
  return turns
    .map((t) => {
      const lines = [`[TURNO ${t.turnIndex + 1}]`, `CLIENTE: ${t.userMessage}`];
      if (t.toolsCalled.length > 0) {
        lines.push(`[ferramentas: ${t.toolsCalled.join(", ")}]`);
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
      max_tokens: 800,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Avalie a seguinte conversa de atendimento:\n\n${conversationText}`,
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
  "naturalness",
  "human_feel",
  "tone_fit",
  "objectivity",
  "warmth",
  "closing_drive",
  "memory_use",
  "friction_reduction",
  "clarity",
  "commercial_quality",
  "conversion_probability",
  "message_pacing",
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

/** Fallback overall score: weighted average of all metrics, mapped to 0-100 */
function computeOverall(scores: Record<JudgeMetric, number>): number {
  const weights: Record<JudgeMetric, number> = {
    naturalness: 1.5,
    human_feel: 1.5,
    tone_fit: 1.0,
    objectivity: 1.0,
    warmth: 1.0,
    closing_drive: 2.0,
    memory_use: 1.0,
    friction_reduction: 1.5,
    clarity: 1.0,
    commercial_quality: 1.5,
    conversion_probability: 2.0,
    message_pacing: 0.5,
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
