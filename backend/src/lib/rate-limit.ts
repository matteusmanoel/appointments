import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "../db.js";

/**
 * Rate limit de janela fixa SEM serviço pago: memória do processo ou Postgres (tabela public.rate_limit_hits).
 *
 *  - `postgres` (padrão fora de teste): contador compartilhado entre instâncias/Lambdas; se o banco falhar, cai para memória
 *    (fail-open para o fluxo público, mas ainda limita por instância).
 *  - `memory`: só o processo atual (não vale entre instâncias; útil em dev/testes).
 *
 * Env: PUBLIC_RATE_LIMIT_STORE=postgres|memory, PUBLIC_RATE_LIMIT_ENABLED=false (desliga tudo, p.ex. em load test).
 */

export type RateLimitHit = { count: number; resetAtMs: number };
export type RateLimitStore = {
  hit(bucket: string, windowMs: number): Promise<RateLimitHit>;
};

export function createMemoryStore(maxKeys = 50_000): RateLimitStore & { size(): number; clear(): void } {
  const map = new Map<string, RateLimitHit>();
  let lastSweep = 0;
  return {
    async hit(bucket, windowMs) {
      const now = Date.now();
      if (map.size > maxKeys || now - lastSweep > 60_000) {
        lastSweep = now;
        for (const [k, v] of map) if (v.resetAtMs <= now) map.delete(k);
        // Proteção de memória: se ainda estourou, descarta os mais antigos.
        if (map.size > maxKeys) {
          for (const k of map.keys()) {
            map.delete(k);
            if (map.size <= maxKeys / 2) break;
          }
        }
      }
      const cur = map.get(bucket);
      if (!cur || cur.resetAtMs <= now) {
        const fresh = { count: 1, resetAtMs: now + windowMs };
        map.set(bucket, fresh);
        return { ...fresh };
      }
      cur.count += 1;
      return { ...cur };
    },
    size: () => map.size,
    clear: () => map.clear(),
  };
}

export function createPostgresStore(fallback: RateLimitStore): RateLimitStore {
  return {
    async hit(bucket, windowMs) {
      const windowSec = Math.max(1, Math.round(windowMs / 1000));
      try {
        const r = await pool.query<{ hits: number; reset_ms: string }>(
          `INSERT INTO public.rate_limit_hits (bucket, window_start, hits)
           VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
           ON CONFLICT (bucket, window_start) DO UPDATE SET hits = public.rate_limit_hits.hits + 1
           RETURNING hits,
             (extract(epoch FROM window_start) + $2) * 1000 AS reset_ms`,
          [bucket, windowSec]
        );
        // Limpeza oportunista (~1% das chamadas): janelas com mais de 1 dia.
        if (Math.random() < 0.01) {
          void pool
            .query(`DELETE FROM public.rate_limit_hits WHERE window_start < now() - interval '1 day'`)
            .catch(() => undefined);
        }
        return { count: Number(r.rows[0].hits), resetAtMs: Number(r.rows[0].reset_ms) };
      } catch (e) {
        console.warn("[rate-limit] postgres store failed, using memory:", (e as Error).message);
        return fallback.hit(bucket, windowMs);
      }
    },
  };
}

const memoryStore = createMemoryStore();
let storeOverride: RateLimitStore | null = null;

/** Para testes. */
export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  storeOverride = store;
}

function activeStore(): RateLimitStore {
  if (storeOverride) return storeOverride;
  // Em teste o padrão é memória (zera a cada processo); os testes do próprio limiter forçam `postgres` via env.
  const def = process.env.NODE_ENV === "test" || process.env.VITEST ? "memory" : "postgres";
  return (process.env.PUBLIC_RATE_LIMIT_STORE ?? def).toLowerCase() === "memory"
    ? memoryStore
    : createPostgresStore(memoryStore);
}

export function rateLimitEnabled(): boolean {
  return (process.env.PUBLIC_RATE_LIMIT_ENABLED ?? "true").toLowerCase() !== "false";
}

export function envInt(name: string, def: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export type LimitSpec = { bucket: string; max: number; windowMs: number };

/** Conta uma tentativa em cada limite; devolve o primeiro estourado (ou null). Todos são incrementados. */
export async function consume(specs: LimitSpec[]): Promise<{ retryAfterSec: number; bucket: string } | null> {
  if (!rateLimitEnabled()) return null;
  const store = activeStore();
  let blocked: { retryAfterSec: number; bucket: string } | null = null;
  for (const s of specs) {
    const h = await store.hit(s.bucket, s.windowMs);
    if (h.count > s.max && !blocked) {
      blocked = { bucket: s.bucket, retryAfterSec: Math.max(1, Math.ceil((h.resetAtMs - Date.now()) / 1000)) };
    }
  }
  return blocked;
}

export function tooManyRequests(res: Response, retryAfterSec: number): void {
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({
    error: "Muitas tentativas. Aguarde um pouco e tente novamente.",
    retry_after_seconds: retryAfterSec,
  });
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket?.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

/** Middleware genérico: `specs(req)` devolve os limites a contar (pode ser async; erro → segue sem limitar). */
export function rateLimitMiddleware(specs: (req: Request) => Promise<LimitSpec[]> | LimitSpec[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        if (!rateLimitEnabled()) return next();
        const list = await specs(req);
        const blocked = list.length ? await consume(list) : null;
        if (blocked) return tooManyRequests(res, blocked.retryAfterSec);
        next();
      } catch (e) {
        console.warn("[rate-limit] erro inesperado; seguindo sem limitar:", (e as Error).message);
        next();
      }
    })();
  };
}
