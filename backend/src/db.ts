import pg from "pg";
import { config } from "./config.js";

// Só usa SSL quando explicitamente pedido (ex.: Supabase/Neon em produção).
// Em Docker com Postgres local, não definir DATABASE_SSL para evitar "server does not support SSL".
const useSsl = process.env.DATABASE_SSL === "true";

const num = (v: string | undefined, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// Em ambientes serverless (ex.: Lambda) evitar muitos connections por função.
// Permite ajuste fino via env DATABASE_POOL_MAX se necessário.
const poolMax = num(process.env.DATABASE_POOL_MAX, process.env.NODE_ENV === "production" ? 10 : 20);

/** Timeouts (ms). Sem eles, uma conexão presa ou query lenta trava a Lambda até o timeout dela. */
export const DB_TIMEOUTS = {
  /** Esperar uma conexão livre/abrir uma nova. */
  connectionTimeoutMillis: num(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 10_000),
  idleTimeoutMillis: num(process.env.DATABASE_IDLE_TIMEOUT_MS, 30_000),
  /** Teto por query. No pool com pooler usamos o timeout do lado do cliente (query_timeout). */
  queryTimeoutMillis: num(process.env.DATABASE_QUERY_TIMEOUT_MS, 30_000),
  /** Conexão direta (workers): statement_timeout no servidor, maior porque sweeps varrem muitas linhas. */
  directStatementTimeoutMillis: num(process.env.DATABASE_DIRECT_STATEMENT_TIMEOUT_MS, 120_000),
};

/** true se a URL parece apontar para um pooler de transação (Neon `-pooler`, porta 6543, `pgbouncer=true`). Nunca loga a URL. */
export function looksLikePooler(url: string): boolean {
  return /(-pooler\.|:6543\/|:6543\?|pgbouncer=true)/i.test(url);
}

type PoolRole = "pooled" | "direct";

/** Monta as opções do pg.Pool (função pura, testável). */
export function buildPoolConfig(url: string, role: PoolRole, ssl = useSsl): pg.PoolConfig {
  const base: pg.PoolConfig = {
    max: role === "direct" ? num(process.env.DATABASE_DIRECT_POOL_MAX, 3) : poolMax,
    connectionTimeoutMillis: DB_TIMEOUTS.connectionTimeoutMillis,
    idleTimeoutMillis: DB_TIMEOUTS.idleTimeoutMillis,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  };
  // statement_timeout vai como parâmetro de startup. Poolers de transação (Neon/PgBouncer, Supabase :6543)
  // costumam REJEITAR parâmetros de startup desconhecidos, então no pool "pooled" usamos só query_timeout (cliente).
  if (role === "direct") base.statement_timeout = DB_TIMEOUTS.directStatementTimeoutMillis;
  else base.query_timeout = DB_TIMEOUTS.queryTimeoutMillis;
  // Supabase pooler + Node TLS:
  // When the URL includes `sslmode=require`, some environments interpret it as "verify-full"
  // and Node may reject the server certificate chain. When DATABASE_SSL=true we always set
  // `rejectUnauthorized: false` explicitly and pass connection fields directly.
  try {
    const u = new URL(url);
    return {
      ...base,
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: (u.pathname || "").replace(/^\//, "") || undefined,
    };
  } catch {
    return { ...base, connectionString: url };
  }
}

/** Pool usado pela API (e queries comuns). Pode apontar para o pooler (-pooler no Neon). */
export const pool = new pg.Pool(buildPoolConfig(config.databaseUrl, "pooled"));

/**
 * Pool para quem usa pg_advisory_lock/pg_try_advisory_lock de SESSÃO (sweeps de scheduled-messages,
 * plan-billing, dispatch-gate): o lock vive na conexão, então ela NÃO pode passar por pooler de transação
 * (o lock "vazaria" para outro cliente ou seria solto). Usa DATABASE_URL_DIRECT; sem ela, reaproveita `pool`.
 */
export const directPool: pg.Pool =
  config.databaseUrlDirect === config.databaseUrl
    ? pool
    : new pg.Pool(buildPoolConfig(config.databaseUrlDirect, "direct"));

// Fallback seguro: sem DATABASE_URL_DIRECT os workers reutilizam o pool principal (compatível com Postgres local),
// mas se ele é um pooler os advisory locks de sessão não valem. Avisa UMA vez (sem imprimir a URL); a API tolera.
if (directPool === pool && looksLikePooler(config.databaseUrl) && process.env.NODE_ENV !== "test") {
  console.warn(
    "[db] DATABASE_URL parece um pooler e DATABASE_URL_DIRECT não está definida: pg_advisory_lock de sessão (sweeps, dispatch-gate) não é confiável. Defina DATABASE_URL_DIRECT (host sem -pooler).",
  );
}

export type Row = pg.QueryResultRow;
