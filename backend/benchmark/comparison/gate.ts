/**
 * Promotion gate — determines whether a candidate benchmark run is
 * safe to promote as the new production baseline.
 *
 * All gate rules must pass for promotion to be recommended.
 * Rules are configurable via GateConfig in config.ts.
 *
 * Design: explicit, transparent, no hidden logic.
 * Each rule documents what it checks, what values it compares,
 * and why it exists.
 */

import type {
  BenchmarkRunSummary,
  ComparisonResult,
  GateResult,
  GateRule,
  ScenarioResult,
} from "../types.js";
import type { GateConfig } from "../config.js";
import { DEFAULT_CONFIG } from "../config.js";

// ---------------------------------------------------------------------------
// Gate rules
// ---------------------------------------------------------------------------

function buildGateRules(cfg: GateConfig): GateRule[] {
  return [
    {
      name: "zero_new_critical_violations",
      description:
        "Candidate must not introduce new critical violations compared to baseline. " +
        "Critical violations (AI exposure, UUID leak, etc.) are automatic disqualifiers.",
      check(baseline, candidate) {
        const newCriticals = candidate.criticalViolations - baseline.criticalViolations;
        const passed = newCriticals <= cfg.maxNewCriticalViolations;
        return {
          passed,
          message: passed
            ? `No new critical violations (${candidate.criticalViolations} vs ${baseline.criticalViolations})`
            : `Candidate has ${newCriticals} new critical violation(s) — this is a hard block`,
          baselineValue: baseline.criticalViolations,
          candidateValue: candidate.criticalViolations,
        };
      },
    },
    {
      name: "total_violations_not_worse",
      description:
        "Candidate must not have significantly more total violations than baseline. " +
        `Max allowed increase: ${cfg.maxViolationDeltaIncrease}.`,
      check(baseline, candidate) {
        const delta = candidate.totalViolations - baseline.totalViolations;
        const passed = delta <= cfg.maxViolationDeltaIncrease;
        return {
          passed,
          message: passed
            ? `Total violations acceptable: ${candidate.totalViolations} vs ${baseline.totalViolations} (Δ${delta >= 0 ? "+" : ""}${delta})`
            : `Too many new violations: Δ${delta} exceeds max ${cfg.maxViolationDeltaIncrease}`,
          baselineValue: baseline.totalViolations,
          candidateValue: candidate.totalViolations,
        };
      },
    },
    {
      name: "quality_score_retained",
      description:
        `Candidate quality score (avg) must be at least ${Math.round(cfg.minQualityRetentionRatio * 100)}% of baseline. ` +
        "Applies only when both runs have LLM judge data.",
      check(baseline, candidate) {
        // If neither has judge data, skip this rule (pass)
        if (baseline.avgJudgeScore === undefined || candidate.avgJudgeScore === undefined) {
          return {
            passed: true,
            message: "Skipped — judge data not available for one or both runs",
          };
        }
        const minRequired = baseline.avgJudgeScore * cfg.minQualityRetentionRatio;
        const passed = candidate.avgJudgeScore >= minRequired;
        return {
          passed,
          message: passed
            ? `Quality retained: ${candidate.avgJudgeScore} >= ${minRequired.toFixed(1)} required`
            : `Quality regression: ${candidate.avgJudgeScore} < ${minRequired.toFixed(1)} required`,
          baselineValue: baseline.avgJudgeScore,
          candidateValue: candidate.avgJudgeScore,
        };
      },
    },
    {
      name: "task_completion_not_regressed",
      description: `Candidate task completion rate must be at least ${Math.round(cfg.minTaskCompletionRetentionRatio * 100)}% of baseline.`,
      check(baseline, candidate) {
        const minRequired = baseline.taskCompletionRate * cfg.minTaskCompletionRetentionRatio;
        const passed = candidate.taskCompletionRate >= minRequired;
        return {
          passed,
          message: passed
            ? `Task completion OK: ${(candidate.taskCompletionRate * 100).toFixed(1)}% >= ${(minRequired * 100).toFixed(1)}% required`
            : `Task completion regressed: ${(candidate.taskCompletionRate * 100).toFixed(1)}% < ${(minRequired * 100).toFixed(1)}% required`,
          baselineValue: `${(baseline.taskCompletionRate * 100).toFixed(1)}%`,
          candidateValue: `${(candidate.taskCompletionRate * 100).toFixed(1)}%`,
        };
      },
    },
    {
      name: "cost_not_exploded",
      description: `Candidate avg token cost must not exceed baseline × ${cfg.maxCostIncreaseRatio}. Prevents runaway prompt bloat.`,
      check(baseline, candidate) {
        if (baseline.avgTokensPerScenario === 0) {
          return { passed: true, message: "Skipped — no token data in baseline" };
        }
        const maxAllowed = baseline.avgTokensPerScenario * cfg.maxCostIncreaseRatio;
        const passed = candidate.avgTokensPerScenario <= maxAllowed;
        return {
          passed,
          message: passed
            ? `Token cost OK: ${candidate.avgTokensPerScenario.toFixed(0)} <= ${maxAllowed.toFixed(0)} max`
            : `Token cost too high: ${candidate.avgTokensPerScenario.toFixed(0)} > ${maxAllowed.toFixed(0)} max`,
          baselineValue: baseline.avgTokensPerScenario.toFixed(0),
          candidateValue: candidate.avgTokensPerScenario.toFixed(0),
        };
      },
    },
    {
      name: "avg_score_not_regressed",
      description: "Candidate average composite score must not be lower than baseline.",
      check(baseline, candidate) {
        // Allow a 3-point tolerance
        const tolerance = 3;
        const passed = candidate.avgScore >= baseline.avgScore - tolerance;
        return {
          passed,
          message: passed
            ? `Avg score OK: ${candidate.avgScore} >= ${baseline.avgScore - tolerance} (baseline ${baseline.avgScore} - ${tolerance}pts tolerance)`
            : `Avg score regressed: ${candidate.avgScore} < ${baseline.avgScore - tolerance} required`,
          baselineValue: baseline.avgScore,
          candidateValue: candidate.avgScore,
        };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

export function evaluateGate(
  baseline: BenchmarkRunSummary,
  candidate: BenchmarkRunSummary,
  cfg: GateConfig = DEFAULT_CONFIG.gate
): GateResult {
  const rules = buildGateRules(cfg);
  const ruleResults = rules.map((rule) => ({
    ...rule,
    ...rule.check(baseline, candidate),
  }));

  const allPassed = ruleResults.every((r) => r.passed);
  const failedRules = ruleResults.filter((r) => !r.passed);
  const criticalFailed = failedRules.some(
    (r) => r.name === "zero_new_critical_violations"
  );

  let recommendation: GateResult["recommendation"];
  let reason: string;

  if (allPassed) {
    recommendation = "promote";
    reason = "All gate rules passed — candidate is safe to promote.";
  } else if (criticalFailed) {
    recommendation = "reject";
    reason = `Hard block: ${failedRules.filter((r) => r.name === "zero_new_critical_violations").map((r) => r.message).join("; ")}`;
  } else if (failedRules.length === 1) {
    recommendation = "manual_review";
    reason = `One gate rule failed: ${failedRules[0].message}. Review before promoting.`;
  } else {
    recommendation = "reject";
    reason = `${failedRules.length} gate rules failed: ${failedRules.map((r) => r.name).join(", ")}`;
  }

  return {
    passed: allPassed,
    rules: ruleResults as GateResult["rules"],
    recommendation,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Full comparison
// ---------------------------------------------------------------------------

export function compareRuns(
  baselineRun: { meta: { runId: string }; summary: BenchmarkRunSummary; scenarios: ScenarioResult[] },
  candidateRun: { meta: { runId: string }; summary: BenchmarkRunSummary; scenarios: ScenarioResult[] },
  cfg: GateConfig = DEFAULT_CONFIG.gate
): ComparisonResult {
  const gate = evaluateGate(baselineRun.summary, candidateRun.summary, cfg);

  const deltaAvgScore = candidateRun.summary.avgScore - baselineRun.summary.avgScore;
  const deltaCriticalViolations =
    candidateRun.summary.criticalViolations - baselineRun.summary.criticalViolations;
  const deltaTotalViolations =
    candidateRun.summary.totalViolations - baselineRun.summary.totalViolations;
  const deltaTaskCompletionRate =
    candidateRun.summary.taskCompletionRate - baselineRun.summary.taskCompletionRate;
  const deltaAvgJudgeScore =
    baselineRun.summary.avgJudgeScore !== undefined &&
    candidateRun.summary.avgJudgeScore !== undefined
      ? candidateRun.summary.avgJudgeScore - baselineRun.summary.avgJudgeScore
      : undefined;
  const deltaAvgTokens =
    candidateRun.summary.avgTokensPerScenario - baselineRun.summary.avgTokensPerScenario;

  // Per-scenario regressions and improvements
  const baselineScenarioMap = new Map(
    baselineRun.scenarios.map((s) => [s.scenarioId, s.score])
  );
  const regressions: ComparisonResult["regressions"] = [];
  const improvements: ComparisonResult["improvements"] = [];

  for (const cand of candidateRun.scenarios) {
    const baseScore = baselineScenarioMap.get(cand.scenarioId);
    if (baseScore === undefined) continue;
    const delta = cand.score - baseScore;
    if (delta < -5) {
      regressions.push({ scenarioId: cand.scenarioId, delta });
    } else if (delta > 5) {
      improvements.push({ scenarioId: cand.scenarioId, delta });
    }
  }

  return {
    baselineRunId: baselineRun.meta.runId,
    candidateRunId: candidateRun.meta.runId,
    comparedAt: new Date().toISOString(),
    gate,
    deltaAvgScore,
    deltaCriticalViolations,
    deltaTotalViolations,
    deltaTaskCompletionRate,
    deltaAvgJudgeScore,
    deltaAvgTokens,
    regressions: regressions.sort((a, b) => a.delta - b.delta),
    improvements: improvements.sort((a, b) => b.delta - a.delta),
  };
}
