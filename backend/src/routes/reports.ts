import { Router, Request, Response } from "express";
import { pool } from "../db.js";
import { requireJwt, getBarbershopScope } from "../middleware/auth.js";

export const reportsRouter = Router();

reportsRouter.use(requireJwt);

reportsRouter.get("/revenue_by_day", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
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
     WHERE barbershop_id = ANY($1::uuid[]) AND status = 'completed'
       AND scheduled_date >= $2::date AND scheduled_date <= $3::date
     GROUP BY scheduled_date
     ORDER BY scheduled_date`,
    [ids, from, to]
  );
  res.json(r.rows);
});

reportsRouter.get("/top_services", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
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
     JOIN public.appointments a ON a.id = aps.appointment_id AND a.barbershop_id = ANY($1::uuid[])
     LEFT JOIN public.services s ON s.id = aps.service_id
     WHERE a.status = 'completed'
       AND a.scheduled_date >= $2::date AND a.scheduled_date <= $3::date
     GROUP BY aps.service_id, COALESCE(aps.service_name, s.name)
     ORDER BY count DESC
     LIMIT $4`,
    [ids, from, to, limit]
  );
  res.json(r.rows);
});

/** GET /api/reports/mvp-metrics — no-show rate, reminders and follow-ups counts for dashboard cards */
reportsRouter.get("/mvp-metrics", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  try {
    const [noShow7, noShow30, reminders, followUps] = await Promise.all([
      pool.query<{ total: string; no_show: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'no_show')::text AS no_show
         FROM public.appointments
         WHERE barbershop_id = ANY($1::uuid[]) AND scheduled_date >= (CURRENT_DATE - 7) AND status IN ('completed', 'no_show')`,
        [ids]
      ),
      pool.query<{ total: string; no_show: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'no_show')::text AS no_show
         FROM public.appointments
         WHERE barbershop_id = ANY($1::uuid[]) AND scheduled_date >= (CURRENT_DATE - 30) AND status IN ('completed', 'no_show')`,
        [ids]
      ),
      pool.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count FROM public.scheduled_messages
         WHERE barbershop_id = ANY($1::uuid[]) AND type = 'reminder_24h' AND created_at >= date_trunc('month', now())
         GROUP BY status`,
        [ids]
      ),
      pool.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count FROM public.scheduled_messages
         WHERE barbershop_id = ANY($1::uuid[]) AND type = 'followup_30d' AND created_at >= date_trunc('month', now())
         GROUP BY status`,
        [ids]
      ),
    ]);
    const toRate = (row: { total: string; no_show: string }) => {
      const t = parseInt(row?.total ?? "0", 10);
      const n = parseInt(row?.no_show ?? "0", 10);
      return t > 0 ? Math.round((n / t) * 100) : 0;
    };
    const toCounts = (rows: { status: string; count: string }[]) => {
      const o = { sent: 0, failed: 0, skipped: 0 };
      for (const r of rows) {
        const n = parseInt(r.count, 10);
        if (r.status === "sent") o.sent = n;
        else if (r.status === "failed") o.failed = n;
        else if (r.status === "skipped") o.skipped = n;
      }
      return o;
    };
    res.json({
      noShowRate7d: toRate(noShow7.rows[0] ?? { total: "0", no_show: "0" }),
      noShowRate30d: toRate(noShow30.rows[0] ?? { total: "0", no_show: "0" }),
      reminders: toCounts(reminders.rows),
      followUps: toCounts(followUps.rows),
    });
  } catch (e) {
    console.error("reports mvp-metrics:", e);
    res.status(500).json({ error: "Falha ao carregar métricas" });
  }
});

/** GET /api/reports/commissions_by_barber?from=&to= — total commission by barber for completed appointments in period */
reportsRouter.get("/commissions_by_barber", async (req: Request, res: Response): Promise<void> => {
  let scope: { single: string } | { all: string[] };
  try {
    scope = await getBarbershopScope(req);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ids = "all" in scope ? scope.all : [scope.single];
  const from = (req.query.from as string) ?? "";
  const to = (req.query.to as string) ?? "";
  if (!from || !to) {
    res.status(400).json({ error: "Query params 'from' and 'to' (YYYY-MM-DD) are required" });
    return;
  }
  const r = await pool.query<{ barber_id: string; barber_name: string; barbershop_id?: string; barbershop_name?: string; total_commission: string }>(
    `SELECT a.barber_id,
            b.name AS barber_name,
            ${"all" in scope ? "a.barbershop_id, bs.name AS barbershop_name," : ""}
            COALESCE(SUM(a.commission_amount), 0)::numeric AS total_commission
     FROM public.appointments a
     JOIN public.barbers b ON b.id = a.barber_id AND b.barbershop_id = a.barbershop_id
     ${"all" in scope ? "JOIN public.barbershops bs ON bs.id = a.barbershop_id" : ""}
     WHERE a.barbershop_id = ANY($1::uuid[]) AND a.status = 'completed'
       AND a.scheduled_date >= $2::date AND a.scheduled_date <= $3::date
     GROUP BY a.barber_id, b.name${"all" in scope ? ", a.barbershop_id, bs.name" : ""}
     ORDER BY total_commission DESC`,
    [ids, from, to]
  );
  res.json(
    r.rows.map((row) => ({
      barber_id: row.barber_id,
      barber_name: row.barber_name,
      ...("all" in scope && row.barbershop_id && row.barbershop_name ? { barbershop_id: row.barbershop_id, barbershop_name: row.barbershop_name } : {}),
      total_commission: Number(row.total_commission),
    }))
  );
});
