import "../load-env.js";
/**
 * Limpa agenda/conversas da loja local e deixa o catálogo dos cenários golden.
 * Não mexe em login nem na sessão WhatsApp.
 *
 * npx tsx src/scripts/seed-golden-lab.ts
 */
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

const ALLOWED_CLIENT = "5545988432998";
const LAB_CLIENT = "5545988230845";
const BLOCKER_PHONE = "5500000000099";

const HOURS = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

const SERVICES: Array<[string, string, number, number, string]> = [
  ["Corte masculino", "Corte moderno com máquina e tesoura", 35, 30, "corte"],
  ["Barba completa", "Barba com toalha quente e finalização", 25, 25, "barba"],
  ["Corte e Barba", "Combo completo: corte + barba", 55, 50, "combo"],
  ["Sobrancelha", "Design e correção de sobrancelha", 15, 15, "adicional"],
];

async function wipe(client: pg.PoolClient, barbershopId: string): Promise<void> {
  const steps = [
    `DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE barbershop_id = $1)`,
    `DELETE FROM public.scheduled_messages WHERE barbershop_id = $1`,
    `DELETE FROM public.agenda_activity WHERE barbershop_id = $1`,
    `DELETE FROM public.appointments WHERE barbershop_id = $1`,
    `DELETE FROM public.appointment_waitlist WHERE barbershop_id = $1`,
    `DELETE FROM public.ai_jobs WHERE barbershop_id = $1`,
    `DELETE FROM public.ai_messages WHERE conversation_id IN (SELECT id FROM public.ai_conversations WHERE barbershop_id = $1)`,
    `DELETE FROM public.ai_handoff_events WHERE barbershop_id = $1`,
    `DELETE FROM public.ai_conversation_runtime WHERE conversation_id IN (SELECT id FROM public.ai_conversations WHERE barbershop_id = $1)`,
    `DELETE FROM public.ai_conversations WHERE barbershop_id = $1`,
    `DELETE FROM public.whatsapp_inbound_events WHERE barbershop_id = $1`,
    `DELETE FROM public.plan_pix_charges WHERE barbershop_id = $1`,
    `DELETE FROM public.client_plan_subscriptions WHERE barbershop_id = $1`,
    `DELETE FROM public.service_redemptions WHERE client_id IN (SELECT id FROM public.clients WHERE barbershop_id = $1)`,
    `DELETE FROM public.reward_redemptions WHERE client_id IN (SELECT id FROM public.clients WHERE barbershop_id = $1)`,
    `DELETE FROM public.client_ai_memory WHERE client_id IN (SELECT id FROM public.clients WHERE barbershop_id = $1)`,
    `DELETE FROM public.clients WHERE barbershop_id = $1`,
  ];
  for (const sql of steps) {
    await client.query(sql, [barbershopId]).catch((e: { code?: string }) => {
      if (e.code !== "42P01") throw e;
    });
  }
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const shop = await client.query<{ id: string; pix_key: string | null }>(
      `SELECT id, pix_key FROM public.barbershops ORDER BY created_at ASC LIMIT 1`,
    );
    if (!shop.rows[0]) throw new Error("Nenhuma barbearia. Rode seed.ts antes.");
    const barbershopId = shop.rows[0].id;

    await client.query("BEGIN");
    await wipe(client, barbershopId);
    await client.query(
      `UPDATE public.barbershops
       SET billing_plan = 'premium',
           business_hours = $2::jsonb,
           pix_key = COALESCE(NULLIF(pix_key, ''), $3),
           pix_key_type = COALESCE(pix_key_type, 'telefone'),
           pix_holder_name = COALESCE(NULLIF(pix_holder_name, ''), name)
       WHERE id = $1`,
      [barbershopId, JSON.stringify(HOURS), ALLOWED_CLIENT],
    );

    for (const [name, description, price, duration, category] of SERVICES) {
      await client.query(
        `INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, category, is_active)
         SELECT $1, $2, $3, $4, $5, $6, true
         WHERE NOT EXISTS (
           SELECT 1 FROM public.services WHERE barbershop_id = $1 AND lower(name) = lower($2)
         )`,
        [barbershopId, name, description, price, duration, category],
      );
    }

    const barbers = await client.query<{ id: string }>(
      `SELECT id FROM public.barbers WHERE barbershop_id = $1 AND status = 'active'`,
      [barbershopId],
    );
    if (barbers.rows.length === 0) {
      await client.query(
        `INSERT INTO public.barbers (barbershop_id, name, phone, status, commission_percentage, schedule)
         VALUES
           ($1, 'Eduardo Gustavo', '45991234567', 'active', 40, $2::jsonb),
           ($1, 'Lucas Lima', '45997654321', 'active', 40, $2::jsonb)`,
        [barbershopId, JSON.stringify(HOURS)],
      );
    }
    await client.query(
      `INSERT INTO public.barber_services (barber_id, service_id)
       SELECT b.id, s.id
       FROM public.barbers b
       JOIN public.services s ON s.barbershop_id = b.barbershop_id
       WHERE b.barbershop_id = $1
       ON CONFLICT (barber_id, service_id) DO NOTHING`,
      [barbershopId],
    );

    const combo = await client.query<{ id: string }>(
      `SELECT id FROM public.services
       WHERE barbershop_id = $1 AND name ILIKE '%corte e barba%' AND is_active = true
       LIMIT 1`,
      [barbershopId],
    );
    const plan = await client.query<{ id: string }>(
      `INSERT INTO public.barbershop_plans (barbershop_id, name, description, service_ids, price, billing_cycle, is_active)
       VALUES ($1, 'Corte e Barba', 'Plano mensal do combo', $2::uuid[], 200, 'monthly', true)
       RETURNING id`,
      [barbershopId, combo.rows[0] ? [combo.rows[0].id] : []],
    );
    const mateus = await client.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed)
       VALUES ($1, 'Mateus', $2, true)
       RETURNING id`,
      [barbershopId, LAB_CLIENT],
    );
    const sub = await client.query<{ id: string }>(
      `INSERT INTO public.client_plan_subscriptions
         (barbershop_id, client_id, plan_id, billing_day, next_billing_date, status)
       VALUES ($1, $2, $3, 1, date_trunc('month', now())::date, 'active')
       RETURNING id`,
      [barbershopId, mateus.rows[0].id, plan.rows[0].id],
    );
    await client.query(
      `INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status)
       VALUES ($1, $2, 200, (date_trunc('month', now()) - interval '1 month')::date, 'pending')`,
      [sub.rows[0].id, barbershopId],
    );

    const blocker = await client.query<{ id: string }>(
      `INSERT INTO public.clients (barbershop_id, name, phone)
       VALUES ($1, 'Bloqueio de teste', $2)
       RETURNING id`,
      [barbershopId, BLOCKER_PHONE],
    );
    const lucas = await client.query<{ id: string }>(
      `SELECT id FROM public.barbers
       WHERE barbershop_id = $1 AND name ILIKE '%Lucas%' AND status = 'active'
       LIMIT 1`,
      [barbershopId],
    );
    const corte = await client.query<{ id: string; price: string; duration_minutes: number; name: string }>(
      `SELECT id, price::text, duration_minutes, name FROM public.services
       WHERE barbershop_id = $1 AND name ILIKE '%corte masculino%' LIMIT 1`,
      [barbershopId],
    );
    if (lucas.rows[0] && corte.rows[0]) {
      const when = await client.query<{ d: string }>(
        `SELECT ((timezone('America/Sao_Paulo', now()))::date + 1)::text AS d`,
      );
      const app = await client.query<{ id: string }>(
        `INSERT INTO public.appointments (
           barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time,
           duration_minutes, price, commission_amount, status
         ) VALUES ($1, $2, $3, $4, $5::date, '10:00', $6, $7, 0, 'pending')
         RETURNING id`,
        [
          barbershopId,
          blocker.rows[0].id,
          lucas.rows[0].id,
          corte.rows[0].id,
          when.rows[0].d,
          corte.rows[0].duration_minutes,
          corte.rows[0].price,
        ],
      );
      await client.query(
        `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
         VALUES ($1, $2, $3, $4, $5, 0)`,
        [app.rows[0].id, corte.rows[0].id, corte.rows[0].price, corte.rows[0].duration_minutes, corte.rows[0].name],
      );
      console.log("Lucas ocupado amanhã 10:00 (bloqueio de teste)");
    }

    await client.query("COMMIT");
    console.log("Seed golden lab ok", barbershopId);
    console.log("Cliente do lab:", LAB_CLIENT, "plano Corte e Barba R$ 200 com cobrança do mês anterior");
    console.log("PIX da loja:", shop.rows[0].pix_key || ALLOWED_CLIENT);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
