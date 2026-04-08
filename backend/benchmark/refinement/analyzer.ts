/**
 * Failure analyzer — groups violations by type, computes frequency,
 * and identifies the top failure patterns in a benchmark run.
 *
 * This is the input to the patcher module, which generates hypotheses
 * and suggested instructions for fixing each pattern.
 */

import type {
  BenchmarkRun,
  FailurePattern,
  ViolationType,
} from "../types.js";
import { VIOLATION_SEVERITY } from "../types.js";

// ---------------------------------------------------------------------------
// Pattern extraction
// ---------------------------------------------------------------------------

export function analyzeFailurePatterns(
  run: BenchmarkRun,
  topN = 5
): FailurePattern[] {
  const counters: Map<ViolationType, {
    count: number;
    scenarios: Set<string>;
    excerpts: string[];
  }> = new Map();

  for (const scenario of run.scenarios) {
    for (const violation of scenario.allViolations) {
      const existing = counters.get(violation.type);
      if (existing) {
        existing.count++;
        existing.scenarios.add(scenario.scenarioId);
        if (existing.excerpts.length < 3 && violation.excerpt) {
          existing.excerpts.push(violation.excerpt);
        }
      } else {
        counters.set(violation.type, {
          count: 1,
          scenarios: new Set([scenario.scenarioId]),
          excerpts: violation.excerpt ? [violation.excerpt] : [],
        });
      }
    }

    // Assert failures also count as patterns
    for (const fail of scenario.assertFailures) {
      const key = `assert:${fail.name}` as unknown as ViolationType;
      // We track these separately with a synthetic violation key
      // skipping here since they're scenario-specific, not type-based
    }
  }

  // Convert to FailurePattern array and sort by severity then frequency
  const patterns: FailurePattern[] = [];
  for (const [type, data] of counters.entries()) {
    patterns.push({
      violationType: type,
      severity: VIOLATION_SEVERITY[type],
      frequency: data.count,
      affectedScenarios: [...data.scenarios],
      sampleExcerpts: data.excerpts,
    });
  }

  // Sort: critical first, then by frequency
  patterns.sort((a, b) => {
    const severityOrder = { critical: 0, medium: 1, light: 2 };
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.frequency - a.frequency;
  });

  return patterns.slice(0, topN);
}

// ---------------------------------------------------------------------------
// Failed scenario listing
// ---------------------------------------------------------------------------

export interface FailedScenarioSummary {
  scenarioId: string;
  scenarioName: string;
  score: number;
  criticalViolations: number;
  topViolationTypes: ViolationType[];
  assertFailures: string[];
}

export function listFailedScenarios(
  run: BenchmarkRun,
  passThreshold: number
): FailedScenarioSummary[] {
  return run.scenarios
    .filter((s) => s.score < passThreshold)
    .map((s) => ({
      scenarioId: s.scenarioId,
      scenarioName: s.scenarioName,
      score: s.score,
      criticalViolations: s.allViolations.filter(
        (v) => VIOLATION_SEVERITY[v.type] === "critical"
      ).length,
      topViolationTypes: [
        ...new Set(s.allViolations.map((v) => v.type)),
      ].slice(0, 5),
      assertFailures: s.assertFailures.map((f) => f.name),
    }))
    .sort((a, b) => a.score - b.score);
}

// ---------------------------------------------------------------------------
// Quick wins identification
// ---------------------------------------------------------------------------

export interface QuickWin {
  scenarioId: string;
  currentScore: number;
  potentialScore: number;
  blockedBy: ViolationType[];
  reason: string;
}

/**
 * Identifies scenarios where fixing a single violation type would push
 * the score above the pass threshold — the lowest-effort fixes.
 */
export function identifyQuickWins(
  run: BenchmarkRun,
  passThreshold: number
): QuickWin[] {
  const wins: QuickWin[] = [];

  for (const scenario of run.scenarios) {
    if (scenario.score >= passThreshold) continue;

    // Group violations by type
    const byType = new Map<ViolationType, number>();
    for (const v of scenario.allViolations) {
      byType.set(v.type, (byType.get(v.type) ?? 0) + 1);
    }

    // Try removing each violation type and see if it would pass
    for (const [type, count] of byType.entries()) {
      const severity = VIOLATION_SEVERITY[type];
      const penaltyPerViolation =
        severity === "critical" ? 25 : severity === "medium" ? 8 : 3;
      const potentialGain = count * penaltyPerViolation;
      const potentialScore = Math.min(
        100,
        scenario.score + potentialGain
      );

      if (potentialScore >= passThreshold) {
        wins.push({
          scenarioId: scenario.scenarioId,
          currentScore: scenario.score,
          potentialScore,
          blockedBy: [type],
          reason: `Fixing ${count}× \`${type}\` (${severity}) would gain ${potentialGain} points`,
        });
        break; // One quick win per scenario is enough
      }
    }
  }

  return wins.sort((a, b) => b.potentialScore - a.potentialScore);
}
