/**
 * Benchmark system configuration.
 *
 * These values control the behavior of the benchmark runner,
 * gate rules, and report generation. Modify here to adjust
 * thresholds globally — no need to touch individual modules.
 */

import type { ScenarioTag } from "./types.js";

export interface BenchmarkConfig {
  // Runner
  /** Conversations created with this prefix are automatically cleaned up */
  harnessConversationPrefix: string;
  /** Phone number used for synthetic client in harness runs */
  harnessFromPhone: string;
  /** Max parallel scenarios (1 = sequential, safe for rate limits) */
  maxParallel: number;
  /** Delay between turns in a scenario (ms) — only in live mode */
  turnDelayMs: number;

  // Evaluation
  /** Score threshold below which a scenario is "failed" */
  scenarioPassThreshold: number;
  /** Whether to run the LLM judge (requires OPENAI_API_KEY) */
  enableJudge: boolean;
  /** Judge call timeout in ms */
  judgeTimeoutMs: number;

  // Promotion gate — all rules must pass to promote a candidate
  gate: GateConfig;

  // Results
  /** Directory where run result JSON files are stored */
  resultsDir: string;
  /** Directory where suggestion markdown files are saved */
  suggestionsDir: string;
  /** Number of top violation patterns to include in refinement report */
  topPatternsCount: number;
}

export interface GateConfig {
  /** No new critical violations allowed in the candidate vs baseline */
  maxNewCriticalViolations: number;
  /** Delta in total violations — candidate must not have more than baseline + this */
  maxViolationDeltaIncrease: number;
  /** Candidate quality score must be at least baseline × this ratio */
  minQualityRetentionRatio: number;
  /** Candidate avg token cost must not exceed baseline × this ratio */
  maxCostIncreaseRatio: number;
  /** Candidate task completion rate must be at least baseline × this ratio */
  minTaskCompletionRetentionRatio: number;
}

export const DEFAULT_CONFIG: BenchmarkConfig = {
  harnessConversationPrefix: "bench-",
  harnessFromPhone: "5500000000000",
  maxParallel: 1,
  turnDelayMs: 200,
  scenarioPassThreshold: 60,
  enableJudge: true,
  judgeTimeoutMs: 30_000,
  gate: {
    maxNewCriticalViolations: 0,
    maxViolationDeltaIncrease: 2,
    minQualityRetentionRatio: 0.97,
    maxCostIncreaseRatio: 1.10,
    minTaskCompletionRetentionRatio: 0.95,
  },
  resultsDir: new URL("./results/", import.meta.url).pathname,
  suggestionsDir: new URL("./suggestions/", import.meta.url).pathname,
  topPatternsCount: 5,
};

/** Tags to run when no filter is specified (full regression suite) */
export const DEFAULT_TAGS: ScenarioTag[] = [];

/** Resolve config with optional overrides */
export function resolveConfig(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    gate: { ...DEFAULT_CONFIG.gate, ...overrides.gate },
  };
}
