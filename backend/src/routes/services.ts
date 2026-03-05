import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId, getBarbershopScope } from "../middleware/auth.js";

const categoryEnum = z.enum(["corte", "barba", "combo", "tratamento", "adicional"]);
const createBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  duration_minutes: z.number().int().min(1).optional(),
  commission_percentage: z.number().int().min(0).max(100).optional(),
  category: categoryEnum.optional(),
  is_active: z.boolean().optional(),
  points_to_earn: z.number().int().min(0).optional(),
  points_to_redeem: z.number().int().min(0).nullable().optional(),
  barbershop_id: z.string().uuid().optional(),
});
const updateBody = createBody.partial();

export const servicesRouter = Router();

servicesRouter.use(requireJwt);

const serviceColumns =
  "id, barbershop_id, name, description, price, duration_minutes, commission_percentage, category, is_active, points_to_earn, points_to_redeem, created_at, updated_at";

servicesRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    `SELECT s.id, s.barbershop_id, s.name, s.description, s.price, s.duration_minutes, s.commission_percentage, s.category, s.is_active, s.points_to_earn, s.points_to_redeem, s.created_at, s.updated_at
     ${"all" in scope ? ", bs.name AS barbershop_name" : ""}
     FROM public.services s
     ${"all" in scope ? "JOIN public.barbershops bs ON bs.id = s.barbershop_id" : ""}
     WHERE s.barbershop_id = ANY($1::uuid[]) ORDER BY s.name`,
    [ids]
  );
  res.json(r.rows);
});

servicesRouter.post("/", async (req: Request, res: Response): Promise<void> => {
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
  const { name, description, price, duration_minutes, commission_percentage, category, is_active, points_to_earn, points_to_redeem } = parsed.data;
  const r = await pool.query(
    `INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, commission_percentage, category, is_active, points_to_earn, points_to_redeem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${serviceColumns}`,
    [
      barbershopId,
      name,
      description ?? null,
      price,
      duration_minutes ?? 30,
      commission_percentage ?? 40,
      category ?? "corte",
      is_active ?? true,
      points_to_earn ?? 0,
      points_to_redeem ?? null,
    ]
  );
  res.status(201).json(r.rows[0]);
});

servicesRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    `SELECT ${serviceColumns} FROM public.services WHERE id = $1 AND barbershop_id = ANY($2::uuid[])`,
    [req.params.id, ids]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.json(r.rows[0]);
});

servicesRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
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
  const allowed = ["name", "description", "price", "duration_minutes", "commission_percentage", "category", "is_active", "points_to_earn", "points_to_redeem"];
  for (const key of allowed) {
    const v = (parsed.data as Record<string, unknown>)[key];
    if (v === undefined) continue;
    updates.push(`${key} = $${i++}`);
    values.push(v);
  }
  if (updates.length === 0) {
    const r = await pool.query(
      `SELECT ${serviceColumns} FROM public.services WHERE id = $1 AND barbershop_id = ANY($2::uuid[])`,
      [req.params.id, ids]
    );
    if (r.rows.length === 0) res.status(404).json({ error: "Service not found" });
    else res.json(r.rows[0]);
    return;
  }
  values.push(req.params.id, ids);
  const r = await pool.query(
    `UPDATE public.services SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} AND barbershop_id = ANY($${i + 1}::uuid[]) RETURNING *`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.json(r.rows[0]);
});

servicesRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    "DELETE FROM public.services WHERE id = $1 AND barbershop_id = ANY($2::uuid[]) RETURNING id",
    [req.params.id, ids]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.status(204).send();
});
