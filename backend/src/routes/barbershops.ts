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
