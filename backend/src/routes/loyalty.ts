import { Router, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

const redeemBody = z.object({
  client_id: z.string().uuid(),
  service_id: z.string().uuid(),
});

export const loyaltyRouter = Router();

loyaltyRouter.use(requireJwt);

/** GET /api/loyalty/stats - estatísticas para os cards */
loyaltyRouter.get("/stats", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);

  const [clientsWithPoints, pointsThisMonth, redemptionsThisMonth] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count FROM public.clients WHERE barbershop_id = $1 AND loyalty_points > 0`,
      [barbershopId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(s.points_to_earn), 0)::int AS total
       FROM public.appointments a
       JOIN public.appointment_services aps ON aps.appointment_id = a.id
       JOIN public.services s ON s.id = aps.service_id
       WHERE a.barbershop_id = $1 AND a.status = 'completed'
         AND a.updated_at >= date_trunc('month', current_date)`,
      [barbershopId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM public.service_redemptions sr
       JOIN public.clients c ON c.id = sr.client_id
       WHERE c.barbershop_id = $1 AND sr.redeemed_at >= date_trunc('month', current_date)`,
      [barbershopId]
    ),
  ]);

  res.json({
    clients_with_points: clientsWithPoints.rows[0]?.count ?? 0,
    points_distributed_this_month: pointsThisMonth.rows[0]?.total ?? 0,
    redemptions_this_month: redemptionsThisMonth.rows[0]?.count ?? 0,
  });
});

/** GET /api/loyalty/rewards - serviços resgatáveis (points_to_redeem > 0) */
loyaltyRouter.get("/rewards", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const r = await pool.query(
    `SELECT id, name, points_to_redeem
     FROM public.services
     WHERE barbershop_id = $1 AND is_active = true
       AND points_to_redeem IS NOT NULL AND points_to_redeem > 0
     ORDER BY points_to_redeem`,
    [barbershopId]
  );
  res.json(r.rows);
});

/** GET /api/loyalty/ranking - top clientes por pontos */
loyaltyRouter.get("/ranking", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const r = await pool.query(
    `SELECT id, name, phone, loyalty_points
     FROM public.clients
     WHERE barbershop_id = $1
     ORDER BY loyalty_points DESC
     LIMIT $2`,
    [barbershopId, limit]
  );
  res.json(r.rows);
});

/** POST /api/loyalty/redeem - resgatar pontos por um serviço */
loyaltyRouter.post("/redeem", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const parsed = redeemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { client_id, service_id } = parsed.data;

  const client = await pool.query(
    "SELECT id, loyalty_points FROM public.clients WHERE id = $1 AND barbershop_id = $2",
    [client_id, barbershopId]
  );
  if (client.rows.length === 0) {
    res.status(404).json({ error: "Cliente não encontrado" });
    return;
  }

  const service = await pool.query(
    "SELECT id, name, points_to_redeem FROM public.services WHERE id = $1 AND barbershop_id = $2",
    [service_id, barbershopId]
  );
  if (service.rows.length === 0) {
    res.status(404).json({ error: "Serviço não encontrado" });
    return;
  }

  const pointsRequired = service.rows[0].points_to_redeem;
  if (pointsRequired == null || pointsRequired <= 0) {
    res.status(400).json({ error: "Este serviço não está disponível para resgate" });
    return;
  }

  const currentPoints = client.rows[0].loyalty_points ?? 0;
  if (currentPoints < pointsRequired) {
    res.status(400).json({
      error: "Pontos insuficientes",
      required: pointsRequired,
      current: currentPoints,
    });
    return;
  }

  await pool.query("BEGIN");
  try {
    await pool.query(
      "UPDATE public.clients SET loyalty_points = loyalty_points - $1, updated_at = now() WHERE id = $2",
      [pointsRequired, client_id]
    );
    await pool.query(
      `INSERT INTO public.service_redemptions (client_id, service_id, points_spent)
       VALUES ($1, $2, $3)
       RETURNING id, client_id, service_id, points_spent, redeemed_at`,
      [client_id, service_id, pointsRequired]
    );
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }

  const redemption = await pool.query(
    `SELECT sr.id, sr.client_id, sr.service_id, sr.points_spent, sr.redeemed_at,
            c.name AS client_name, s.name AS service_name
     FROM public.service_redemptions sr
     JOIN public.clients c ON c.id = sr.client_id
     JOIN public.services s ON s.id = sr.service_id
     WHERE sr.client_id = $1 AND sr.service_id = $2
     ORDER BY sr.redeemed_at DESC LIMIT 1`,
    [client_id, service_id]
  );

  res.status(201).json(redemption.rows[0]);
});

/** GET /api/loyalty/redemptions - resgates recentes */
loyaltyRouter.get("/redemptions", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const r = await pool.query(
    `SELECT sr.id, sr.client_id, sr.service_id, sr.points_spent, sr.redeemed_at,
            c.name AS client_name, s.name AS service_name
     FROM public.service_redemptions sr
     JOIN public.clients c ON c.id = sr.client_id
     JOIN public.services s ON s.id = sr.service_id
     WHERE c.barbershop_id = $1
     ORDER BY sr.redeemed_at DESC
     LIMIT $2`,
    [barbershopId, limit]
  );
  res.json(r.rows);
});
