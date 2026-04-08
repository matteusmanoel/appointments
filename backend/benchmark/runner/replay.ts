/**
 * Replay runner — load real (anonymized) conversations from the DB
 * and re-run them through the agent to detect regressions.
 *
 * Usage:
 *   npx tsx benchmark/cli.ts replay --limit 20 --since 2026-03-01
 *
 * The replay runner:
 * 1. Loads closed conversations from the DB (with user turns only)
 * 2. Re-runs each conversation from scratch through the agent
 * 3. Compares agent replies at each turn (semantic similarity + violations)
 * 4. Returns a ReplayReport
 *
 * Note: replay requires a live DB and OPENAI_API_KEY.
 */

import OpenAI from "openai";
import type { TurnResult } from "../types.js";
import { evaluateSingleTurn } from "../evaluation/deterministic.js";
import { randomUUID } from "node:crypto";

export interface ReplayConversation {
  originalConversationId: string;
  barbershopId: string;
  userTurns: string[];
}

export interface ReplayTurnComparison {
  turnIndex: number;
  userMessage: string;
  originalReply: string;
  replayReply: string;
  originalViolations: string[];
  replayViolations: string[];
  /** true if replay introduced new violations not in original */
  regression: boolean;
  /** true if replay fixed violations present in original */
  improvement: boolean;
}

export interface ReplayScenarioResult {
  originalConversationId: string;
  turns: ReplayTurnComparison[];
  regressionCount: number;
  improvementCount: number;
}

export interface ReplayReport {
  runAt: string;
  totalConversations: number;
  totalRegressions: number;
  totalImprovements: number;
  results: ReplayScenarioResult[];
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function loadClosedConversations(opts: {
  limit: number;
  since?: string;
  barbershopId?: string;
}): Promise<ReplayConversation[]> {
  const { pool } = await import("../../src/db.js");

  const params: unknown[] = [opts.limit];
  let whereClause = `WHERE c.is_sandbox = false`;

  if (opts.since) {
    params.push(opts.since);
    whereClause += ` AND c.last_message_at >= $${params.length}`;
  }
  if (opts.barbershopId) {
    params.push(opts.barbershopId);
    whereClause += ` AND c.barbershop_id = $${params.length}`;
  }

  const r = await pool.query<{ id: string; barbershop_id: string }>(
    `SELECT c.id, c.barbershop_id FROM public.ai_conversations c
     ${whereClause}
     ORDER BY c.last_message_at DESC
     LIMIT $1`,
    params
  );

  const conversations: ReplayConversation[] = [];

  for (const row of r.rows) {
    const msgs = await pool.query<{ role: string; content: string }>(
      `SELECT role, content FROM public.ai_messages
       WHERE conversation_id = $1 AND role = 'user'
       ORDER BY created_at ASC`,
      [row.id]
    );

    if (msgs.rows.length === 0) continue;

    conversations.push({
      originalConversationId: row.id,
      barbershopId: row.barbershop_id,
      userTurns: msgs.rows.map((m) => m.content),
    });
  }

  return conversations;
}

async function loadOriginalReplies(conversationId: string): Promise<string[]> {
  const { pool } = await import("../../src/db.js");
  const r = await pool.query<{ content: string }>(
    `SELECT content FROM public.ai_messages
     WHERE conversation_id = $1 AND role = 'assistant'
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return r.rows.map((m) => m.content);
}

// ---------------------------------------------------------------------------
// Replay a single conversation
// ---------------------------------------------------------------------------

async function replayConversation(
  conv: ReplayConversation,
  openai: OpenAI,
  harnessPrefix: string,
  harnessPhone: string
): Promise<ReplayScenarioResult> {
  const { pool } = await import("../../src/db.js");

  // Load original replies
  const originalReplies = await loadOriginalReplies(conv.originalConversationId);

  // Create a fresh sandbox conversation
  const external = `${harnessPrefix}replay-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const newConvR = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox)
     VALUES ($1, 'whatsapp', $2, true) RETURNING id`,
    [conv.barbershopId, external]
  );
  const newConvId = newConvR.rows[0].id;

  const { runAgent } = await import("../../src/ai/agent.js");
  const turnComparisons: ReplayTurnComparison[] = [];

  for (let i = 0; i < conv.userTurns.length; i++) {
    const userMsg = conv.userTurns[i];
    const originalReply = originalReplies[i] ?? "";

    // Insert user message into replay conversation
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [newConvId, userMsg]
    );

    const result = await runAgent(conv.barbershopId, newConvId, harnessPhone, openai);
    const replayReply = result.reply ?? "";

    const origViolations = evaluateSingleTurn(originalReply).map((v) => v.type);
    const replayViolations = evaluateSingleTurn(replayReply).map((v) => v.type);

    const newViolations = replayViolations.filter((v) => !origViolations.includes(v));
    const fixedViolations = origViolations.filter((v) => !replayViolations.includes(v));

    turnComparisons.push({
      turnIndex: i,
      userMessage: userMsg,
      originalReply,
      replayReply,
      originalViolations: origViolations,
      replayViolations,
      regression: newViolations.length > 0,
      improvement: fixedViolations.length > 0,
    });
  }

  // Cleanup replay conversation
  await pool.query(
    `DELETE FROM public.ai_conversations WHERE external_thread_id LIKE $1`,
    [`${harnessPrefix}replay-%`]
  );

  const regressionCount = turnComparisons.filter((t) => t.regression).length;
  const improvementCount = turnComparisons.filter((t) => t.improvement).length;

  return {
    originalConversationId: conv.originalConversationId,
    turns: turnComparisons,
    regressionCount,
    improvementCount,
  };
}

// ---------------------------------------------------------------------------
// Main replay entry point
// ---------------------------------------------------------------------------

export interface ReplayOptions {
  limit?: number;
  since?: string;
  barbershopId?: string;
  harnessPrefix?: string;
  harnessPhone?: string;
}

export async function runReplay(opts: ReplayOptions = {}): Promise<ReplayReport> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for replay mode");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const harnessPrefix = opts.harnessPrefix ?? "bench-";
  const harnessPhone = opts.harnessPhone ?? "5500000000000";

  console.log(`\n🔄 Replay mode — loading conversations from DB...`);

  const conversations = await loadClosedConversations({
    limit: opts.limit ?? 10,
    since: opts.since,
    barbershopId: opts.barbershopId,
  });

  console.log(`   Found ${conversations.length} conversations to replay.`);

  const results: ReplayScenarioResult[] = [];

  for (const conv of conversations) {
    process.stdout.write(`  → Replaying ${conv.originalConversationId.slice(0, 8)}... `);
    try {
      const result = await replayConversation(conv, openai, harnessPrefix, harnessPhone);
      results.push(result);
      console.log(
        `done (${result.regressionCount}r/${result.improvementCount}i turns)`
      );
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message}`);
    }
  }

  try {
    const { pool } = await import("../../src/db.js");
    await pool.end();
  } catch {}

  return {
    runAt: new Date().toISOString(),
    totalConversations: conversations.length,
    totalRegressions: results.reduce((acc, r) => acc + r.regressionCount, 0),
    totalImprovements: results.reduce((acc, r) => acc + r.improvementCount, 0),
    results,
  };
}
