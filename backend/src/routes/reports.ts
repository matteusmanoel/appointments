import { Router, Request, Response } from "express";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";

export const reportsRouter = Router();

reportsRouter.use(requireJwt);

reportsRouter.get("/revenue_by_day", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const from = (req.query.from as string) ?? "";
  const to = (req.query.to as string) ?? "";
  if (!from || !to) {
    res.status(400).json({ error: "Query params 'from' and 'to' (YYYY-MM-DD) are required" });
    return;
  }
  const r = await pool.query(
    `SELECT scheduled_date AS date,
            COALESCE(SUM(price), 0)::numeric AS revenue,
            COUNT(*)::int AS appointments
     FROM public.appointments
     WHERE barbershop_id = $1 AND status = 'completed'
       AND scheduled_date >= $2::date AND scheduled_date <= $3::date
     GROUP BY scheduled_date
     ORDER BY scheduled_date`,
    [barbershopId, from, to]
  );
  res.json(r.rows);
});

reportsRouter.get("/top_services", async (req: Request, res: Response): Promise<void> => {
  const barbershopId = getBarbershopId(req);
  const from = (req.query.from as string) ?? "";
  const to = (req.query.to as string) ?? "";
  const limit = Math.min(parseInt(String(req.query.limit ?? "5"), 10) || 5, 20);
  if (!from || !to) {
    res.status(400).json({ error: "Query params 'from' and 'to' (YYYY-MM-DD) are required" });
    return;
  }
  const r = await pool.query(
    `SELECT aps.service_id,
            COALESCE(aps.service_name, s.name) AS service_name,
            COUNT(*)::int AS count,
            COALESCE(SUM(aps.price), 0)::numeric AS revenue
     FROM public.appointment_services aps
     JOIN public.appointments a ON a.id = aps.appointment_id AND a.barbershop_id = $1
     LEFT JOIN public.services s ON s.id = aps.service_id
     WHERE a.status = 'completed'
       AND a.scheduled_date >= $2::date AND a.scheduled_date <= $3::date
     GROUP BY aps.service_id, COALESCE(aps.service_name, s.name)
     ORDER BY count DESC
     LIMIT $4`,
    [barbershopId, from, to, limit]
  );
  res.json(r.rows);
});
