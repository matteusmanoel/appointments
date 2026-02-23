import dotenv from "dotenv";
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env") });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlPath = join(__dirname, "../../supabase/migrations/20260219120000_ai_conversations_jobs_settings_outbound.sql");
const sql = readFileSync(sqlPath, "utf-8");

const client = new pg.Client({ connectionString: databaseUrl });
client.connect().then(() => client.query(sql)).then(() => {
  console.log("Migration applied successfully.");
  client.end();
}).catch((e) => {
  console.error(e);
  client.end().catch(() => {});
  process.exit(1);
});
