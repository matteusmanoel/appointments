import bcrypt from "bcryptjs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for seed");
const pool = new pg.Pool({ connectionString: databaseUrl });

async function seed() {
  const client = await pool.connect();
  try {
    let barbershopId: string;
    const existingShop = await client.query("SELECT id FROM public.barbershops LIMIT 1");
    if (existingShop.rows.length > 0) {
      barbershopId = existingShop.rows[0].id;
      console.log("Using existing barbershop:", barbershopId);
    } else {
      const barbershopResult = await client.query(
        `INSERT INTO public.barbershops (name, phone, email, address)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          process.env.SEED_BARBERSHOP_NAME ?? "Minha Barbearia",
          process.env.SEED_BARBERSHOP_PHONE ?? null,
          process.env.SEED_BARBERSHOP_EMAIL ?? null,
          process.env.SEED_BARBERSHOP_ADDRESS ?? null,
        ]
      );
      barbershopId = barbershopResult.rows[0].id;
      console.log("Created barbershop:", barbershopId);
    }

    const email = process.env.SEED_ADMIN_EMAIL ?? "admin@barbearia.com";
    const password = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
    const passwordHash = await bcrypt.hash(password, 10);
    const profileExists = await client.query("SELECT 1 FROM public.profiles WHERE email = $1", [email]);
    if (profileExists.rows.length === 0) {
      await client.query(
        `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'admin')`,
        [barbershopId, process.env.SEED_ADMIN_NAME ?? "Admin", email, passwordHash]
      );
      console.log("Created admin profile (email:", email, ")");
    } else {
      console.log("Admin profile already exists (email:", email, ")");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
