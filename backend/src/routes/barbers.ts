import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

const createBody = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "break"]).optional(),
  commission_percentage: z.number().int().min(0).max(100).optional(),
  schedule: z.record(z.unknown()).optional(),
});
const updateBody = createBody.partial();

export const barbersRouter = Router();

barbersRouter.use(requireJwt);

barbersRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT id, barbershop_id, name, phone, email, avatar_url, status, commission_percentage, schedule, created_at, updated_at
     FROM public.barbers WHERE barbershop_id = $1 ORDER BY name`,
    [barbershopId]
  );
  res.json(r.rows);
});

barbersRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { name, phone, email, status, commission_percentage, schedule } = parsed.data;
  const r = await pool.query(
    `INSERT INTO public.barbers (barbershop_id, name, phone, email, status, commission_percentage, schedule)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, barbershop_id, name, phone, email, avatar_url, status, commission_percentage, schedule, created_at, updated_at`,
    [
      barbershopId,
      name,
      phone ?? null,
      email === "" ? null : email ?? null,
      status ?? "active",
      commission_percentage ?? 40,
      schedule ? JSON.stringify(schedule) : null,
    ]
  );
  res.status(201).json(r.rows[0]);
});

barbersRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT id, barbershop_id, name, phone, email, avatar_url, status, commission_percentage, schedule, created_at, updated_at
     FROM public.barbers WHERE id = $1 AND barbershop_id = $2`,
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbersRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const allowed = ["name", "phone", "email", "status", "commission_percentage", "schedule"];
  for (const key of allowed) {
    const v = (parsed.data as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (key === "schedule") {
      updates.push(`schedule = $${i++}::jsonb`);
      values.push(JSON.stringify(v));
    } else {
      updates.push(`${key} = $${i++}`);
      values.push(v === "" ? null : v);
    }
  }
  if (updates.length === 0) {
    const r = await pool.query(
      "SELECT * FROM public.barbers WHERE id = $1 AND barbershop_id = $2",
      [req.params.id, barbershopId]
    );
    if (r.rows.length === 0) res.status(404).json({ error: "Barber not found" });
    else res.json(r.rows[0]);
    return;
  }
  values.push(req.params.id, barbershopId);
  const r = await pool.query(
    `UPDATE public.barbers SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} AND barbershop_id = $${i + 1} RETURNING *`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbersRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    "DELETE FROM public.barbers WHERE id = $1 AND barbershop_id = $2 RETURNING id",
    [req.params.id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }
  res.status(204).send();
});
