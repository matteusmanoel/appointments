import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

export const plansRouter = Router();
plansRouter.use(requireJwt);

const billingCycleEnum = z.enum(["monthly", "quarterly", "yearly"]);

const planBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  service_ids: z.array(z.string().uuid()).optional().default([]),
  price: z.number().nonnegative(),
  billing_cycle: billingCycleEnum.optional().default("monthly"),
  max_visits: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
});

const createPlanBody = planBody;
const updatePlanBody = planBody.partial();

// ─── Plans CRUD ───────────────────────────────────────────────────────────────

plansRouter.get("/", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query(
      `SELECT p.id, p.name, p.description, p.service_ids, p.price, p.billing_cycle,
              p.max_visits, p.is_active, p.created_at, p.updated_at,
              COALESCE(
                (SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                 FROM public.services s WHERE s.id = ANY(p.service_ids) AND s.barbershop_id = $1),
                '[]'::json
              ) AS services_detail
       FROM public.barbershop_plans p
       WHERE p.barbershop_id = $1
       ORDER BY p.is_active DESC, p.price ASC`,
      [barbershopId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("[plans] list:", e);
    res.status(500).json({ error: "Failed to list plans" });
  }
});

plansRouter.post("/", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = createPlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_plans
         (barbershop_id, name, description, service_ids, price, billing_cycle, max_visits, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING id`,
      [
        barbershopId, d.name, d.description ?? null,
        d.service_ids, d.price, d.billing_cycle,
        d.max_visits ?? null, d.is_active ?? true,
      ]
    );
    res.status(201).json({ id: r.rows[0]!.id });
  } catch (e) {
    console.error("[plans] create:", e);
    res.status(500).json({ error: "Failed to create plan" });
  }
});

plansRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const { id } = req.params;
    const parsed = updatePlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    const fields: string[] = [];
    const vals: unknown[] = [id, barbershopId];
    const add = (col: string, v: unknown) => {
      if (v === undefined) return;
      vals.push(v);
      fields.push(`${col} = $${vals.length}`);
    };
    add("name", d.name);
    add("description", d.description);
    add("service_ids", d.service_ids);
    add("price", d.price);
    add("billing_cycle", d.billing_cycle);
    add("max_visits", d.max_visits);
    add("is_active", d.is_active);
    if (fields.length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
    fields.push(`updated_at = now()`);
    const r = await pool.query(
      `UPDATE public.barbershop_plans SET ${fields.join(", ")}
       WHERE id = $1 AND barbershop_id = $2 RETURNING id`,
      vals
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Plan not found" }); return; }
    res.json({ ok: true });
  } catch (e) {
    console.error("[plans] update:", e);
    res.status(500).json({ error: "Failed to update plan" });
  }
});

plansRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const { id } = req.params;
    await pool.query(
      `UPDATE public.barbershop_plans SET is_active = false, updated_at = now()
       WHERE id = $1 AND barbershop_id = $2`,
      [id, barbershopId]
    );
    res.status(204).end();
  } catch (e) {
    console.error("[plans] delete:", e);
    res.status(500).json({ error: "Failed to deactivate plan" });
  }
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

plansRouter.get("/subscriptions", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const r = await pool.query(
      `SELECT s.id, s.status, s.billing_day, s.next_billing_date, s.started_at, s.cancelled_at,
              c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
              p.id AS plan_id, p.name AS plan_name, p.price, p.billing_cycle
       FROM public.client_plan_subscriptions s
       JOIN public.clients c ON c.id = s.client_id
       JOIN public.barbershop_plans p ON p.id = s.plan_id
       WHERE s.barbershop_id = $1
       ORDER BY s.status ASC, s.next_billing_date ASC`,
      [barbershopId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("[plans] subscriptions list:", e);
    res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

const subscriptionCreateBody = z.object({
  client_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  billing_day: z.number().int().min(1).max(28).optional(),
});

plansRouter.post("/subscriptions", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const parsed = subscriptionCreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }
    const { client_id, plan_id, billing_day } = parsed.data;

    const planRow = await pool.query<{ price: string; billing_cycle: string }>(
      `SELECT price, billing_cycle FROM public.barbershop_plans WHERE id = $1 AND barbershop_id = $2 AND is_active = true`,
      [plan_id, barbershopId]
    );
    if (!planRow.rows[0]) { res.status(404).json({ error: "Plan not found or inactive" }); return; }
    const plan = planRow.rows[0];

    const today = new Date();
    const day = Math.min(Math.max(billing_day ?? today.getDate(), 1), 28);
    const nextDate = new Date(today.getFullYear(), today.getMonth(), day);
    if (nextDate <= today) nextDate.setMonth(nextDate.getMonth() + 1);
    const nextBillingStr = nextDate.toISOString().slice(0, 10);

    const sub = await pool.query<{ id: string }>(
      `INSERT INTO public.client_plan_subscriptions
         (barbershop_id, client_id, plan_id, billing_day, next_billing_date)
       VALUES ($1, $2, $3, $4, $5::date)
       RETURNING id`,
      [barbershopId, client_id, plan_id, day, nextBillingStr]
    );
    const subId = sub.rows[0]!.id;

    await pool.query(
      `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status)
       VALUES ($1, $2, $3::numeric, $4::date, 'pending')`,
      [subId, barbershopId, plan.price, nextBillingStr]
    );

    res.status(201).json({ id: subId, next_billing_date: nextBillingStr });
  } catch (e) {
    console.error("[plans] subscriptions create:", e);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

plansRouter.put("/subscriptions/:id/cancel", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE public.client_plan_subscriptions
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND barbershop_id = $2 AND status = 'active'
       RETURNING id`,
      [id, barbershopId]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Subscription not found or not active" }); return; }
    await pool.query(
      `UPDATE public.plan_pix_charges SET status = 'skipped' WHERE subscription_id = $1 AND status = 'pending'`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[plans] subscriptions cancel:", e);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

plansRouter.get("/subscriptions/:id/charges", async (req: Request, res: Response) => {
  try {
    const barbershopId = getBarbershopId(req);
    const { id } = req.params;
    const r = await pool.query(
      `SELECT id, amount, status, due_date, sent_at, paid_at, created_at
       FROM public.plan_pix_charges
       WHERE subscription_id = $1 AND barbershop_id = $2
       ORDER BY due_date DESC`,
      [id, barbershopId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("[plans] charges list:", e);
    res.status(500).json({ error: "Failed to list charges" });
  }
});
