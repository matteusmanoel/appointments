import type { ConversationState, IntentSet, IntentType } from "../types.js";
import { CRITICAL_CASES, UNDERSTANDING_CASES, type CriticalCase, type UnderstandingCase } from "./understanding-dataset.js";

export type Interpreter = (text: string, state: ConversationState) => Pick<IntentSet, "primary" | "intents">;

export type UnderstandingScore = {
  total: number;
  correct: number;
  byIntent: Record<string, { total: number; correct: number }>;
  misses: Array<{ text: string; expected: IntentType; got: IntentType; line?: number }>;
  criticalViolations: Array<{ text: string; mustNot: IntentType; got: IntentType[] }>;
};

function matches(expected: IntentType, result: Pick<IntentSet, "primary" | "intents">): boolean {
  if (expected === "unknown") return result.primary === "unknown";
  return result.primary === expected || result.intents.includes(expected);
}

export function scoreUnderstanding(
  interpret: Interpreter,
  cases: UnderstandingCase[] = UNDERSTANDING_CASES,
  critical: CriticalCase[] = CRITICAL_CASES,
): UnderstandingScore {
  const score: UnderstandingScore = { total: 0, correct: 0, byIntent: {}, misses: [], criticalViolations: [] };
  for (const item of cases) {
    const result = interpret(item.text, item.state ?? "idle");
    const bucket = (score.byIntent[item.expected] ??= { total: 0, correct: 0 });
    score.total += 1;
    bucket.total += 1;
    if (matches(item.expected, result)) {
      score.correct += 1;
      bucket.correct += 1;
    } else {
      score.misses.push({ text: item.text, expected: item.expected, got: result.primary, line: item.line });
    }
  }
  for (const item of critical) {
    const result = interpret(item.text, item.state ?? "idle");
    if (result.primary === item.mustNot || result.intents.includes(item.mustNot)) {
      score.criticalViolations.push({ text: item.text, mustNot: item.mustNot, got: result.intents });
    }
  }
  return score;
}
