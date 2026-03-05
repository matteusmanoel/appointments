import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId, getBarbershopScope } from "../middleware/auth.js";

const createBody = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "break"]).optional(),
  commission_percentage: z.number().int().min(0).max(100).optional(),
  schedule: z.record(z.unknown()).optional(),
  barbershop_id: z.string().uuid().optional(),
});
const updateBody = createBody.partial();

export const barbersRouter = Router();

barbersRouter.use(requireJwt);

barbersRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    `SELECT b.id, b.barbershop_id, b.name, b.phone, b.email, b.avatar_url, b.status, b.commission_percentage, b.schedule, b.created_at, b.updated_at
     ${"all" in scope ? ", bs.name AS barbershop_name" : ""}
     FROM public.barbers b
     ${"all" in scope ? "JOIN public.barbershops bs ON bs.id = b.barbershop_id" : ""}
     WHERE b.barbershop_id = ANY($1::uuid[]) ORDER BY b.name`,
    [ids]
  );
  res.json(r.rows);
});

barbersRouter.post("/", async (req: Request, res: Response): Promise<void> => {
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
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    `SELECT id, barbershop_id, name, phone, email, avatar_url, status, commission_percentage, schedule, created_at, updated_at
     FROM public.barbers WHERE id = $1 AND barbershop_id = ANY($2::uuid[])`,
    [req.params.id, ids]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbersRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
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
      "SELECT * FROM public.barbers WHERE id = $1 AND barbershop_id = ANY($2::uuid[])",
      [req.params.id, ids]
    );
    if (r.rows.length === 0) res.status(404).json({ error: "Barber not found" });
    else res.json(r.rows[0]);
    return;
  }
  values.push(req.params.id, ids);
  const r = await pool.query(
    `UPDATE public.barbers SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} AND barbershop_id = ANY($${i + 1}::uuid[]) RETURNING *`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbersRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const r = await pool.query(
    "DELETE FROM public.barbers WHERE id = $1 AND barbershop_id = ANY($2::uuid[]) RETURNING id",
    [req.params.id, ids]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barber not found" });
    return;
  }
  res.status(204).send();
});
