import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db.js";
import { isBotPendingId, newBotPendingId, reserveAssistantMessage, matchBotEcho } from "../integrations/whatsapp/bot-pending.js";
import { createScheduledMessagesFixtures, deleteScheduledMessagesFixtures } from "./helpers/db.js";

describe("bot-pending", () => {
  it("prefixes reservation ids", () => {
    const id = newBotPendingId();
    expect(isBotPendingId(id)).toBe(true);
    expect(isBotPendingId("wamid.real")).toBe(false);
  });

  let barbershopId: string | null = null;
  let conversationId: string | null = null;

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
    } catch {
      return;
    }
    const fx = await createScheduledMessagesFixtures({ appointmentOffsetDays: 2 });
    barbershopId = fx.barbershopId;
    const conv = await pool.query<{ id: string }>(
      `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id)
       VALUES ($1, 'whatsapp', $2)
       RETURNING id`,
      [fx.barbershopId, fx.clientPhone],
    );
    conversationId = conv.rows[0]?.id ?? null;
  });

  afterAll(async () => {
    if (conversationId) {
      await pool.query(`DELETE FROM public.ai_messages WHERE conversation_id = $1`, [conversationId]).catch(() => {});
      await pool.query(`DELETE FROM public.ai_conversations WHERE id = $1`, [conversationId]).catch(() => {});
    }
    if (barbershopId) await deleteScheduledMessagesFixtures([barbershopId]);
  });

  it("matches echo by exact id and does not require text equality", async () => {
    if (!conversationId) return;
    const pending = newBotPendingId();
    await reserveAssistantMessage({
      conversationId,
      content: "Olá! Horário marcado.",
      pendingId: pending,
    });
    const exact = await matchBotEcho({ conversationId, providerEventId: pending });
    expect(exact?.provider_message_id).toBe(pending);

    await pool.query(
      `UPDATE public.ai_messages SET provider_message_id = $1 WHERE conversation_id = $2 AND provider_message_id = $3`,
      ["wamid.real-echo", conversationId, pending],
    );
    const afterConfirm = await matchBotEcho({ conversationId, providerEventId: "wamid.real-echo" });
    expect(afterConfirm).not.toBeNull();
  });

  it("matches recent bot-pending when echo races before UPDATE", async () => {
    if (!conversationId) return;
    const pending = newBotPendingId();
    await reserveAssistantMessage({
      conversationId,
      content: "Segunda mensagem",
      pendingId: pending,
    });
    const raced = await matchBotEcho({ conversationId, providerEventId: "wamid.not-yet-written" });
    expect(raced?.provider_message_id).toBe(pending);
  });
});
