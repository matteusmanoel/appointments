import crypto from "crypto";
import { pool } from "../db.js";
import { config } from "../config.js";

const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2000;

export type OutboundEventType = "appointment_created" | "conversation_closed" | "customer_requested_handoff";

export async function enqueueOutboundEvent(
  barbershopId: string,
  type: OutboundEventType,
  payload: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO public.outbound_events (barbershop_id, type, payload_json, status, attempts, next_run_at, updated_at)
     VALUES ($1, $2, $3, 'pending', 0, now(), now())`,
    [barbershopId, type, JSON.stringify(payload)]
  );
}

function signPayload(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function fetchPendingEvents(): Promise<
  { id: string; barbershop_id: string; type: string; payload_json: unknown; attempts: number }[]
> {
  const r = await pool.query<{
    id: string;
    barbershop_id: string;
    type: string;
    payload_json: unknown;
    attempts: number;
  }>(
    `UPDATE public.outbound_events
     SET attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM public.outbound_events
       WHERE status = 'pending' AND next_run_at <= now()
       ORDER BY created_at ASC
       LIMIT 10
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, type, payload_json, attempts`
  );
  return r.rows;
}

async function markEventSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE public.outbound_events SET status = 'sent', updated_at = now() WHERE id = $1`,
    [id]
  );
}

async function markEventFailed(id: string, errorMessage: string, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE public.outbound_events SET status = 'dead', last_error = $1, updated_at = now() WHERE id = $2`,
      [errorMessage.slice(0, 1024), id]
    );
  } else {
    const nextRun = new Date(Date.now() + BACKOFF_BASE_MS * Math.pow(2, attempts));
    await pool.query(
      `UPDATE public.outbound_events SET status = 'pending', last_error = $1, next_run_at = $2, updated_at = now() WHERE id = $3`,
      [errorMessage.slice(0, 1024), nextRun, id]
    );
  }
}

export async function dispatchOutboundEvents(): Promise<number> {
  const url = config.n8nEventsWebhookUrl;
  const secret = config.n8nEventsSecret;
  if (!url || !secret) return 0;

  const rows = await fetchPendingEvents();
  let sent = 0;
  for (const row of rows) {
    const body = JSON.stringify({
      barbershop_id: row.barbershop_id,
      type: row.type,
      payload: row.payload_json,
      at: new Date().toISOString(),
    });
    const signature = signPayload(secret, body);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `sha256=${signature}`,
        },
        body,
      });
      if (res.ok) {
        await markEventSent(row.id);
        sent++;
      } else {
        await markEventFailed(row.id, `HTTP ${res.status}`, row.attempts);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await markEventFailed(row.id, errMsg, row.attempts);
    }
  }
  return sent;
}
