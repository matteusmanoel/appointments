/**
 * Mede o interpretador por LLM na base rotulada, com chamadas reais à OpenAI.
 *   npm run eval:understanding
 * Não grava no banco e não envia mensagens.
 */
import "../load-env.js";
import OpenAI from "openai";
import { CRITICAL_CASES, UNDERSTANDING_CASES } from "../ai/agent/eval/understanding-dataset.js";
import { interpretTurnWithOpenAI, type InterpretTurnInput, type TurnInterpretation } from "../ai/agent/turn-interpreter.js";
import { scoreUnderstanding } from "../ai/agent/eval/understanding-eval.js";

const services = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Corte masculino" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Barba completa" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Corte e Barba" },
];
const barbers = [
  { id: "44444444-4444-4444-8444-444444444444", name: "Lucas Lima" },
  { id: "55555555-5555-4555-8555-555555555555", name: "Eduardo Gustavo" },
];
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY não definida.");
  const openai = new OpenAI({ apiKey });
  const items = [
    ...UNDERSTANDING_CASES.map((item) => ({ text: item.text, state: item.state ?? "idle" })),
    ...CRITICAL_CASES.map((item) => ({ text: item.text, state: item.state ?? "idle" })),
  ];
  const answers = new Map<string, TurnInterpretation | null>();
  const latencies: number[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let failures = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      const reminderOpen = item.state === "reminder_24h_pending";
      const input: InterpretTurnInput = {
        text: item.text,
        history: reminderOpen
          ? [{ role: "assistant", content: "Seu horário está reservado para amanhã às 18h. Você confirma sua presença?" }]
          : [],
        state: item.state,
        openFacts: reminderOpen ? ["Lembrete de presença em aberto para amanhã às 18h."] : [],
        todayIso: "2026-11-18",
        nowHHmm: "10:00",
        calendar: "hoje: quarta 2026-11-18; amanhã: quinta 2026-11-19; sexta 2026-11-20; sábado 2026-11-21",
        services,
        barbers,
      };
      const result = await interpretTurnWithOpenAI(openai, input, { timeoutMs: 20_000 });
      answers.set(`${item.state}:${item.text}`, result.interpretation);
      latencies.push(result.latencyMs);
      tokensIn += result.usage?.prompt_tokens ?? 0;
      tokensOut += result.usage?.completion_tokens ?? 0;
      if (!result.interpretation) failures += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const score = scoreUnderstanding((text, state) => {
    const answer = answers.get(`${state}:${text}`);
    return answer ?? { primary: "unknown", intents: ["unknown"] };
  });
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const cost = (tokensIn * 0.1 + tokensOut * 0.5) / 1_000_000;
  console.log(JSON.stringify({
    correct: score.correct,
    total: score.total,
    accuracy: Number(((score.correct / score.total) * 100).toFixed(1)),
    criticalViolations: score.criticalViolations,
    failures,
    p95Ms: p95,
    costUsd: Number(cost.toFixed(4)),
    byIntent: score.byIntent,
    misses: score.misses,
  }, null, 1));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
