import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { runAgent } from "../ai/agent.js";
import type OpenAI from "openai";

describe("runAgent persistAssistantMessages", () => {
  let barbershopId: string | null = null;
  let conversationId: string | null = null;
  const testPhone = "5511999999777";

  beforeAll(async () => {
    try {
      const shop = await pool.query<{ id: string }>(
        "SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1"
      );
      barbershopId = shop.rows[0]?.id ?? null;
      if (!barbershopId) return;
      await pool.query(
        `INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model)
         VALUES ($1, true, 'America/Sao_Paulo', 'gpt-4o-mini')
         ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true`,
        [barbershopId]
      );
      const conv = await pool.query<{ id: string }>(
        `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
         VALUES ($1, 'whatsapp', $2)
         RETURNING id`,
        [barbershopId, testPhone]
      );
      conversationId = conv.rows[0]?.id ?? null;
      if (conversationId) {
        await pool.query(
          `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
          [conversationId, "oi"]
        );
      }
    } catch {
      barbershopId = null;
      conversationId = null;
    }
  });

  afterAll(async () => {
    if (conversationId) {
      await pool.query("DELETE FROM public.ai_messages WHERE conversation_id = $1", [conversationId]);
      await pool.query("DELETE FROM public.ai_conversations WHERE id = $1", [conversationId]);
    }
  });

  it("with persistAssistantMessages: false does not insert assistant message", async () => {
    if (!barbershopId || !conversationId) return;
    const before = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM public.ai_messages WHERE conversation_id = $1 AND role = 'assistant'`,
      [conversationId]
    );
    const beforeCount = parseInt(before.rows[0]?.count ?? "0", 10);
    const openai = {} as OpenAI;
    await runAgent(barbershopId, conversationId, testPhone, openai, {
      persistAssistantMessages: false,
    });
    const after = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM public.ai_messages WHERE conversation_id = $1 AND role = 'assistant'`,
      [conversationId]
    );
    const afterCount = parseInt(after.rows[0]?.count ?? "0", 10);
    expect(afterCount).toBe(beforeCount);
  });
});
