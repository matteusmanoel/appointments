/**
 * Seed de dados de teste: serviços, barbeiros, clientes e agendamentos.
 * Rode após o seed principal (estabelecimento + admin). Idempotente: só insere se não houver dados.
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

async function seedDemo() {
  const client = await pool.connect();
  try {
    const shop = await client.query("SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1");
    if (shop.rows.length === 0) {
      console.log("Run the main seed first: node dist/scripts/seed.js");
      return;
    }
    const barbershopId = shop.rows[0].id;
    console.log("Using barbershop:", barbershopId);

    // Serviços
    const servicesCount = await client.query("SELECT 1 FROM public.services WHERE barbershop_id = $1 LIMIT 1", [barbershopId]);
    if (servicesCount.rows.length === 0) {
      await client.query(
        `INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, category)
         VALUES ($1, $2, $3, $4, $5, $6), ($1, $7, $8, $9, $10, $11), ($1, $12, $13, $14, $15, $16), ($1, $17, $18, $19, $20, $21)`,
        [
          barbershopId,
          "Corte masculino",
          "Corte moderno com máquina e tesoura",
          35.0,
          30,
          "corte",
          "Barba completa",
          "Barba com toalha quente e finalização",
          25.0,
          25,
          "barba",
          "Corte + Barba",
          "Combo completo",
          55.0,
          50,
          "combo",
          "Sobrancelha",
          "Design e correção",
          15.0,
          15,
          "adicional",
        ]
      );
      console.log("Created 4 services");
    } else {
      console.log("Services already exist, skipping");
    }

    // Barbeiros
    const barbersCount = await client.query("SELECT 1 FROM public.barbers WHERE barbershop_id = $1 LIMIT 1", [barbershopId]);
    let barberIds: string[] = [];
    if (barbersCount.rows.length === 0) {
      const barbers = await client.query(
        `INSERT INTO public.barbers (barbershop_id, name, phone, status, commission_percentage, schedule)
         VALUES ($1, $2, $3, 'active', 40, $4::jsonb), ($1, $5, $6, 'active', 40, $4::jsonb)
         RETURNING id`,
        [barbershopId, "João Silva", "11987654321", JSON.stringify(DEFAULT_SCHEDULE), "Carlos Santos", "11976543210"]
      );
      barberIds = barbers.rows.map((r: { id: string }) => r.id);
      console.log("Created 2 barbers:", barberIds);

      // Vincular barbeiros aos serviços (todos podem fazer todos os serviços)
      const serviceIds = await client.query("SELECT id FROM public.services WHERE barbershop_id = $1", [barbershopId]);
      for (const barberId of barberIds) {
        for (const s of serviceIds.rows) {
          await client.query(
            "INSERT INTO public.barber_services (barber_id, service_id) VALUES ($1, $2) ON CONFLICT (barber_id, service_id) DO NOTHING",
            [barberId, s.id]
          );
        }
      }
      console.log("Linked barbers to services");
    } else {
      const existing = await client.query("SELECT id FROM public.barbers WHERE barbershop_id = $1", [barbershopId]);
      barberIds = existing.rows.map((r: { id: string }) => r.id);
      console.log("Barbers already exist, skipping");
    }

    // Clientes
    const clientsCount = await client.query("SELECT 1 FROM public.clients WHERE barbershop_id = $1 LIMIT 1", [barbershopId]);
    let clientIds: string[] = [];
    if (clientsCount.rows.length === 0) {
      const clients = await client.query(
        `INSERT INTO public.clients (barbershop_id, name, phone)
         VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $7)
         RETURNING id`,
        [barbershopId, "Pedro Oliveira", "45998022522", "Maria Souza", "11999887766", "Lucas Lima", "21988776655"]
      );
      clientIds = clients.rows.map((r: { id: string }) => r.id);
      console.log("Created 3 clients");
    } else {
      const existing = await client.query("SELECT id FROM public.clients WHERE barbershop_id = $1 LIMIT 3", [barbershopId]);
      clientIds = existing.rows.map((r: { id: string }) => r.id);
      console.log("Clients already exist, skipping");
    }

    // Agendamentos (amanhã e depois)
    const serviceIds = await client.query("SELECT id FROM public.services WHERE barbershop_id = $1 LIMIT 1", [barbershopId]);
    const firstService = serviceIds.rows[0];
    if (firstService && barberIds.length > 0 && clientIds.length > 0) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().slice(0, 10);
      const apptCount = await client.query(
        "SELECT 1 FROM public.appointments WHERE barbershop_id = $1 LIMIT 1",
        [barbershopId]
      );
      if (apptCount.rows.length === 0) {
        await client.query(
          `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
           VALUES ($1, $2, $3, $4, $5::date, '10:00'::time, 30, 35.0, 14.0, 'pending'),
                  ($1, $6, $7, $4, $5::date, '14:30'::time, 30, 35.0, 14.0, 'confirmed')`,
          [
            barbershopId,
            clientIds[0],
            barberIds[0],
            firstService.id,
            dateStr,
            clientIds[1],
            barberIds[1],
          ]
        );
        console.log("Created 2 demo appointments");
      } else {
        console.log("Appointments already exist, skipping");
      }
    }

    console.log("Seed demo finished.");
  } finally {
    client.release();
    await pool.end();
  }
}

seedDemo().catch((e) => {
  console.error(e);
  process.exit(1);
});
