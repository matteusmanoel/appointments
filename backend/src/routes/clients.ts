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
  let query = `SELECT c.id, c.barbershop_id, c.name, c.phone, c.email, c.notes, c.total_visits, c.total_spent, c.loyalty_points, c.created_at, c.updated_at
               ${"all" in scope ? ", bs.name AS barbershop_name" : ""}
               FROM public.clients c
               ${"all" in scope ? "JOIN public.barbershops bs ON bs.id = c.barbershop_id" : ""}
               WHERE c.barbershop_id = ANY($1::uuid[])`;
  const params: unknown[] = [ids];
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (c.name ILIKE $2 OR c.phone ILIKE $2)`;
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
