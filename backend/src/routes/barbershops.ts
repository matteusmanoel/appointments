import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

const dayHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});
const businessHoursSchema = z.object({
  monday: dayHoursSchema.nullable().optional(),
  tuesday: dayHoursSchema.nullable().optional(),
  wednesday: dayHoursSchema.nullable().optional(),
  thursday: dayHoursSchema.nullable().optional(),
  friday: dayHoursSchema.nullable().optional(),
  saturday: dayHoursSchema.nullable().optional(),
  sunday: dayHoursSchema.nullable().optional(),
});

const slugSchema = z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, "Slug: apenas letras minúsculas, números e hífens");

const updateBody = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  business_hours: businessHoursSchema.optional(),
  slug: slugSchema.optional(),
});

const createBranchBody = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  slug: slugSchema.optional(),
});

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "unidade";
}

export const barbershopsRouter = Router();

barbershopsRouter.get("/", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    "SELECT id, name, phone, email, address, business_hours, slug, created_at, updated_at FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barbershop not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbershopsRouter.patch("/", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { name, phone, email, address, business_hours, slug } = parsed.data;
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (name !== undefined) {
    updates.push(`name = $${i++}`);
    values.push(name);
  }
  if (phone !== undefined) {
    updates.push(`phone = $${i++}`);
    values.push(phone);
  }
  if (email !== undefined) {
    updates.push(`email = $${i++}`);
    values.push(email === "" ? null : email);
  }
  if (address !== undefined) {
    updates.push(`address = $${i++}`);
    values.push(address);
  }
  if (business_hours !== undefined) {
    updates.push(`business_hours = $${i++}`);
    values.push(JSON.stringify(business_hours));
  }
  if (slug !== undefined) {
    updates.push(`slug = $${i++}`);
    values.push(slug);
  }
  if (updates.length === 0) {
    const r = await pool.query(
      "SELECT id, name, phone, email, address, business_hours, slug FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    res.json(r.rows[0] ?? { error: "Not found" });
    return;
  }
  values.push(barbershopId);
  const r = await pool.query(
    `UPDATE public.barbershops SET ${updates.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING id, name, phone, email, address, business_hours, slug, created_at, updated_at`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Barbershop not found" });
    return;
  }
  res.json(r.rows[0]);
});

// --- Create new branch (Premium only) ---
barbershopsRouter.post("/", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { name, slug: bodySlug } = parsed.data;

  const current = await pool.query<{ account_id: string | null; billing_plan: string | null; name: string }>(
    "SELECT account_id, billing_plan, name FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  if (current.rows.length === 0) {
    res.status(404).json({ error: "Barbershop not found" });
    return;
  }
  const row = current.rows[0];
  if ((row.billing_plan ?? "pro") !== "premium") {
    res.status(403).json({ error: "Criar nova unidade é recurso do plano Premium." });
    return;
  }

  let accountId: string = row.account_id as string;
  if (!accountId) {
    const accountResult = await pool.query<{ id: string }>(
      "INSERT INTO public.accounts (name) VALUES ($1) RETURNING id",
      [row.name || "Minha conta"]
    );
    accountId = accountResult.rows[0].id;
    await pool.query("UPDATE public.barbershops SET account_id = $1 WHERE id = $2", [accountId, barbershopId]);
  }

  let slug: string;
  if (bodySlug && bodySlug.trim().length >= 2) {
    slug = bodySlug.trim().toLowerCase();
    const existing = await pool.query("SELECT id FROM public.barbershops WHERE slug = $1", [slug]);
    if (existing.rows.length > 0) {
      res.status(400).json({ error: "Slug já em uso. Escolha outro." });
      return;
    }
  } else {
    const base = slugify(name);
    slug = base;
    for (let attempt = 0; attempt < 10; attempt++) {
      const exists = await pool.query("SELECT id FROM public.barbershops WHERE slug = $1", [slug]);
      if (exists.rows.length === 0) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  const insertResult = await pool.query<{ id: string; name: string; slug: string; created_at: string; updated_at: string }>(
    `INSERT INTO public.barbershops (account_id, name, slug, billing_plan)
     VALUES ($1, $2, $3, 'premium')
     RETURNING id, name, slug, created_at, updated_at`,
    [accountId, name.trim(), slug]
  ).catch((err: { code?: string }) => {
    if (err.code === "23505") {
      res.status(400).json({ error: "Slug já em uso. Escolha outro." });
      return null;
    }
    throw err;
  });
  if (!insertResult) return;

  const created = insertResult.rows[0];
  res.status(201).json(created);
});

// --- Barbershop closures (exceptions: holidays, unexpected closures) ---
const closureStatusSchema = z.enum(["closed", "open_partial"]);
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional();
const createClosureBody = z.object({
  closure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: closureStatusSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  reason: z.string().max(500).optional(),
});
const updateClosureBody = z.object({
  status: closureStatusSchema.optional(),
  start_time: timeSchema.nullable(),
  end_time: timeSchema.nullable(),
  reason: z.string().max(500).optional().nullable(),
});

barbershopsRouter.get("/closures", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT id, barbershop_id, closure_date, status, start_time, end_time, reason, created_at, updated_at
     FROM public.barbershop_closures WHERE barbershop_id = $1 ORDER BY closure_date DESC`,
    [barbershopId]
  );
  res.json(r.rows);
});

barbershopsRouter.post("/closures", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = createClosureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { closure_date, status, start_time, end_time, reason } = parsed.data;
  const r = await pool.query(
    `INSERT INTO public.barbershop_closures (barbershop_id, closure_date, status, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, barbershop_id, closure_date, status, start_time, end_time, reason, created_at, updated_at`,
    [barbershopId, closure_date, status, start_time ?? null, end_time ?? null, reason ?? null]
  );
  res.status(201).json(r.rows[0]);
});

barbershopsRouter.get("/closures/:id", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const { id } = req.params;
  const r = await pool.query(
    `SELECT id, barbershop_id, closure_date, status, start_time, end_time, reason, created_at, updated_at
     FROM public.barbershop_closures WHERE id = $1 AND barbershop_id = $2`,
    [id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Closure not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbershopsRouter.patch("/closures/:id", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const { id } = req.params;
  const parsed = updateClosureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { status, start_time, end_time, reason } = parsed.data;
  const updates: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  let i = 1;
  if (status !== undefined) {
    updates.push(`status = $${i++}`);
    values.push(status);
  }
  if (start_time !== undefined) {
    updates.push(`start_time = $${i++}`);
    values.push(start_time);
  }
  if (end_time !== undefined) {
    updates.push(`end_time = $${i++}`);
    values.push(end_time);
  }
  if (reason !== undefined) {
    updates.push(`reason = $${i++}`);
    values.push(reason);
  }
  if (values.length === 0) {
    const r = await pool.query(
      `SELECT id, barbershop_id, closure_date, status, start_time, end_time, reason, created_at, updated_at
       FROM public.barbershop_closures WHERE id = $1 AND barbershop_id = $2`,
      [id, barbershopId]
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Closure not found" });
      return;
    }
    res.json(r.rows[0]);
    return;
  }
  values.push(id, barbershopId);
  const r = await pool.query(
    `UPDATE public.barbershop_closures SET ${updates.join(", ")} WHERE id = $${i++} AND barbershop_id = $${i} RETURNING id, barbershop_id, closure_date, status, start_time, end_time, reason, created_at, updated_at`,
    values
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Closure not found" });
    return;
  }
  res.json(r.rows[0]);
});

barbershopsRouter.delete("/closures/:id", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const { id } = req.params;
  const r = await pool.query(
    "DELETE FROM public.barbershop_closures WHERE id = $1 AND barbershop_id = $2 RETURNING id",
    [id, barbershopId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: "Closure not found" });
    return;
  }
  res.status(204).send();
});
