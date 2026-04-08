/**
 * Score composition layer.
 *
 * Combines deterministic violations, LLM judge output, task completion,
 * tool efficiency, and cost into a single 0-100 composite score.
 *
 * All weights are named constants — change here, it applies everywhere.
 */

import type {
  JudgeResult,
  ScenarioResult,
  ScoreBreakdown,
  TurnResult,
  ViolationOccurrence,
} from "../types.js";
import { VIOLATION_SEVERITY } from "../types.js";

// ---------------------------------------------------------------------------
// Scoring weights — documented and named for traceability
// ---------------------------------------------------------------------------

/** Penalty per critical violation (these are severe — agent exposed as bot, UUID leaked, etc.) */
const CRITICAL_VIOLATION_PENALTY = 25;

/** Penalty per medium violation */
const MEDIUM_VIOLATION_PENALTY = 8;

/** Penalty per light violation */
const LIGHT_VIOLATION_PENALTY = 3;

/**
 * When ANY critical violation is present, the score is capped at this value.
 * This ensures critical violations always produce a failing score.
 */
const CRITICAL_VIOLATION_CAP = 40;

/**
 * Max bonus from LLM judge quality score (0-100 → contributes up to this).
 * Weight: 25 points out of 100 base.
 */
const QUALITY_BONUS_WEIGHT = 0.25;

/**
 * Bonus for completing the primary task (e.g. appointment created, handoff done).
 * Weight: 20 points.
 */
const TASK_COMPLETION_BONUS = 20;

/**
 * Max bonus from tool efficiency. Full bonus if all required tools were called
 * and no extra/wrong tools were used.
 * Weight: 10 points.
 */
const TOOL_EFFICIENCY_MAX_BONUS = 10;

/**
 * Token cost penalty threshold: if avg tokens per turn exceeds this,
 * apply a progressive penalty.
 */
const TOKEN_COST_THRESHOLD = 1500;

/** Max cost penalty in points */
const MAX_COST_PENALTY = 5;

/** Score threshold below which a scenario is considered "failed" */
export const SCENARIO_PASS_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

export interface ScoringInput {
  violations: ViolationOccurrence[];
  judge?: JudgeResult;
  taskCompleted: boolean;
  turns: TurnResult[];
  requiredTools: string[];
}

export function computeScore(input: ScoringInput): ScoreBreakdown {
  const { violations, judge, taskCompleted, turns, requiredTools } = input;

  // Count violations by severity
  const criticals = violations.filter((v) => VIOLATION_SEVERITY[v.type] === "critical");
  const mediums = violations.filter((v) => VIOLATION_SEVERITY[v.type] === "medium");
  const lights = violations.filter((v) => VIOLATION_SEVERITY[v.type] === "light");

  const criticalPenalty = criticals.length * CRITICAL_VIOLATION_PENALTY;
  const mediumPenalty = mediums.length * MEDIUM_VIOLATION_PENALTY;
  const lightPenalty = lights.length * LIGHT_VIOLATION_PENALTY;

  // Quality bonus from LLM judge (scaled to weight)
  const qualityBonus = judge
    ? Math.round(judge.overall * QUALITY_BONUS_WEIGHT)
    : 0;

  // Task completion bonus
  const taskCompletionBonus = taskCompleted ? TASK_COMPLETION_BONUS : 0;

  // Tool efficiency bonus
  const toolEfficiencyBonus = computeToolEfficiencyBonus(turns, requiredTools);

  // Cost penalty (tokens)
  const costPenalty = computeCostPenalty(turns);

  // Raw score before caps
  const base = 100;
  const rawScore =
    base -
    criticalPenalty -
    mediumPenalty -
    lightPenalty +
    qualityBonus +
    taskCompletionBonus +
    toolEfficiencyBonus -
    costPenalty;

  // Apply critical violation cap
  const cappedByCritical = criticals.length > 0;
  const capped = cappedByCritical ? Math.min(rawScore, CRITICAL_VIOLATION_CAP) : rawScore;

  const final = Math.max(0, Math.min(100, Math.round(capped)));

  return {
    base,
    criticalPenalty,
    mediumPenalty,
    lightPenalty,
    qualityBonus,
    taskCompletionBonus,
    toolEfficiencyBonus,
    costPenalty,
    final,
    cappedByCritical,
  };
}

// ---------------------------------------------------------------------------
// Tool efficiency
// ---------------------------------------------------------------------------

function computeToolEfficiencyBonus(turns: TurnResult[], requiredTools: string[]): number {
  const calledTools = turns.flatMap((t) => t.toolsCalled);
  const calledSet = new Set(calledTools);

  if (requiredTools.length === 0) {
    // No required tools — give partial efficiency bonus if any tool was called
    return calledSet.size > 0 ? Math.round(TOOL_EFFICIENCY_MAX_BONUS * 0.5) : 0;
  }

  const missing = requiredTools.filter((t) => !calledSet.has(t)).length;
  const coverage = (requiredTools.length - missing) / requiredTools.length;
  return Math.round(TOOL_EFFICIENCY_MAX_BONUS * coverage);
}

// ---------------------------------------------------------------------------
// Cost penalty
// ---------------------------------------------------------------------------

function computeCostPenalty(turns: TurnResult[]): number {
  const totalTokens = turns.reduce((acc, t) => acc + (t.usage?.totalTokens ?? 0), 0);
  if (totalTokens === 0 || turns.length === 0) return 0;
  const avgTokensPerTurn = totalTokens / turns.length;
  if (avgTokensPerTurn <= TOKEN_COST_THRESHOLD) return 0;
  const excess = avgTokensPerTurn - TOKEN_COST_THRESHOLD;
  const penaltyFraction = Math.min(1, excess / TOKEN_COST_THRESHOLD);
  return Math.round(MAX_COST_PENALTY * penaltyFraction);
}

// ---------------------------------------------------------------------------
// Summary statistics across all scenarios
// ---------------------------------------------------------------------------

import type { BenchmarkRunSummary, ViolationType } from "../types.js";

export function computeRunSummary(
  results: ScenarioResult[],
  passThreshold = SCENARIO_PASS_THRESHOLD
): BenchmarkRunSummary {
  if (results.length === 0) {
    return emptyRunSummary(passThreshold);
  }

  const scores = results.map((r) => r.score);
  const avgScore = mean(scores);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  const passedScenarios = results.filter((r) => r.score >= passThreshold).length;
  const failedScenarios = results.length - passedScenarios;

  const allViolations = results.flatMap((r) => r.allViolations);
  const criticalViolations = allViolations.filter(
    (v) => VIOLATION_SEVERITY[v.type] === "critical"
  ).length;
  const mediumViolations = allViolations.filter(
    (v) => VIOLATION_SEVERITY[v.type] === "medium"
  ).length;
  const lightViolations = allViolations.filter(
    (v) => VIOLATION_SEVERITY[v.type] === "light"
  ).length;

  const taskCompletionRate =
    results.filter((r) => r.taskCompleted).length / results.length;

  const judgedResults = results.filter((r) => r.judge !== undefined);
  const avgJudgeScore =
    judgedResults.length > 0
      ? mean(judgedResults.map((r) => r.judge!.overall))
      : undefined;

  const totalTokens = results.reduce((acc, r) => acc + r.totalTokens, 0);
  const avgTokensPerScenario = results.length > 0 ? totalTokens / results.length : 0;

  const totalElapsedMs = results.reduce((acc, r) => acc + r.totalElapsedMs, 0);
  const avgElapsedMsPerScenario =
    results.length > 0 ? totalElapsedMs / results.length : 0;

  // Top violations by frequency
  const violationCounts: Partial<Record<ViolationType, number>> = {};
  for (const v of allViolations) {
    violationCounts[v.type] = (violationCounts[v.type] ?? 0) + 1;
  }
  const topViolations = Object.entries(violationCounts)
    .map(([type, count]) => ({ type: type as ViolationType, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    avgScore: round2(avgScore),
    minScore,
    maxScore,
    passedScenarios,
    failedScenarios,
    passThreshold,
    totalViolations: allViolations.length,
    criticalViolations,
    mediumViolations,
    lightViolations,
    taskCompletionRate: round2(taskCompletionRate),
    avgJudgeScore: avgJudgeScore !== undefined ? round2(avgJudgeScore) : undefined,
    totalTokens,
    avgTokensPerScenario: round2(avgTokensPerScenario),
    avgElapsedMsPerScenario: round2(avgElapsedMsPerScenario),
    topViolations,
  };
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyRunSummary(passThreshold: number): BenchmarkRunSummary {
  return {
    avgScore: 0,
    minScore: 0,
    maxScore: 0,
    passedScenarios: 0,
    failedScenarios: 0,
    passThreshold,
    totalViolations: 0,
    criticalViolations: 0,
    mediumViolations: 0,
    lightViolations: 0,
    taskCompletionRate: 0,
    avgJudgeScore: undefined,
    totalTokens: 0,
    avgTokensPerScenario: 0,
    avgElapsedMsPerScenario: 0,
    topViolations: [],
  };
}
