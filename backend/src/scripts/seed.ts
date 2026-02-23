import bcrypt from "bcryptjs";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for seed");
const pool = new pg.Pool({ connectionString: databaseUrl });

async function seed() {
  const client = await pool.connect();
  try {
    let barbershopId: string;
    const existingShop = await client.query("SELECT id, account_id FROM public.barbershops ORDER BY created_at ASC LIMIT 1");
    if (existingShop.rows.length > 0) {
      barbershopId = existingShop.rows[0].id;
      console.log("Using existing barbershop:", barbershopId);
      await client.query(
        "UPDATE public.barbershops SET billing_plan = 'premium' WHERE id = $1",
        [barbershopId]
      );
    } else {
      const name = process.env.SEED_BARBERSHOP_NAME ?? "Minha NavalhIA";
      const slug = process.env.SEED_BARBERSHOP_SLUG ?? "minha-navalhia";
      const barbershopResult = await client.query(
        `INSERT INTO public.barbershops (name, slug, phone, email, address, billing_plan)
         VALUES ($1, $2, $3, $4, $5, 'premium')
         RETURNING id`,
        [
          name,
          slug,
          process.env.SEED_BARBERSHOP_PHONE ?? null,
          process.env.SEED_BARBERSHOP_EMAIL ?? null,
          process.env.SEED_BARBERSHOP_ADDRESS ?? null,
        ]
      );
      barbershopId = barbershopResult.rows[0].id;
      console.log("Created barbershop (premium):", barbershopId);
    }

    let accountId: string | null = existingShop.rows.length > 0 ? existingShop.rows[0].account_id : null;
    if (!accountId) {
      const accountResult = await client.query<{ id: string }>(
        `INSERT INTO public.accounts (name) VALUES ($1) RETURNING id`,
        [process.env.SEED_BARBERSHOP_NAME ?? "Minha conta"]
      );
      accountId = accountResult.rows[0].id;
      await client.query("UPDATE public.barbershops SET account_id = $1 WHERE id = $2", [accountId, barbershopId]);
      console.log("Created account and linked barbershop");
    }

    const email = process.env.SEED_ADMIN_EMAIL ?? "admin@navalhia.com.br";
    const password = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
    const passwordHash = await bcrypt.hash(password, 10);
    let profileId: string;
    const profileResult = await client.query<{ id: string }>("SELECT id FROM public.profiles WHERE email = $1", [email]);
    if (profileResult.rows.length === 0) {
      await client.query(
        `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'admin')`,
        [barbershopId, process.env.SEED_ADMIN_NAME ?? "Admin", email, passwordHash]
      );
      const inserted = await client.query<{ id: string }>("SELECT id FROM public.profiles WHERE email = $1", [email]);
      profileId = inserted.rows[0].id;
      console.log("Created admin profile (email:", email, ")");
    } else {
      profileId = profileResult.rows[0].id;
      console.log("Admin profile already exists (email:", email, ")");
    }
    await client.query(
      `INSERT INTO public.account_memberships (profile_id, account_id, role)
       SELECT $1, $2, 'owner'
       WHERE NOT EXISTS (SELECT 1 FROM public.account_memberships WHERE profile_id = $1 AND account_id = $2)`,
      [profileId, accountId]
    );
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
