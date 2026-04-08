/**
 * Core types for the benchmark & refinement system.
 * Production agent code must NOT depend on these types — this is a one-way dependency.
 */

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ScenarioTag =
  | "greeting"
  | "booking"
  | "cancellation"
  | "reschedule"
  | "out-of-scope"
  | "memory"
  | "handoff"
  | "follow-up"
  | "reactivation"
  | "no-show"
  | "waitlist"
  | "debt"
  | "edge"
  | "plans"
  | "multi-turn";

export interface ScenarioTurn {
  role: "user";
  content: string;
  /** Optional pause between turns (ms) — ignored in mock mode */
  delay_ms?: number;
}

export interface ScenarioExpected {
  /** Expected final agent state after the last turn */
  finalState?: "appointment_created" | "appointment_rescheduled" | "appointment_cancelled" | "handoff_requested" | "none";
  /** Violations that MUST NOT appear in any turn */
  noViolations?: ViolationType[];
  /** Tools that MUST be called at least once across all turns */
  mustCallTools?: string[];
  /** Minimum LLM quality score (0-100) — only enforced in live mode */
  minQualityScore?: number;
  /** Custom assertion functions (deterministic, no LLM) */
  asserts?: ScenarioAssert[];
}

export interface ScenarioAssert {
  name: string;
  /** Called with each (turn index, agent reply). Return true = pass. */
  check: (turnIndex: number, reply: string, state?: string) => boolean;
  /** Severity of failure */
  severity: ViolationSeverity;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  tags: ScenarioTag[];
  turns: ScenarioTurn[];
  expected: ScenarioExpected;
  /** Vertical this scenario belongs to — future-proofing for multi-niche */
  vertical: "barbershop" | "clinic" | "beauty" | "generic";
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export type ViolationSeverity = "critical" | "medium" | "light";

export type ViolationType =
  // Critical — automatic disqualification territory
  | "ai_exposure"
  | "pre_booking_claim"
  | "past_time_suggestion"
  | "phone_ask"
  | "uuid_leak"
  // Medium — score penalty
  | "markdown_overuse"
  | "duplicate_confirmation"
  | "redundant_info_request"
  | "missing_required_tool"
  | "technical_apology"
  | "loop_detected"
  | "wrong_tool_called"
  | "ignored_context"
  // Light — small penalty
  | "excessive_emojis"
  | "message_too_long"
  | "empty_message"
  | "undesired_slang"
  | "false_closure";

export const VIOLATION_SEVERITY: Record<ViolationType, ViolationSeverity> = {
  ai_exposure: "critical",
  pre_booking_claim: "critical",
  past_time_suggestion: "critical",
  phone_ask: "critical",
  uuid_leak: "critical",
  markdown_overuse: "medium",
  duplicate_confirmation: "medium",
  redundant_info_request: "medium",
  missing_required_tool: "medium",
  technical_apology: "medium",
  loop_detected: "medium",
  wrong_tool_called: "medium",
  ignored_context: "medium",
  excessive_emojis: "light",
  message_too_long: "light",
  empty_message: "light",
  undesired_slang: "light",
  false_closure: "light",
};

export interface ViolationOccurrence {
  type: ViolationType;
  severity: ViolationSeverity;
  turnIndex: number;
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Turn-level result
// ---------------------------------------------------------------------------

export interface TurnResult {
  turnIndex: number;
  userMessage: string;
  agentReply: string;
  agentState?: string;
  toolsCalled: string[];
  violations: ViolationOccurrence[];
  /** Tokens used in this turn (undefined in mock mode) */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Judge output
// ---------------------------------------------------------------------------

export type JudgeMetric =
  | "naturalness"
  | "human_feel"
  | "tone_fit"
  | "objectivity"
  | "warmth"
  | "closing_drive"
  | "memory_use"
  | "friction_reduction"
  | "clarity"
  | "commercial_quality"
  | "conversion_probability"
  | "message_pacing";

export interface JudgeResult {
  /** Score per metric, 1-5 */
  scores: Record<JudgeMetric, number>;
  /** Overall quality score 0-100 */
  overall: number;
  /** Free-text rationale from the judge */
  rationale: string;
  /** Model used for judging */
  judgeModel: string;
  /** Version of the judge prompt — increment when prompt changes */
  judgeVersion: string;
}

// ---------------------------------------------------------------------------
// Scenario-level result
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  tags: ScenarioTag[];
  turns: TurnResult[];
  /** Whether the expected finalState was achieved */
  taskCompleted: boolean;
  /** All violations across all turns */
  allViolations: ViolationOccurrence[];
  /** LLM judge output (undefined in mock mode or if judge disabled) */
  judge?: JudgeResult;
  /** Computed composite score 0-100 */
  score: number;
  /** Breakdown of score components */
  scoreBreakdown: ScoreBreakdown;
  /** Whether all custom asserts passed */
  assertsPassed: boolean;
  assertFailures: { name: string; turnIndex: number; severity: ViolationSeverity }[];
  /** Total tokens across all turns */
  totalTokens: number;
  totalElapsedMs: number;
}

export interface ScoreBreakdown {
  base: number;
  criticalPenalty: number;
  mediumPenalty: number;
  lightPenalty: number;
  qualityBonus: number;
  taskCompletionBonus: number;
  toolEfficiencyBonus: number;
  costPenalty: number;
  final: number;
  cappedByCritical: boolean;
}

// ---------------------------------------------------------------------------
// Run-level result (full benchmark run)
// ---------------------------------------------------------------------------

export interface BenchmarkRunMeta {
  runId: string;
  runAt: string; // ISO
  mode: "live" | "mock";
  /** Git commit sha if available */
  commitSha?: string;
  /** Prompt version sha/tag if available */
  promptVersion?: string;
  /** Whether LLM judge was enabled */
  judgeEnabled: boolean;
  /** Scenario tags used to filter this run */
  filterTags?: ScenarioTag[];
  /** Total scenarios attempted */
  totalScenarios: number;
}

export interface BenchmarkRunSummary {
  avgScore: number;
  minScore: number;
  maxScore: number;
  passedScenarios: number;
  failedScenarios: number;
  /** Scenario is "passed" when score >= this threshold */
  passThreshold: number;
  totalViolations: number;
  criticalViolations: number;
  mediumViolations: number;
  lightViolations: number;
  taskCompletionRate: number;
  avgJudgeScore?: number;
  totalTokens: number;
  avgTokensPerScenario: number;
  avgElapsedMsPerScenario: number;
  /** Top violation types by frequency */
  topViolations: { type: ViolationType; count: number }[];
}

export interface BenchmarkRun {
  meta: BenchmarkRunMeta;
  summary: BenchmarkRunSummary;
  scenarios: ScenarioResult[];
}

// ---------------------------------------------------------------------------
// Baseline comparison
// ---------------------------------------------------------------------------

export type BaselineTag = "production" | "candidate" | "archived";

export interface BaselineRecord {
  runId: string;
  tag: BaselineTag;
  savedAt: string;
  filePath: string;
  summary: BenchmarkRunSummary;
  meta: BenchmarkRunMeta;
}

export interface GateRule {
  name: string;
  description: string;
  check: (baseline: BenchmarkRunSummary, candidate: BenchmarkRunSummary) => GateRuleResult;
}

export interface GateRuleResult {
  passed: boolean;
  message: string;
  baselineValue?: number | string;
  candidateValue?: number | string;
}

export interface GateResult {
  passed: boolean;
  rules: (GateRule & GateRuleResult)[];
  recommendation: "promote" | "reject" | "manual_review";
  reason: string;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ComparisonResult {
  baselineRunId: string;
  candidateRunId: string;
  comparedAt: string;
  gate: GateResult;
  deltaAvgScore: number;
  deltaCriticalViolations: number;
  deltaTotalViolations: number;
  deltaTaskCompletionRate: number;
  deltaAvgJudgeScore?: number;
  deltaAvgTokens: number;
  regressions: { scenarioId: string; delta: number }[];
  improvements: { scenarioId: string; delta: number }[];
}

// ---------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------

export interface FailurePattern {
  violationType: ViolationType;
  severity: ViolationSeverity;
  frequency: number;
  affectedScenarios: string[];
  sampleExcerpts: string[];
}

export interface RefinementHypothesis {
  pattern: FailurePattern;
  hypothesis: string;
  suggestedInstruction: string;
  confidence: "high" | "medium" | "low";
  risk: "safe" | "moderate" | "risky";
}

export interface RefinementReport {
  runId: string;
  generatedAt: string;
  topPatterns: FailurePattern[];
  hypotheses: RefinementHypothesis[];
  /** Path to the suggestions markdown file */
  suggestionsFile: string;
}
