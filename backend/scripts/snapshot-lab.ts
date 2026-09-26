import "../src/load-env.js";
import { pool } from "../src/db.js";

async function main(): Promise<void> {
  const shop = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.barbershops ORDER BY created_at ASC LIMIT 1`,
  );
  const id = shop.rows[0].id;
  const conn = await pool.query(
    `SELECT provider, evolution_instance_name, status, whatsapp_phone
     FROM public.barbershop_whatsapp_connections WHERE barbershop_id = $1`,
    [id],
  );
  const clients = await pool.query(
    `SELECT name, phone, name_confirmed FROM public.clients WHERE barbershop_id = $1 ORDER BY updated_at DESC LIMIT 15`,
    [id],
  );
  const appts = await pool.query(
    `SELECT a.status, a.scheduled_date::text AS d, left(a.scheduled_time::text, 5) AS t,
            b.name AS barber, c.name AS client, c.phone
     FROM public.appointments a
     JOIN public.barbers b ON b.id = a.barber_id
     JOIN public.clients c ON c.id = a.client_id
     WHERE a.barbershop_id = $1 AND a.status <> 'cancelled'
     ORDER BY a.scheduled_date, a.scheduled_time LIMIT 20`,
    [id],
  );
  const plans = await pool.query(
    `SELECT c.phone, c.name, bp.name AS plan, bp.price::float8 AS price, s.status,
            ch.due_date::text AS due, ch.status AS charge
     FROM public.client_plan_subscriptions s
     JOIN public.clients c ON c.id = s.client_id
     JOIN public.barbershop_plans bp ON bp.id = s.plan_id
     LEFT JOIN public.plan_pix_charges ch ON ch.subscription_id = s.id
     WHERE s.barbershop_id = $1`,
    [id],
  );
  console.log(JSON.stringify({ shop: shop.rows[0].name, conn: conn.rows, clients: clients.rows, appts: appts.rows, plans: plans.rows }, null, 2));
  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
