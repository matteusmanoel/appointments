import dotenv from "dotenv";
import pg from "pg";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationsDir = join(__dirname, "../../supabase/migrations");
const stubPath = join(__dirname, "local-auth-stub.sql");
const client = new pg.Client({ connectionString: databaseUrl });

const MIGRATIONS_TABLE = "public._migrations";

async function run() {
  await client.connect();

  // Tabela de controle: só roda migrations ainda não aplicadas
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set<string>();
  const r = await client.query(`SELECT filename FROM ${MIGRATIONS_TABLE}`);
  r.rows.forEach((row: { filename: string }) => applied.add(row.filename));

  // Backfill: se barbershops já existe, marcar a primeira migration como aplicada para não reexecutar
  const firstSupabaseMigration = "20260131203523_1bf7ac7d-dd70-4fac-be31-5afadef6de50.sql";
  if (!applied.has(firstSupabaseMigration)) {
    const check = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'barbershops'"
    );
    if (check.rows.length > 0) {
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
        [firstSupabaseMigration]
      );
      applied.add(firstSupabaseMigration);
      console.log("Backfill: marked", firstSupabaseMigration, "as already applied");
    }
  }

  // 1) Stub local (auth.uid() para RLS)
  if (existsSync(stubPath)) {
    const stubKey = "local-auth-stub.sql";
    if (!applied.has(stubKey)) {
      const stub = readFileSync(stubPath, "utf-8");
      console.log("Running", stubKey);
      await client.query(stub);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
        [stubKey]
      );
      applied.add(stubKey);
    }
  }

  // 2) Migrations Supabase (ordenadas)
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log("Skipping (already applied):", file);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log("Running", file);
    try {
      await client.query(sql);
    } catch (e: unknown) {
      const err = e as { code?: string };
      // 42P07 = relation already exists, 42710 = duplicate_object (policy, etc.)
      if (err?.code === "42P07" || err?.code === "42710") {
        console.log("  -> object already exists, marking as applied");
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
          [file]
        );
        applied.add(file);
        continue;
      }
      throw e;
    }
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [file]
    );
    applied.add(file);
  }

  // 3) Backend local auth (profiles email/password_hash)
  const backendMig = join(__dirname, "../migrations/001_add_profiles_local_auth.sql");
  const backendKey = "001_add_profiles_local_auth.sql";
  if (existsSync(backendMig) && !applied.has(backendKey)) {
    const sql = readFileSync(backendMig, "utf-8");
    console.log("Running", backendKey);
    await client.query(sql);
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [backendKey]
    );
  }

  await client.end();
  console.log("All migrations applied.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
