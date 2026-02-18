import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

export const integrationsRouter = Router();
integrationsRouter.use(requireJwt);

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
