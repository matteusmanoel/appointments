import { randomUUID } from "node:crypto";
import { pool } from "../../db.js";

export function newBotPendingId(): string {
  return `bot-pending-${randomUUID()}`;
}

export function isBotPendingId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("bot-pending-");
}

export async function reserveAssistantMessage(params: {
  conversationId: string;
  content: string;
  pendingId: string;
}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id, delivery_status)
     VALUES ($1, 'assistant', $2, $3, 'pending')
     RETURNING id`,
    [params.conversationId, params.content, params.pendingId],
  );
  return r.rows[0]!.id;
}

export async function confirmAssistantMessage(params: {
  conversationId: string;
  pendingId: string;
  providerMessageId: string | null;
  deliveryStatus?: "sent" | "failed";
}): Promise<void> {
  await pool.query(
    `UPDATE public.ai_messages
     SET provider_message_id = COALESCE($3, provider_message_id),
         delivery_status = $4,
         delivered_at = CASE WHEN $4 = 'sent' THEN COALESCE(delivered_at, now()) ELSE delivered_at END
     WHERE conversation_id = $1 AND provider_message_id = $2`,
    [params.conversationId, params.pendingId, params.providerMessageId, params.deliveryStatus ?? "sent"],
  );
}

/**
 * Match an inbound fromMe echo to a reserved/sent assistant message.
 * 1) exact provider_message_id
 * 2) recent bot-pending reservation (race: echo arrived before UPDATE)
 */
export async function matchBotEcho(params: {
  conversationId: string;
  providerEventId?: string | null;
}): Promise<{ id: string; provider_message_id: string | null } | null> {
  if (params.providerEventId) {
    const exact = await pool.query<{ id: string; provider_message_id: string | null }>(
      `SELECT id, provider_message_id
       FROM public.ai_messages
       WHERE conversation_id = $1 AND role = 'assistant' AND provider_message_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [params.conversationId, params.providerEventId],
    );
    if (exact.rows[0]) return exact.rows[0];
  }

  const pending = await pool.query<{ id: string; provider_message_id: string | null }>(
    `SELECT id, provider_message_id
     FROM public.ai_messages
     WHERE conversation_id = $1
       AND role = 'assistant'
       AND created_at >= now() - interval '2 minutes'
       AND provider_message_id LIKE 'bot-pending-%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.conversationId],
  );
  return pending.rows[0] ?? null;
}

export async function markEchoDelivered(params: {
  messageId: string;
  providerEventId?: string | null;
}): Promise<void> {
  await pool.query(
    `UPDATE public.ai_messages
     SET delivery_status = 'delivered',
         delivered_at = COALESCE(delivered_at, now()),
         provider_message_id = COALESCE($2, provider_message_id)
     WHERE id = $1`,
    [params.messageId, params.providerEventId ?? null],
  );
}
