import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { config } from "../config.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";
import { whatsappRouter } from "./whatsapp.js";
import { buildFollowUp30d } from "../outbound/templates.js";

function isUndefinedTable(e: unknown): boolean {
  return (e as { code?: string })?.code === "42P01";
}

export const integrationsRouter = Router();
integrationsRouter.use(requireJwt);
integrationsRouter.use("/whatsapp", whatsappRouter);

integrationsRouter.get("/api-keys", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT id, name, last_used_at, created_at, revoked_at
     FROM public.barbershop_api_keys
     WHERE barbershop_id = $1
     ORDER BY created_at DESC`,
    [barbershopId]
  );
  res.json(r.rows.map((row: { id: string; name: string; last_used_at: string | null; created_at: string; revoked_at: string | null }) => ({
    id: row.id,
    name: row.name,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    revoked: !!row.revoked_at,
  })));
});

const createKeyBody = z.object({ name: z.string().min(1).max(80) });
integrationsRouter.post("/api-keys", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const apiKey = `bfk_${crypto.randomUUID()}_${Math.random().toString(36).slice(2, 10)}`;
  const keyHash = await bcrypt.hash(apiKey, 10);
  const r = await pool.query(
    `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, created_at`,
    [barbershopId, parsed.data.name, keyHash]
  );
  const row = r.rows[0];
  res.status(201).json({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    api_key: apiKey,
  });
});

integrationsRouter.delete("/api-keys/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `UPDATE public.barbershop_api_keys SET revoked_at = now() WHERE id = $1 AND barbershop_id = $2 AND revoked_at IS NULL RETURNING id`,
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "API key not found or already revoked" });
    return;
  }
  res.status(204).send();
});

/** GET /api/integrations/automations/scheduled-messages/summary — counts by status for dashboard */
integrationsRouter.get("/automations/scheduled-messages/summary", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count FROM public.scheduled_messages WHERE barbershop_id = $1 GROUP BY status`,
    [barbershopId]
  );
  const counts = { queued: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of r.rows) {
    const n = parseInt(row.count, 10);
    if (row.status === "queued") counts.queued = n;
    else if (row.status === "sent") counts.sent = n;
    else if (row.status === "failed") counts.failed = n;
    else if (row.status === "skipped") counts.skipped = n;
  }
  res.json(counts);
});

/** GET /api/integrations/automations/scheduled-messages — list with type/status/limit for diagnostics */
integrationsRouter.get("/automations/scheduled-messages", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const type = (req.query.type as string) || undefined;
  const status = (req.query.status as string) || undefined;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const conditions = ["barbershop_id = $1"];
  const params: (string | number)[] = [barbershopId];
  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  params.push(limit);
  const r = await pool.query<{
    id: string;
    type: string;
    to_phone: string;
    status: string;
    run_after: string;
    last_error: string | null;
    created_at: string;
  }>(
    `SELECT id, type, to_phone, status, run_after, last_error, created_at
     FROM public.scheduled_messages
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  const maskPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length <= 4) return "****";
    return "****" + digits.slice(-4);
  };
  res.json(
    r.rows.map((row) => ({
      id: row.id,
      type: row.type,
      to_phone: maskPhone(row.to_phone),
      status: row.status,
      run_after: row.run_after,
      last_error: row.last_error ?? undefined,
      created_at: row.created_at,
    }))
  );
});

/** GET /api/integrations/automations/followup/eligible — clients inactive for at least N days (last activity = max of last appointment, last WhatsApp), or all clients when all=1 */
integrationsRouter.get("/automations/followup/eligible", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const allClients = req.query.all === "1" || req.query.all === "true";
  const daysRaw = req.query.days;
  const daysParsed =
    daysRaw === undefined || daysRaw === ""
      ? 30
      : parseInt(String(daysRaw), 10);
  const days = allClients
    ? null
    : Math.min(Math.max(Number.isFinite(daysParsed) ? daysParsed : 30, 7), 365);
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const search = (req.query.search as string)?.trim() || undefined;

  const baseCte = `WITH last_appt AS (
       SELECT client_id, max(scheduled_date)::date AS d
       FROM public.appointments
       WHERE barbershop_id = $1 AND status != 'cancelled'
       GROUP BY client_id
     ),
     last_wa AS (
       SELECT c.id AS client_id, max(ac.last_message_at)::date AS d
       FROM public.ai_conversations ac
       JOIN public.clients c ON c.barbershop_id = ac.barbershop_id
         AND ac.external_thread_id = regexp_replace(c.phone, '[^0-9]', '', 'g')
       WHERE ac.barbershop_id = $1
       GROUP BY c.id
     )`;

  const sqlAll = `${baseCte}
     SELECT c.id, c.name, c.phone,
       greatest(coalesce(la.d, '1970-01-01'::date), coalesce(lw.d, '1970-01-01'::date))::text AS last_activity,
       CASE WHEN coalesce(la.d, '1970-01-01'::date) >= coalesce(lw.d, '1970-01-01'::date) THEN 'appointment' ELSE 'whatsapp' END AS source
     FROM public.clients c
     LEFT JOIN last_appt la ON la.client_id = c.id
     LEFT JOIN last_wa lw ON lw.client_id = c.id
     WHERE c.barbershop_id = $1 AND c.marketing_opt_out = false
       AND ($2::text IS NULL OR $2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone LIKE '%' || $2 || '%')
     ORDER BY last_activity ASC
     LIMIT $3`;

  const sqlInactive = `${baseCte}
     SELECT c.id, c.name, c.phone,
       greatest(coalesce(la.d, '1970-01-01'::date), coalesce(lw.d, '1970-01-01'::date))::text AS last_activity,
       CASE WHEN coalesce(la.d, '1970-01-01'::date) >= coalesce(lw.d, '1970-01-01'::date) THEN 'appointment' ELSE 'whatsapp' END AS source
     FROM public.clients c
     LEFT JOIN last_appt la ON la.client_id = c.id
     LEFT JOIN last_wa lw ON lw.client_id = c.id
     WHERE c.barbershop_id = $1 AND c.marketing_opt_out = false
       AND greatest(coalesce(la.d, '1970-01-01'::date), coalesce(lw.d, '1970-01-01'::date)) <= (current_date - ($2::int || ' days')::interval)
       AND ($3::text IS NULL OR $3 = '' OR c.name ILIKE '%' || $3 || '%' OR c.phone LIKE '%' || $3 || '%')
     ORDER BY last_activity ASC
     LIMIT $4`;

  const r = await pool.query<{
    id: string;
    name: string | null;
    phone: string;
    last_activity: string;
    source: string;
  }>(
    allClients ? sqlAll : sqlInactive,
    allClients ? [barbershopId, search ?? null, limit] : [barbershopId, days!, search ?? null, limit]
  );
  res.json(
    r.rows.map((row) => ({
      id: row.id,
      name: row.name ?? undefined,
      phone: row.phone,
      last_activity: row.last_activity,
      source: row.source as "appointment" | "whatsapp",
    }))
  );
});

/** GET /api/integrations/automations/followup/credits — balance for manual follow-up */
integrationsRouter.get("/automations/followup/credits", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  try {
    const r = await pool.query<{ balance: string }>(
      `SELECT balance FROM public.barbershop_message_credits
       WHERE barbershop_id = $1 AND credit_type = 'followup_manual'`,
      [barbershopId]
    );
    const balance = r.rows[0] ? parseInt(r.rows[0].balance, 10) : 0;
    res.json({ balance, credit_type: "followup_manual" });
  } catch (e) {
    if (isUndefinedTable(e)) {
      res.json({ balance: 0, credit_type: "followup_manual" });
      return;
    }
    throw e;
  }
});

const dispatchFollowUpBody = z.object({
  client_ids: z.array(z.string().uuid()).min(1).max(100),
  days: z.number().int().min(7).max(365).optional(),
});

/** POST /api/integrations/automations/followup/dispatch — enqueue followup_30d for selected clients; dedupe monthly; debit credits */
integrationsRouter.post("/automations/followup/dispatch", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = dispatchFollowUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { client_ids } = parsed.data;
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const appUrl = (config.appUrl || "").replace(/\/$/, "");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const balanceRow = await client.query<{ balance: string }>(
      `SELECT balance FROM public.barbershop_message_credits
       WHERE barbershop_id = $1 AND credit_type = 'followup_manual'
       FOR UPDATE`,
      [barbershopId]
    );
    let balance = balanceRow.rows[0] ? parseInt(balanceRow.rows[0].balance, 10) : 0;
    if (balance < client_ids.length) {
      await client.query("ROLLBACK");
      res.status(402).json({
        error: "Créditos insuficientes",
        required: client_ids.length,
        balance,
      });
      return;
    }
    const slugRow = await client.query<{ slug: string | null }>(
      `SELECT slug FROM public.barbershops WHERE id = $1`,
      [barbershopId]
    );
    const slug = slugRow.rows[0]?.slug ?? null;
    const bookingLink = slug ? `${appUrl}/b/${slug}` : appUrl || "";
    const clientsRow = await client.query<{ id: string; name: string | null; phone: string }>(
      `SELECT id, name, phone FROM public.clients
       WHERE barbershop_id = $1 AND id = ANY($2::uuid[]) AND marketing_opt_out = false`,
      [barbershopId, client_ids]
    );
    let enqueued = 0;
    let skippedDedupe = 0;
    for (const c of clientsRow.rows) {
      const phoneNorm = c.phone.replace(/\D/g, "");
      if (!phoneNorm) continue;
      const dedupeKey = `followup_30d:${barbershopId}:${c.id}:${yearMonth}`;
      const exists = await client.query(
        `SELECT 1 FROM public.scheduled_messages WHERE dedupe_key = $1 LIMIT 1`,
        [dedupeKey]
      );
      if (exists.rows.length > 0) {
        skippedDedupe++;
        continue;
      }
      const body = buildFollowUp30d({
        clientName: c.name ?? undefined,
        bookingLink,
      });
      await client.query(
        `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key, updated_at)
         VALUES ($1, 'followup_30d', $2, $3, 'queued', now(), $4, now())`,
        [barbershopId, phoneNorm, JSON.stringify({ body, client_id: c.id }), dedupeKey]
      );
      enqueued++;
    }
    balance -= enqueued;
    await client.query(
      `INSERT INTO public.barbershop_message_credits (barbershop_id, credit_type, balance, updated_at)
       VALUES ($1, 'followup_manual', $2, now())
       ON CONFLICT (barbershop_id, credit_type) DO UPDATE SET balance = $2, updated_at = now()`,
      [barbershopId, balance]
    );
    await client.query("COMMIT");
    res.json({
      enqueued,
      skipped_dedupe: skippedDedupe,
      skipped_opt_out: client_ids.length - clientsRow.rows.length,
      credits_remaining: balance,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (isUndefinedTable(e)) {
      res.status(503).json({ error: "Serviço de créditos indisponível. Execute as migrações do banco e reinicie a API." });
      return;
    }
    console.error("followup dispatch error:", e);
    res.status(500).json({ error: "Falha ao enfileirar follow-ups" });
  } finally {
    client.release();
  }
});

// --- Message templates (manual/campaign) ---
integrationsRouter.get("/automations/templates", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  try {
    const r = await pool.query<{ id: string; name: string; body: string; created_at: string }>(
      `SELECT id, name, body, created_at FROM public.message_templates WHERE barbershop_id = $1 ORDER BY name`,
      [barbershopId]
    );
    res.json(r.rows);
  } catch (e) {
    if (isUndefinedTable(e)) {
      res.json([]);
      return;
    }
    throw e;
  }
});

const createTemplateBody = z.object({ name: z.string().min(1).max(200), body: z.string().min(1).max(4096) });
integrationsRouter.post("/automations/templates", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    const r = await pool.query<{ id: string; name: string; body: string; created_at: string }>(
      `INSERT INTO public.message_templates (barbershop_id, name, body) VALUES ($1, $2, $3)
       RETURNING id, name, body, created_at`,
      [barbershopId, parsed.data.name, parsed.data.body]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (isUndefinedTable(e)) {
      res.status(503).json({ error: "Tabela message_templates não existe. Execute as migrações." });
      return;
    }
    throw e;
  }
});

const updateTemplateBody = z.object({ name: z.string().min(1).max(200).optional(), body: z.string().min(1).max(4096).optional() });
integrationsRouter.patch("/automations/templates/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const id = req.params.id;
  const parsed = updateTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (parsed.data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(parsed.data.name);
    }
    if (parsed.data.body !== undefined) {
      updates.push(`body = $${idx++}`);
      values.push(parsed.data.body);
    }
    if (updates.length === 0) {
      const r = await pool.query(`SELECT id, name, body, created_at FROM public.message_templates WHERE id = $1 AND barbershop_id = $2`, [id, barbershopId]);
      if (r.rows.length === 0) {
        res.status(404).json({ error: "Template não encontrado" });
        return;
      }
      res.json(r.rows[0]);
      return;
    }
    values.push(id, barbershopId);
    const r = await pool.query(
      `UPDATE public.message_templates SET ${updates.join(", ")} WHERE id = $${idx} AND barbershop_id = $${idx + 1} RETURNING id, name, body, created_at`,
      values
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Template não encontrado" });
      return;
    }
    res.json(r.rows[0]);
  } catch (e) {
    if (isUndefinedTable(e)) {
      res.status(503).json({ error: "Tabela message_templates não existe." });
      return;
    }
    throw e;
  }
});

integrationsRouter.delete("/automations/templates/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const id = req.params.id;
  try {
    const r = await pool.query(
      `DELETE FROM public.message_templates WHERE id = $1 AND barbershop_id = $2 RETURNING id`,
      [id, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Template não encontrado" });
      return;
    }
    res.status(204).send();
  } catch (e) {
    if (isUndefinedTable(e)) {
      res.status(503).json({ error: "Tabela message_templates não existe." });
      return;
    }
    throw e;
  }
});

const manualScheduleBody = z.object({
  to_phone: z.string().min(1).max(30),
  body: z.string().min(1).max(4096),
  run_after: z.string().datetime().optional(),
});
integrationsRouter.post("/automations/scheduled-messages/manual", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = manualScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const toPhone = parsed.data.to_phone.replace(/\D/g, "");
  if (!toPhone) {
    res.status(400).json({ error: "Número inválido" });
    return;
  }
  const runAfter = parsed.data.run_after ? new Date(parsed.data.run_after) : new Date();
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, updated_at)
       VALUES ($1, 'manual', $2, $3, 'queued', $4, now()) RETURNING id`,
      [barbershopId, toPhone, JSON.stringify({ body: parsed.data.body }), runAfter]
    );
    res.status(201).json({ id: r.rows[0].id, status: "queued", run_after: runAfter.toISOString() });
  } catch (e) {
    if ((e as { code?: string }).code === "23514") {
      res.status(400).json({ error: "Tipo 'manual' não permitido. Execute a migração de manual/campaign." });
      return;
    }
    throw e;
  }
});

const createCampaignBody = z.object({
  name: z.string().min(1).max(200),
  body: z.string().min(1).max(4096).optional(),
  template_id: z.string().uuid().optional(),
  client_ids: z.array(z.string().uuid()).min(1).max(5000),
  run_after: z.string().datetime().optional(),
});
integrationsRouter.post("/automations/campaigns", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  let body = parsed.data.body;
  if (!body && parsed.data.template_id) {
    const t = await pool.query<{ body: string }>(
      `SELECT body FROM public.message_templates WHERE id = $1 AND barbershop_id = $2`,
      [parsed.data.template_id, barbershopId]
    );
    body = t.rows[0]?.body ?? "";
  }
  if (!body || !body.trim()) {
    res.status(400).json({ error: "Forneça body ou template_id com template válido" });
    return;
  }
  const runAfter = parsed.data.run_after ? new Date(parsed.data.run_after) : new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const campRow = await client.query<{ id: string }>(
      `INSERT INTO public.message_campaigns (barbershop_id, name, status, body, template_id, audience_query, run_after, updated_at)
       VALUES ($1, $2, 'running', $3, $4, $5, $6, now()) RETURNING id`,
      [barbershopId, parsed.data.name, body.trim(), parsed.data.template_id ?? null, JSON.stringify({ client_ids: parsed.data.client_ids }), runAfter]
    );
    const campaignId = campRow.rows[0].id;
    const clientsRow = await client.query<{ id: string; phone: string }>(
      `SELECT id, phone FROM public.clients
       WHERE barbershop_id = $1 AND id = ANY($2::uuid[]) AND marketing_opt_out = false`,
      [barbershopId, parsed.data.client_ids]
    );
    let inserted = 0;
    for (const c of clientsRow.rows) {
      const phoneNorm = c.phone.replace(/\D/g, "");
      if (!phoneNorm) continue;
      const dedupeKey = `campaign:${campaignId}:${c.id}`;
      try {
        const ins = await client.query(
          `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, campaign_id, dedupe_key, updated_at)
           VALUES ($1, 'campaign', $2, $3, 'queued', $4, $5, $6, now())`,
          [barbershopId, phoneNorm, JSON.stringify({ body: body.trim() }), runAfter, campaignId, dedupeKey]
        );
        if (ins.rowCount) inserted++;
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
      }
    }
    await client.query("COMMIT");
    res.status(201).json({
      campaign_id: campaignId,
      name: parsed.data.name,
      status: "running",
      recipients_enqueued: inserted,
      skipped_opt_out: parsed.data.client_ids.length - clientsRow.rows.length,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (isUndefinedTable(e)) {
      res.status(503).json({ error: "Tabelas de campanha não existem. Execute as migrações." });
      return;
    }
    throw e;
  } finally {
    client.release();
  }
});

integrationsRouter.post("/automations/campaigns/:id/cancel", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const id = req.params.id;
  try {
    const r = await pool.query(
      `UPDATE public.message_campaigns SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND barbershop_id = $2 RETURNING id`,
      [id, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Campanha não encontrada" });
      return;
    }
    await pool.query(
      `UPDATE public.scheduled_messages SET status = 'skipped', last_error = 'Campanha cancelada', updated_at = now()
       WHERE campaign_id = $1 AND status = 'queued'`,
      [id]
    );
    res.json({ ok: true, message: "Campanha cancelada; mensagens em fila foram canceladas." });
  } catch (e) {
    if (isUndefinedTable(e)) {
      res.status(503).json({ error: "Tabelas de campanha não existem." });
      return;
    }
    throw e;
  }
});
