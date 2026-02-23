import pg from "pg";
import { config } from "./config.js";

// Só usa SSL quando explicitamente pedido (ex.: Supabase em produção).
// Em Docker com Postgres local, não definir DATABASE_SSL para evitar "server does not support SSL".
const useSsl = process.env.DATABASE_SSL === "true";

// Em ambientes serverless (ex.: Lambda) evitar muitos connections por função.
// Permite ajuste fino via env DATABASE_POOL_MAX se necessário.
const poolMax =
  Number(process.env.DATABASE_POOL_MAX) ||
  (process.env.NODE_ENV === "production" ? 10 : 20);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: poolMax,
  idleTimeoutMillis: 30_000,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

export type Row = pg.QueryResultRow;
