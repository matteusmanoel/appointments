import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://navalhia:navalhia_secret@localhost:5432/navalhia";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "dev";

const { pool } = await import("../src/db.js");

const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='barbers' AND table_schema='public' ORDER BY ordinal_position`);
console.log("Barbers columns:", cols.rows.map(r => r.column_name).join(", "));

const barbers = await pool.query(`SELECT id, name FROM public.barbers LIMIT 5`);
console.log("Barbers:", JSON.stringify(barbers.rows));

await pool.end();
