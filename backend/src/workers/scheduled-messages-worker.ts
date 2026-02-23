import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendText } from "../integrations/uazapi/client.js";
import { runDailyFollowUp30dSweepWithLock } from "../outbound/scheduled-messages.js";

const POLL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = 15;
const SEND_WINDOW_START = 9;
const SEND_WINDOW_END = 20;

function getBarbershopTimezone(rows: { timezone?: string }[]): string {
  return rows[0]?.timezone ?? "America/Sao_Paulo";
}

function getHourInTimezone(tz: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch {
    return 12;
  }
}

function nextWindowStart(tz: string): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10) - 1;
  const day = parseInt(get("day"), 10);
  const hour = parseInt(get("hour"), 10);
  if (hour < SEND_WINDOW_START) {
    return new Date(year, month, day, SEND_WINDOW_START, 0, 0);
  }
  const next = new Date(year, month, day + 1, SEND_WINDOW_START, 0, 0);
  return next;
}

async function getUazapiToken(barbershopId: string): Promise<string | null> {
  const r = await pool.query<{ uazapi_instance_token_encrypted: string }>(
    `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
     WHERE barbershop_id = $1 AND provider = 'uazapi' AND status = 'connected' AND uazapi_instance_token_encrypted IS NOT NULL`,
    [barbershopId]
  );
  const row = r.rows[0];
  if (!row?.uazapi_instance_token_encrypted || !config.appEncryptionKey) return null;
  return decrypt(row.uazapi_instance_token_encrypted, config.appEncryptionKey);
}

async function fetchNextJobs(): Promise<
  { id: string; barbershop_id: string; type: string; to_phone: string; payload_json: unknown; attempts: number }[]
> {
  const r = await pool.query<{
    id: string;
    barbershop_id: string;
    type: string;
    to_phone: string;
    payload_json: unknown;
    attempts: number;
  }>(
    `UPDATE public.scheduled_messages
     SET attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM public.scheduled_messages
       WHERE status = 'queued' AND run_after <= now()
       ORDER BY run_after ASC
       LIMIT 5
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, type, to_phone, payload_json, attempts`
  );
  return r.rows;
}

async function markSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'sent', last_error = NULL, updated_at = now() WHERE id = $1`,
    [id]
  );
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'skipped', last_error = $1, updated_at = now() WHERE id = $2`,
    [reason.slice(0, 512), id]
  );
}

async function markFailed(id: string, errorMessage: string, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE public.scheduled_messages SET status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`,
      [errorMessage.slice(0, 1024), id]
    );
  } else {
    const runAfter = new Date(Date.now() + BACKOFF_MINUTES * 60 * 1000 * Math.pow(2, attempts - 1));
    await pool.query(
      `UPDATE public.scheduled_messages SET status = 'queued', last_error = $1, run_after = $2, updated_at = now() WHERE id = $3`,
      [errorMessage.slice(0, 1024), runAfter, id]
    );
  }
}

async function postponeToWindow(id: string, runAfter: Date): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'queued', run_after = $1, last_error = NULL, updated_at = now() WHERE id = $2`,
    [runAfter, id]
  );
}

async function isOptedOut(barbershopId: string, phone: string): Promise<boolean> {
  const normalized = phone.replace(/\D/g, "");
  if (!normalized) return false;
  const r = await pool.query(
    `SELECT 1 FROM public.clients
     WHERE barbershop_id = $1 AND marketing_opt_out = true
       AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
    [barbershopId, normalized]
  );
  return r.rows.length > 0;
}

async function processOne(): Promise<boolean> {
  const jobs = await fetchNextJobs();
  if (jobs.length === 0) return false;

  for (const row of jobs) {
    const { id, barbershop_id: barbershopId, type, to_phone, payload_json, attempts } = row;
    const payload = (payload_json ?? {}) as Record<string, unknown>;
    const body = typeof payload.body === "string" ? payload.body : "";

    try {
      const tzRows = await pool.query<{ timezone: string }>(
        `SELECT timezone FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
        [barbershopId]
      );
      const tz = getBarbershopTimezone(tzRows.rows);

      const hour = getHourInTimezone(tz);
      if (hour < SEND_WINDOW_START || hour >= SEND_WINDOW_END) {
        await postponeToWindow(id, nextWindowStart(tz));
        continue;
      }

      const optedOut = await isOptedOut(barbershopId, to_phone);
      if (optedOut) {
        await markSkipped(id, "Cliente opt-out");
        continue;
      }

      const appointmentId = typeof payload.appointment_id === "string" ? payload.appointment_id : null;
      if (appointmentId) {
        const appRow = await pool.query<{ status: string }>(
          `SELECT status FROM public.appointments WHERE id = $1`,
          [appointmentId]
        );
        if (appRow.rows[0]?.status === "cancelled") {
          await markSkipped(id, "Agendamento cancelado");
          continue;
        }
      }

      const token = await getUazapiToken(barbershopId);
      if (!token) {
        await markSkipped(id, "WhatsApp não conectado");
        continue;
      }

      if (!body) {
        await markSkipped(id, "Mensagem vazia");
        continue;
      }

      await sendText({ token, number: to_phone, text: body });
      await markSent(id);
      console.info("[scheduled-messages-worker] sent id=%s barbershopId=%s type=%s", id, barbershopId, type);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("[scheduled-messages-worker] error id=%s:", id, errMsg);
      await markFailed(id, errMsg, attempts);
    }
  }
  return true;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runLoop(): Promise<void> {
  console.info("[scheduled-messages-worker] started");
  setTimeout(() => {
    runDailyFollowUp30dSweepWithLock().catch((e) => console.error("[scheduled-messages-worker] daily sweep:", e));
  }, 60_000);
  setInterval(() => {
    runDailyFollowUp30dSweepWithLock().catch((e) => console.error("[scheduled-messages-worker] daily sweep:", e));
  }, ONE_DAY_MS);
  while (true) {
    try {
      const did = await processOne();
      if (!did) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      console.error("[scheduled-messages-worker] loop error:", e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

runLoop().catch((e) => {
  console.error("[scheduled-messages-worker] fatal:", e);
  process.exit(1);
});
