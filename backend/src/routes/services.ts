import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

const categoryEnum = z.enum(["corte", "barba", "combo", "tratamento", "adicional"]);
const createBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  duration_minutes: z.number().int().min(1).optional(),
  commission_percentage: z.number().int().min(0).max(100).optional(),
  category: categoryEnum.optional(),
  is_active: z.boolean().optional(),
});
const updateBody = createBody.partial();

export const servicesRouter = Router();

servicesRouter.use(requireJwt);

servicesRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT id, barbershop_id, name, description, price, duration_minutes, commission_percentage, category, is_active, created_at, updated_at
     FROM public.services WHERE barbershop_id = $1 ORDER BY name`,
    [barbershopId]
  );
  res.json(r.rows);
});

servicesRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { name, description, price, duration_minutes, commission_percentage, category, is_active } = parsed.data;
  const r = await pool.query(
    `INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, commission_percentage, category, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, barbershop_id, name, description, price, duration_minutes, commission_percentage, category, is_active, created_at, updated_at`,
    [
      barbershopId,
      name,
      description ?? null,
      price,
      duration_minutes ?? 30,
      commission_percentage ?? 40,
      category ?? "corte",
      is_active ?? true,
    ]
  );
  res.status(201).json(r.rows[0]);
});

servicesRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    "SELECT * FROM public.services WHERE id = $1 AND barbershop_id = $2",
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.json(r.rows[0]);
});

servicesRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = ["name", "description", "price", "duration_minutes", "commission_percentage", "category", "is_active"];
  for (const key of allowed) {
    const v = (parsed.data as Record<string, unknown>)[key];
    if (v === undefined) continue;
    updates.push(`${key} = $${i++}`);
    values.push(v);
  }
  if (updates.length === 0) {
    const r = await pool.query(
      "SELECT * FROM public.services WHERE id = $1 AND barbershop_id = $2",
      [req.params.id, barbershopId]
    );
    if (r.rows.length === 0) res.status(404).json({ error: "Service not found" });
    else res.json(r.rows[0]);
    return;
  }
  values.push(req.params.id, barbershopId);
  const r = await pool.query(
    `UPDATE public.services SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} AND barbershop_id = $${i + 1} RETURNING *`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.json(r.rows[0]);
});

servicesRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    "DELETE FROM public.services WHERE id = $1 AND barbershop_id = $2 RETURNING id",
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.status(204).send();
});
