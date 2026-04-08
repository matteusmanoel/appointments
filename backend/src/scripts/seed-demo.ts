/**
 * Seed de dados de demonstração: serviços, barbeiros, clientes.
 * Rode após o seed principal (estabelecimento + admin). Idempotente: só insere se não houver dados.
 * Barbeiros usam os nomes reais dos testes (Eduardo Gustavo / Lucas Lima).
 */
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for seed-demo");
const pool = new pg.Pool({ connectionString: databaseUrl });

const DEFAULT_SCHEDULE = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

const DEFAULT_BUSINESS_HOURS = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

async function seedDemo() {
  const client = await pool.connect();
  try {
    const shop = await client.query(
      "SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1",
    );
    if (shop.rows.length === 0) {
      console.log("Run the main seed first: node dist/scripts/seed.js");
      return;
    }
    const barbershopId = shop.rows[0].id;
    console.log("Using barbershop:", barbershopId);

    // Garantir business_hours correto (09:00–19:00 seg-sex, sáb 09:00–18:00)
    await client.query(
      `UPDATE public.barbershops SET business_hours = $1::jsonb WHERE id = $2`,
      [JSON.stringify(DEFAULT_BUSINESS_HOURS), barbershopId],
    );
    console.log("Updated business_hours");

    // Serviços
    const servicesCount = await client.query(
      "SELECT 1 FROM public.services WHERE barbershop_id = $1 LIMIT 1",
      [barbershopId],
    );
    if (servicesCount.rows.length === 0) {
      await client.query(
        `INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, category)
         VALUES
           ($1, 'Corte masculino',  'Corte moderno com máquina e tesoura', 35.00, 30, 'corte'),
           ($1, 'Barba completa',   'Barba com toalha quente e finalização', 25.00, 25, 'barba'),
           ($1, 'Corte e Barba',    'Combo completo: corte + barba', 55.00, 50, 'combo'),
           ($1, 'Sobrancelha',      'Design e correção de sobrancelha', 15.00, 15, 'adicional')`,
        [barbershopId],
      );
      console.log("Created 4 services (Corte masculino, Barba completa, Corte e Barba, Sobrancelha)");
    } else {
      console.log("Services already exist, skipping");
    }

    // Barbeiros
    const barbersCount = await client.query(
      "SELECT 1 FROM public.barbers WHERE barbershop_id = $1 LIMIT 1",
      [barbershopId],
    );
    let barberIds: string[] = [];
    if (barbersCount.rows.length === 0) {
      const barbers = await client.query(
        `INSERT INTO public.barbers (barbershop_id, name, phone, status, commission_percentage, schedule)
         VALUES
           ($1, 'Eduardo Gustavo', '45991234567', 'active', 40, $2::jsonb),
           ($1, 'Lucas Lima',      '45997654321', 'active', 40, $2::jsonb)
         RETURNING id`,
        [barbershopId, JSON.stringify(DEFAULT_SCHEDULE)],
      );
      barberIds = barbers.rows.map((r: { id: string }) => r.id);
      console.log("Created 2 barbers: Eduardo Gustavo, Lucas Lima");

      // Vincular barbeiros a todos os serviços
      const serviceIds = await client.query(
        "SELECT id FROM public.services WHERE barbershop_id = $1",
        [barbershopId],
      );
      for (const barberId of barberIds) {
        for (const s of serviceIds.rows) {
          await client.query(
            "INSERT INTO public.barber_services (barber_id, service_id) VALUES ($1, $2) ON CONFLICT (barber_id, service_id) DO NOTHING",
            [barberId, s.id],
          );
        }
      }
      console.log("Linked barbers to all services");
    } else {
      const existing = await client.query(
        "SELECT id FROM public.barbers WHERE barbershop_id = $1",
        [barbershopId],
      );
      barberIds = existing.rows.map((r: { id: string }) => r.id);
      console.log("Barbers already exist, skipping");
    }

    // Clientes de teste
    const clientsCount = await client.query(
      "SELECT 1 FROM public.clients WHERE barbershop_id = $1 LIMIT 1",
      [barbershopId],
    );
    if (clientsCount.rows.length === 0) {
      await client.query(
        `INSERT INTO public.clients (barbershop_id, name, phone)
         VALUES
           ($1, 'Mateus Manoel', '554588230845'),
           ($1, 'Pedro Oliveira', '45998022522'),
           ($1, 'Ana Costa',     '45991112233')`,
        [barbershopId],
      );
      console.log("Created 3 test clients");
    } else {
      console.log("Clients already exist, skipping");
    }

    console.log("Seed demo finished — no appointments created (clean slate).");
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemo().catch((e) => {
  console.error(e);
  process.exit(1);
});
