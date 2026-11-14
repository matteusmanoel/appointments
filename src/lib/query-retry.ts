import { AuthError } from "./api";

/** Máximo de repetições automáticas para falhas de rede ou 5xx (além da tentativa original). */
export const MAX_QUERY_RETRIES = 2;

/**
 * Política de retry do React Query.
 *  - 401 (AuthError) e qualquer 4xx: não repetir (o servidor já respondeu; repetir só atrasa a mensagem de erro);
 *  - rede/timeout (sem status) e 5xx: no máximo 2 repetições.
 * Antes: retry infinito para tudo que não fosse AuthError → sem backend, /b/:slug e /reagendar/:token
 * ficavam em skeleton para sempre.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof AuthError) return false;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return failureCount < MAX_QUERY_RETRIES;
}
