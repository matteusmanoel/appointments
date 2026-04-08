import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId, getBarbershopScope } from "../middleware/auth.js";

const createBody = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
  barbershop_id: z.string().uuid().optional(),
});
const updateBody = createBody.partial();

export const clientsRouter = Router();

clientsRouter.use(requireJwt);

clientsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const search = (req.query.search as string)?.trim();
  const reactivationFilter = (req.query.reactivation_status as string)?.trim();

  let query = `
    SELECT
      c.id, c.barbershop_id, c.name, c.phone, c.email, c.notes,
      c.total_visits, c.total_spent, c.loyalty_points,
      c.created_at, c.updated_at,
      ${("all" in scope) ? "bs.name AS barbershop_name," : ""}
      -- Last appointment info (from appointments table)
      agg.last_appointment_at,
      agg.last_appointment_status,
      -- AI memory fields (from client_ai_memory)
      COALESCE(m.no_show_count, 0) AS no_show_count,
      COALESCE(m.reactivation_status, 'unknown') AS reactivation_status,
      m.preferred_services,
      m.overall_confidence AS memory_confidence
    FROM public.clients c
    ${("all" in scope) ? "JOIN public.barbershops bs ON bs.id = c.barbershop_id" : ""}
    -- Left join with aggregated appointment data
    LEFT JOIN (
      SELECT
        client_id,
        MAX(scheduled_date) AS last_appointment_at,
        (array_agg(status ORDER BY scheduled_date DESC))[1] AS last_appointment_status
      FROM public.appointments
      WHERE barbershop_id = ANY($1::uuid[])
      GROUP BY client_id
    ) agg ON agg.client_id = c.id
    -- Left join with AI memory
    LEFT JOIN public.client_ai_memory m
      ON m.client_id = c.id AND m.barbershop_id = c.barbershop_id
    WHERE c.barbershop_id = ANY($1::uuid[])`;

  const params: unknown[] = [ids];
  let paramIdx = 2;

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (c.name ILIKE $${paramIdx} OR c.phone ILIKE $${paramIdx})`;
    paramIdx++;
  }
  if (reactivationFilter) {
    params.push(reactivationFilter);
    query += ` AND COALESCE(m.reactivation_status, 'unknown') = $${paramIdx}`;
    paramIdx++;
  }

  query += " ORDER BY c.name";
  const r = await pool.query(query, params);
  res.json(r.rows);
});

clientsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  let barbershopId: string;
  if ("all" in scope) {
    const bodyBarbershopId = parsed.data.barbershop_id;
    if (!bodyBarbershopId || !scope.all.includes(bodyBarbershopId)) {
      res.status(400).json({ error: "barbershop_id obrigatório e deve ser uma filial da sua conta" });
      return;
    }
    barbershopId = bodyBarbershopId;
  } else {
    barbershopId = scope.single;
  }
  const { name, phone, email, notes } = parsed.data;
  const normalizedPhone = phone.replace(/\D/g, "");
  const r = await pool.query(
    `INSERT INTO public.clients (barbershop_id, name, phone, email, notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, notes = EXCLUDED.notes, updated_at = now()
     RETURNING id, barbershop_id, name, phone, email, notes, total_visits, total_spent, loyalty_points, created_at, updated_at`,
    [barbershopId, name, normalizedPhone || phone, email === "" ? null : email ?? null, notes ?? null]
  );
  res.status(201).json(r.rows[0]);
});

clientsRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    "SELECT * FROM public.clients WHERE id = $1 AND barbershop_id = ANY($2::uuid[])",
    [req.params.id, ids]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(r.rows[0]);
});

// GET /api/clients/:id/appointments — last 24 appointments for this client
clientsRouter.get("/:id/appointments", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  // Verify client belongs to scope
  const clientCheck = await pool.query(
    "SELECT id FROM public.clients WHERE id = $1 AND barbershop_id = ANY($2::uuid[])",
    [req.params.id, ids]
  );
  if (clientCheck.rows.length === 0) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const r = await pool.query(
    `SELECT
       a.id, a.barbershop_id, a.barber_id, a.scheduled_date, a.scheduled_time,
       a.status, a.price, a.duration_minutes, a.notes, a.created_at,
       b.name AS barber_name,
       COALESCE(
         (SELECT jsonb_agg(s.name ORDER BY s.name)
          FROM public.appointment_services aps
          JOIN public.services s ON s.id = aps.service_id
          WHERE aps.appointment_id = a.id),
         '[]'::jsonb
       ) AS service_names
     FROM public.appointments a
     LEFT JOIN public.barbers b ON b.id = a.barber_id
     WHERE a.client_id = $1 AND a.barbershop_id = ANY($2::uuid[])
     ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
     LIMIT 24`,
    [req.params.id, ids]
  );
  res.json(r.rows);
});

// GET /api/clients/:id/memory — returns the client_ai_memory row for this client
clientsRouter.get("/:id/memory", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const clientCheck = await pool.query(
    "SELECT id, barbershop_id, phone FROM public.clients WHERE id = $1 AND barbershop_id = ANY($2::uuid[])",
    [req.params.id, ids]
  );
  if (clientCheck.rows.length === 0) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const client = clientCheck.rows[0] as { id: string; barbershop_id: string; phone: string };
  const r = await pool.query(
    `SELECT
       m.*,
       b.name AS preferred_barber_name
     FROM public.client_ai_memory m
     LEFT JOIN public.barbers b ON b.id = m.preferred_barber_id
     WHERE m.client_id = $1 AND m.barbershop_id = $2`,
    [client.id, client.barbershop_id]
  );
  res.json(r.rows[0] ?? null);
});

// PATCH /api/clients/:id/memory — update notes_safe (human-editable field)
clientsRouter.patch("/:id/memory", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const bodySchema = z.object({ notes_safe: z.string().max(200).nullable() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const clientCheck = await pool.query(
    "SELECT id, barbershop_id FROM public.clients WHERE id = $1 AND barbershop_id = ANY($2::uuid[])",
    [req.params.id, ids]
  );
  if (clientCheck.rows.length === 0) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const client = clientCheck.rows[0] as { id: string; barbershop_id: string };
  const r = await pool.query(
    `INSERT INTO public.client_ai_memory (client_id, barbershop_id, notes_safe)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id, barbershop_id) DO UPDATE SET notes_safe = EXCLUDED.notes_safe, updated_at = now()
     RETURNING *`,
    [client.id, client.barbershop_id, parsed.data.notes_safe]
  );
  res.json(r.rows[0]);
});

// GET /api/clients/by-phone/:phone/memory — memory lookup by phone (for InboxView)
clientsRouter.get("/by-phone/:phone/memory", async (req: Request, res: Response): Promise<void> => {
  let barbershopId: string;
  try {
    barbershopId = await getBarbershopId(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const phone = req.params.phone.replace(/\D/g, "");
  const r = await pool.query(
    `SELECT
       m.*,
       b.name AS preferred_barber_name,
       c.name AS client_name
     FROM public.clients c
     JOIN public.client_ai_memory m ON m.client_id = c.id AND m.barbershop_id = $1
     LEFT JOIN public.barbers b ON b.id = m.preferred_barber_id
     WHERE c.barbershop_id = $1 AND (c.phone = $2 OR c.phone = $3)
     LIMIT 1`,
    [barbershopId, phone, req.params.phone]
  );
  res.json(r.rows[0] ?? null);
});

clientsRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    updates.push(`${key} = $${i++}`);
    values.push(v === "" ? null : v);
  }
  if (updates.length === 0) {
    const r = await pool.query(
      "SELECT * FROM public.clients WHERE id = $1 AND barbershop_id = ANY($2::uuid[])",
      [req.params.id, ids]
    );
    if (r.rows.length === 0) res.status(404).json({ error: "Client not found" });
    else res.json(r.rows[0]);
    return;
  }
  values.push(req.params.id, ids);
  const r = await pool.query(
    `UPDATE public.clients SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} AND barbershop_id = ANY($${i + 1}::uuid[]) RETURNING *`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(r.rows[0]);
});

clientsRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    "DELETE FROM public.clients WHERE id = $1 AND barbershop_id = ANY($2::uuid[]) RETURNING id",
    [req.params.id, ids]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.status(204).send();
});
