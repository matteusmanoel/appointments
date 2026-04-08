/**
 * Benchmark runner / harness.
 *
 * Executes scenarios against the agent, collects results, and returns
 * structured ScenarioResult objects ready for evaluation.
 *
 * Supports two modes:
 * - live: calls runAgent with real OpenAI + real DB
 * - mock: returns synthetic agent replies without calling OpenAI (for CI)
 *
 * The harness creates sandbox conversations (is_sandbox=true) and cleans
 * them up after each run.
 */

import OpenAI from "openai";
import type {
  BenchmarkRun,
  BenchmarkRunMeta,
  Scenario,
  ScenarioResult,
  TurnResult,
  ViolationOccurrence,
} from "../types.js";
import { evaluateSingleTurn, checkMissingRequiredTools, evaluateConversation } from "../evaluation/deterministic.js";
import { judgeConversation, isJudgeAvailable } from "../evaluation/llm-judge.js";
import { computeScore, computeRunSummary, SCENARIO_PASS_THRESHOLD } from "../evaluation/scorer.js";
import type { BenchmarkConfig } from "../config.js";
import { DEFAULT_CONFIG } from "../config.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Mock agent (no OpenAI, for CI / offline testing)
// ---------------------------------------------------------------------------

const MOCK_REPLIES: Record<string, string> = {
  default: "Olá! Posso ajudar com agendamento ou informações sobre nossos serviços. O que você prefere?",
  booking: "Perfeito! Vou verificar a disponibilidade pra você.",
  greeting: "Oi! Tudo certo. Quer ver os serviços ou já agendar um horário?",
  cancellation: "Entendido. Vou verificar seu agendamento e cancelar pra você.",
  handoff: "Claro! Um atendente vai te atender em instantes.",
  "out-of-scope": "Aqui a gente cuida de barba e corte de cabelo. Posso ajudar com agendamento?",
};

function getMockReply(scenario: Scenario, turnIndex: number): string {
  const tag = scenario.tags[0] ?? "default";
  if (turnIndex === 0 && scenario.tags.includes("greeting")) return MOCK_REPLIES.greeting;
  return MOCK_REPLIES[tag] ?? MOCK_REPLIES.default;
}

// ---------------------------------------------------------------------------
// DB helpers (dynamic import to avoid loading pool when not needed)
// ---------------------------------------------------------------------------

async function createSandboxConversation(barbershopId: string, prefix: string): Promise<string> {
  const { pool } = await import("../../src/db.js");
  const external = `${prefix}${Date.now()}-${randomUUID().slice(0, 8)}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations
       (barbershop_id, channel, external_thread_id, is_sandbox)
     VALUES ($1, 'whatsapp', $2, true)
     RETURNING id`,
    [barbershopId, external]
  );
  return r.rows[0].id;
}

async function insertUserMessage(conversationId: string, content: string): Promise<void> {
  const { pool } = await import("../../src/db.js");
  await pool.query(
    `INSERT INTO public.ai_messages (conversation_id, role, content)
     VALUES ($1, 'user', $2)`,
    [conversationId, content]
  );
}

async function cleanupHarnessConversations(prefix: string): Promise<number> {
  const { pool } = await import("../../src/db.js");
  const r = await pool.query(
    `DELETE FROM public.ai_conversations
     WHERE external_thread_id LIKE $1`,
    [`${prefix}%`]
  );
  return r.rowCount ?? 0;
}

async function getBarbershopId(): Promise<string> {
  const { pool } = await import("../../src/db.js");
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1`
  );
  if (!r.rows[0]) throw new Error("No barbershop found — run seed first.");
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// Tool call extraction from agent result
// ---------------------------------------------------------------------------

/**
 * The agent doesn't currently return tool call names in AgentResult.
 * We infer them from the ai_messages table (tool role rows) created during the run.
 * In mock mode, returns an empty array.
 */
async function extractToolCallsForConversation(conversationId: string): Promise<string[]> {
  try {
    const { pool } = await import("../../src/db.js");
    const r = await pool.query<{ tool_name: string }>(
      `SELECT DISTINCT tool_name FROM public.ai_messages
       WHERE conversation_id = $1 AND role = 'tool' AND tool_name IS NOT NULL`,
      [conversationId]
    );
    return r.rows.map((row) => row.tool_name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Single scenario runner
// ---------------------------------------------------------------------------

export interface RunScenarioOptions {
  mode: "live" | "mock";
  barbershopId: string;
  openai?: OpenAI;
  config: BenchmarkConfig;
  enableJudge: boolean;
}

export async function runScenario(
  scenario: Scenario,
  opts: RunScenarioOptions
): Promise<ScenarioResult> {
  const { mode, barbershopId, openai, config, enableJudge } = opts;

  let conversationId: string | null = null;
  const turnResults: TurnResult[] = [];
  const userMessages: string[] = [];
  const agentReplies: string[] = [];

  try {
    if (mode === "live") {
      conversationId = await createSandboxConversation(barbershopId, config.harnessConversationPrefix);
    }

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      userMessages.push(turn.content);

      const turnStart = Date.now();
      let agentReply = "";
      let agentState: string | undefined;
      let usage: TurnResult["usage"] | undefined;
      let toolsCalled: string[] = [];

      if (mode === "live" && conversationId && openai) {
        await insertUserMessage(conversationId, turn.content);

        const { runAgent } = await import("../../src/ai/agent.js");
        let result: Awaited<ReturnType<typeof runAgent>>;
        try {
          result = await runAgent(barbershopId, conversationId, config.harnessFromPhone, openai);
        } catch (err) {
          // OpenAI / DB error on this turn — record as error and stop
          const errMsg = (err as Error).message ?? String(err);
          const scenarioSoFar = scenario.id;
          throw Object.assign(new Error(`Turn ${i} error in ${scenarioSoFar}: ${errMsg}`), { turnIndex: i });
        }

        agentReply = result.reply ?? "";
        agentState = result.state;

        if (result.usage) {
          usage = {
            promptTokens: result.usage.prompt_tokens ?? 0,
            completionTokens: result.usage.completion_tokens ?? 0,
            totalTokens: result.usage.total_tokens ?? 0,
          };
        }

        toolsCalled = await extractToolCallsForConversation(conversationId);
      } else {
        // Mock mode
        agentReply = getMockReply(scenario, i);
        agentState = undefined;
        toolsCalled = [];
      }

      agentReplies.push(agentReply);

      const elapsed = Date.now() - turnStart;

      // Single-turn deterministic violations
      const singleViolations = evaluateSingleTurn(agentReply, agentState).map((v) => ({
        ...v,
        turnIndex: i,
      }));

      // Custom scenario asserts for this turn
      const assertFailures: ScenarioResult["assertFailures"] = [];
      let assertsPassed = true;
      for (const assert of scenario.expected.asserts ?? []) {
        const passed = assert.check(i, agentReply, agentState);
        if (!passed) {
          assertsPassed = false;
          assertFailures.push({ name: assert.name, turnIndex: i, severity: assert.severity });
        }
      }

      turnResults.push({
        turnIndex: i,
        userMessage: turn.content,
        agentReply,
        agentState,
        toolsCalled,
        violations: singleViolations,
        usage,
        elapsedMs: elapsed,
      });

      if (turn.delay_ms && mode === "live") {
        await sleep(turn.delay_ms);
      }
    }

    // Multi-turn violations
    const allViolations = evaluateConversation({
      turnResults,
      userMessages,
      agentReplies,
    });

    // Check missing required tools
    const allToolsCalled = turnResults.flatMap((t) => t.toolsCalled);
    const requiredTools = scenario.expected.mustCallTools ?? [];
    const { missing: missingTools } = checkMissingRequiredTools(allToolsCalled, requiredTools);
    if (missingTools.length > 0) {
      allViolations.push({
        type: "missing_required_tool",
        severity: "medium",
        turnIndex: turnResults.length - 1,
        excerpt: `Required tools not called: ${missingTools.join(", ")}`,
      });
    }

    // Check no-violation expectations from scenario
    const forbiddenViolations = scenario.expected.noViolations ?? [];
    const additionalViolations = allViolations.filter((v) =>
      forbiddenViolations.includes(v.type)
    );

    // Task completion check
    const lastTurn = turnResults[turnResults.length - 1];
    const taskCompleted = checkTaskCompletion(scenario, lastTurn?.agentState);

    // LLM Judge (only in live mode with judge enabled)
    let judge = undefined;
    if (mode === "live" && enableJudge && isJudgeAvailable() && openai) {
      try {
        judge = await judgeConversation(turnResults, {
          openai,
          timeoutMs: config.judgeTimeoutMs,
        });
      } catch (e) {
        console.warn(`[judge] Failed for scenario ${scenario.id}:`, (e as Error).message);
      }
    }

    // Score computation
    const scoreBreakdown = computeScore({
      violations: allViolations,
      judge,
      taskCompleted,
      turns: turnResults,
      requiredTools,
    });

    // Assert failures — compile all
    const allAssertFailures: ScenarioResult["assertFailures"] = [];
    let finalAssertsPassed = true;
    for (let i = 0; i < scenario.turns.length; i++) {
      for (const assert of scenario.expected.asserts ?? []) {
        const reply = agentReplies[i] ?? "";
        const state = turnResults[i]?.agentState;
        const passed = assert.check(i, reply, state);
        if (!passed) {
          finalAssertsPassed = false;
          allAssertFailures.push({ name: assert.name, turnIndex: i, severity: assert.severity });
        }
      }
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      tags: scenario.tags,
      turns: turnResults,
      taskCompleted,
      allViolations,
      judge,
      score: scoreBreakdown.final,
      scoreBreakdown,
      assertsPassed: finalAssertsPassed,
      assertFailures: allAssertFailures,
      totalTokens: turnResults.reduce((acc, t) => acc + (t.usage?.totalTokens ?? 0), 0),
      totalElapsedMs: turnResults.reduce((acc, t) => acc + t.elapsedMs, 0),
    };
  } finally {
    // Cleanup is done in bulk by the main runner
  }
}

function checkTaskCompletion(scenario: Scenario, lastState?: string): boolean {
  const expectedState = scenario.expected.finalState;
  if (!expectedState || expectedState === "none") return true;
  return lastState === expectedState;
}

// ---------------------------------------------------------------------------
// Full benchmark runner
// ---------------------------------------------------------------------------

export interface RunBenchmarkOptions {
  scenarios: Scenario[];
  mode: "live" | "mock";
  enableJudge?: boolean;
  config?: BenchmarkConfig;
  filterTags?: string[];
  commitSha?: string;
  promptVersion?: string;
}

export async function runBenchmark(opts: RunBenchmarkOptions): Promise<BenchmarkRun> {
  const config = opts.config ?? DEFAULT_CONFIG;
  const mode = opts.mode;
  const enableJudge = opts.enableJudge ?? (mode === "live" && config.enableJudge);

  const runId = randomUUID();
  const runAt = new Date().toISOString();

  let openai: OpenAI | undefined;
  let barbershopId = "mock-barbershop";

  if (mode === "live") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for live mode");
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    barbershopId = await getBarbershopId();
  }

  const meta: BenchmarkRunMeta = {
    runId,
    runAt,
    mode,
    commitSha: opts.commitSha,
    promptVersion: opts.promptVersion,
    judgeEnabled: enableJudge,
    filterTags: opts.filterTags as any,
    totalScenarios: opts.scenarios.length,
  };

  console.log(`\n🔬 Benchmark run ${runId}`);
  console.log(`   Mode: ${mode} | Scenarios: ${opts.scenarios.length} | Judge: ${enableJudge}`);
  console.log(`   Started: ${runAt}\n`);

  const scenarioResults: ScenarioResult[] = [];

  for (const scenario of opts.scenarios) {
    const label = `[${scenario.id}] ${scenario.name}`;
    process.stdout.write(`  → ${label}... `);

    try {
      const result = await runScenario(scenario, {
        mode,
        barbershopId,
        openai,
        config,
        enableJudge,
      });

      scenarioResults.push(result);

      const status = result.score >= config.scenarioPassThreshold ? "✓" : "✗";
      const violations =
        result.allViolations.length > 0 ? ` (${result.allViolations.length}v)` : "";
      console.log(`${status} score=${result.score}${violations}`);
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
      // Push a failed result so the run doesn't silently drop scenarios
      scenarioResults.push(makeErrorResult(scenario, (err as Error).message));
    }

    if (config.maxParallel === 1 && config.turnDelayMs > 0 && mode === "live") {
      await sleep(config.turnDelayMs);
    }
  }

  // Cleanup harness conversations
  if (mode === "live") {
    try {
      const cleaned = await cleanupHarnessConversations(config.harnessConversationPrefix);
      if (cleaned > 0) {
        console.log(`\n  Cleaned up ${cleaned} harness conversation(s).`);
      }
    } catch (e) {
      console.warn("  Cleanup warning:", (e as Error).message);
    }

    // Close pool
    try {
      const { pool } = await import("../../src/db.js");
      await pool.end();
    } catch {}
  }

  const summary = computeRunSummary(scenarioResults, config.scenarioPassThreshold);

  console.log(`\n📊 Results:`);
  console.log(`   Passed: ${summary.passedScenarios}/${meta.totalScenarios}`);
  console.log(`   Avg score: ${summary.avgScore}`);
  console.log(`   Critical violations: ${summary.criticalViolations}`);
  if (summary.avgJudgeScore !== undefined) {
    console.log(`   Avg judge score: ${summary.avgJudgeScore}`);
  }

  return { meta, summary, scenarios: scenarioResults };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeErrorResult(scenario: Scenario, errorMsg: string): ScenarioResult {
  const zeroBreakdown = {
    base: 100,
    criticalPenalty: 100,
    mediumPenalty: 0,
    lightPenalty: 0,
    qualityBonus: 0,
    taskCompletionBonus: 0,
    toolEfficiencyBonus: 0,
    costPenalty: 0,
    final: 0,
    cappedByCritical: true,
  };
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    tags: scenario.tags,
    turns: [],
    taskCompleted: false,
    allViolations: [],
    score: 0,
    scoreBreakdown: zeroBreakdown,
    assertsPassed: false,
    assertFailures: [{ name: `Runtime error: ${errorMsg}`, turnIndex: -1, severity: "critical" }],
    totalTokens: 0,
    totalElapsedMs: 0,
  };
}
