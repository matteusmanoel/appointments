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

function createPool(): pg.Pool {
  // Supabase pooler + Node TLS:
  // When DATABASE_URL includes `sslmode=require`, some environments interpret it as "verify-full"
  // and Node may reject the server certificate chain. To avoid deploy regressions, when
  // DATABASE_SSL=true we always set `rejectUnauthorized: false` explicitly and avoid relying
  // on sslmode parsing by passing connection fields directly.
  try {
    const u = new URL(config.databaseUrl);
    const port = u.port ? Number(u.port) : 5432;
    const database = (u.pathname || "").replace(/^\//, "") || undefined;
    return new pg.Pool({
      host: u.hostname,
      port,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
  } catch {
    return new pg.Pool({
      connectionString: config.databaseUrl,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
}

export const pool = createPool();

export type Row = pg.QueryResultRow;
