import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";
import {
  cancelQueuedReactivation,
  enqueueReactivation,
  listQueuedReactivation,
  listReactivationSuggestions,
} from "../outbound/reactivation.js";
import { barbershopTimezone } from "../outbound/dispatch-gate.js";
import { pool } from "../db.js";

export const intelligenceRouter = Router();
intelligenceRouter.use(requireJwt);

const windowQuery = z.object({
  window_days: z.preprocess(
    (value) => (value === "" || value === undefined || value === null ? undefined : value),
    z.coerce.number().int().min(7).max(365).optional(),
  ),
});

const queueBody = z.object({
  client_ids: z.array(z.string().uuid()).min(1).max(200),
  /** Optional custom text for birthday batch. Empty or absent → standard birthday message. */
  body_override: z.string().max(800).optional(),
});

intelligenceRouter.get("/reactivation", async (req: Request, res: Response) => {
  const parsed = windowQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  try {
    const rows = await listReactivationSuggestions(getBarbershopId(req), parsed.data.window_days);
    res.json(
      rows.map((row) => ({
        client_id: row.clientId,
        name: row.name,
        phone: row.phone,
        reason: row.reason,
        detail: row.detail,
      })),
    );
  } catch (e) {
    console.error("[intelligence] reactivation list", e);
    res.status(500).json({ error: "Internal error" });
  }
});

intelligenceRouter.get("/reactivation/queue", async (req: Request, res: Response) => {
  try {
    const rows = await listQueuedReactivation(getBarbershopId(req));
    res.json(
      rows.map((row) => ({
        id: row.id,
        client_id: row.clientId,
        name: row.name,
        phone: row.phone,
        reason: row.reason,
        run_after: row.runAfter,
      })),
    );
  } catch (e) {
    console.error("[intelligence] reactivation queue", e);
    res.status(500).json({ error: "Internal error" });
  }
});

intelligenceRouter.post("/reactivation/queue", async (req: Request, res: Response) => {
  const parsed = queueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await enqueueReactivation(
      getBarbershopId(req),
      parsed.data.client_ids,
      parsed.data.body_override,
    );
    res.json({ queued: result.queued, run_after: result.runAfter });
  } catch (e) {
    console.error("[intelligence] reactivation enqueue", e);
    res.status(500).json({ error: "Internal error" });
  }
});

intelligenceRouter.post("/reactivation/queue/:id/remove", async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: "Invalid id", details: id.error.flatten() });
    return;
  }
  try {
    const removed = await cancelQueuedReactivation(getBarbershopId(req), id.data);
    if (!removed) {
      res.status(404).json({ error: "Mensagem não encontrada ou não está na fila." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[intelligence] reactivation remove", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * Extracted SQL for day-summary: used by the route and importable for integration tests.
 * Parameters: $1 = barbershop_id, $2 = IANA timezone string.
 */
export const daySummaryQuery = `WITH day_start AS (
   SELECT (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2) AS start
 ),
 -- gated scheduled_messages sent today (reminders, reactivation, plan billing, manual, campaign)
 sm_today AS (
   SELECT m.type, regexp_replace(COALESCE(m.to_phone, ''), '[^0-9]', '', 'g') AS digits
   FROM public.scheduled_messages m, day_start
   WHERE m.barbershop_id = $1
     AND m.status = 'sent'
     AND m.type IN ('reminder_24h', 'reminder_2h', 'reactivation', 'plan_billing', 'manual', 'campaign')
     AND m.updated_at >= day_start.start
 ),
 -- agenda_activity events today
 aa_today AS (
   SELECT a.type, regexp_replace(COALESCE(a.client_phone, ''), '[^0-9]', '', 'g') AS digits
   FROM public.agenda_activity a, day_start
   WHERE a.barbershop_id = $1
     AND a.type IN ('waitlist_offered', 'conversation_started', 'send_failure')
     AND a.created_at >= day_start.start
 ),
 -- counts by finalidade
 purpose_counts AS (
   SELECT
     COUNT(*) FILTER (WHERE type IN ('reminder_24h', 'reminder_2h')) AS lembrete,
     COUNT(*) FILTER (WHERE type = 'reactivation')                   AS reativacao,
     COUNT(*) FILTER (WHERE type = 'plan_billing')                   AS cobranca,
     COUNT(*) FILTER (WHERE type = 'manual')                         AS avulsa,
     COUNT(*) FILTER (WHERE type = 'campaign')                       AS campanha
   FROM sm_today
 ),
 aa_counts AS (
   SELECT
     COUNT(*) FILTER (WHERE type = 'waitlist_offered')    AS fila_espera,
     COUNT(*) FILTER (WHERE type = 'conversation_started') AS atendimento,
     COUNT(*) FILTER (WHERE type = 'send_failure')         AS send_failures_today
   FROM aa_today
 ),
 -- unique client phones today: all gated sends (NOT plan_billing) + waitlist + atendimento
 all_phones AS (
   SELECT digits FROM sm_today
   WHERE digits <> '' AND type IN ('reminder_24h', 'reminder_2h', 'reactivation', 'manual', 'campaign')
   UNION ALL
   SELECT digits FROM aa_today WHERE digits <> '' AND type IN ('waitlist_offered', 'conversation_started')
 ),
 unique_cnt AS (
   SELECT COUNT(DISTINCT digits)::int AS unique_clients_today FROM all_phones
 ),
 -- insistence: phones with 3+ events across lembrete + fila + reativacao + avulsa + campanha
 -- atendimento and cobranca excluded (não entram no alerta de insistência)
 insistence_pool AS (
   SELECT digits FROM sm_today
   WHERE digits <> '' AND type IN ('reminder_24h', 'reminder_2h', 'reactivation', 'manual', 'campaign')
   UNION ALL
   SELECT digits FROM aa_today WHERE digits <> '' AND type = 'waitlist_offered'
 ),
 insistence_cnt AS (
   SELECT COUNT(*) AS insistence_phones
   FROM (
     SELECT digits FROM insistence_pool
     GROUP BY digits
     HAVING COUNT(*) >= 3
   ) x
 )
 SELECT
   pc.lembrete::text,
   ac.fila_espera::text,
   pc.reativacao::text,
   pc.cobranca::text,
   ac.atendimento::text,
   pc.avulsa::text,
   pc.campanha::text,
   uc.unique_clients_today::text,
   ic.insistence_phones::text,
   ac.send_failures_today::text
 FROM purpose_counts pc, aa_counts ac, unique_cnt uc, insistence_cnt ic`;

intelligenceRouter.get("/day-summary", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const tz = await barbershopTimezone(barbershopId);

    const r = await pool.query<{
      lembrete: string;
      fila_espera: string;
      reativacao: string;
      cobranca: string;
      atendimento: string;
      avulsa: string;
      campanha: string;
      unique_clients_today: string;
      insistence_phones: string;
      send_failures_today: string;
    }>(daySummaryQuery, [barbershopId, tz]);

    const row = r.rows[0];

    // WhatsApp session status
    const connRow = await pool.query<{ status: string }>(
      `SELECT status FROM public.barbershop_whatsapp_connections
       WHERE barbershop_id = $1 LIMIT 1`,
      [barbershopId],
    );
    const sessionConnected = connRow.rows[0]?.status === "connected";

    res.json({
      by_purpose: {
        lembrete: Number(row?.lembrete ?? 0),
        fila_espera: Number(row?.fila_espera ?? 0),
        reativacao: Number(row?.reativacao ?? 0),
        cobranca: Number(row?.cobranca ?? 0),
        atendimento: Number(row?.atendimento ?? 0),
        avulsa: Number(row?.avulsa ?? 0),
        campanha: Number(row?.campanha ?? 0),
      },
      unique_clients_today: Number(row?.unique_clients_today ?? 0),
      insistence_phones: Number(row?.insistence_phones ?? 0),
      send_failures_today: Number(row?.send_failures_today ?? 0),
      session_connected: sessionConnected,
    });
  } catch (e) {
    console.error("[intelligence] day-summary", e);
    res.status(500).json({ error: "Internal error" });
  }
});
