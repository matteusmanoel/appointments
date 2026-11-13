import type { PoolClient } from "pg";

/**
 * Serializa criações/remarcações do MESMO barbeiro no MESMO dia.
 * Deve ser chamado dentro de uma transação (BEGIN) já aberta em `client`; o lock é liberado
 * automaticamente no COMMIT/ROLLBACK. Quem chega depois só consulta conflitos depois do commit do primeiro,
 * então "checar e inserir" deixa de ter janela de corrida (antes: check fora da transação → double booking).
 * Não exige constraint nova, logo funciona com dados antigos que já tenham sobreposição.
 *
 * É a ÚNICA chave de lock de agenda: painel (POST/PATCH), link público (agendar/reagendar) e agente/tools
 * precisam usar esta função, senão dois caminhos diferentes não se excluem mutuamente.
 *
 * Espera no máximo `timeoutMs` (padrão 10 s, via lock_timeout local à transação); estourou → erro 55P03,
 * que o chamador traduz em 409 (use `isLockTimeout`).
 */
export async function lockBarberDay(
  client: PoolClient,
  barberId: string,
  date: string,
  timeoutMs = defaultLockTimeoutMs()
): Promise<void> {
  const ms = Math.max(1, Math.floor(timeoutMs));
  const key = bookingLockKey(barberId, date);
  await client.query(`SET LOCAL lock_timeout = '${ms}ms'`);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

/** 10 s por padrão; `BOOKING_LOCK_TIMEOUT_MS` permite ajustar (e os testes usam um valor curto para provar o 409). */
function defaultLockTimeoutMs(): number {
  const n = Number(process.env.BOOKING_LOCK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

/**
 * Chave canônica do lock: o Postgres trata `ABC…` e `abc…` (e UUID com espaços nas pontas, que o `isValidUuid` aceita)
 * como o mesmo uuid, então a chave precisa ser normalizada, senão dois pedidos para o mesmo barbeiro não se excluem.
 * A data é `YYYY-MM-DD` (ISO com hora é reduzida ao dia; qualquer outro formato gera erro em vez de uma chave diferente para o mesmo dia).
 */
export function bookingLockKey(barberId: string, date: string): string {
  const b = String(barberId ?? "").trim().toLowerCase();
  // aceita "YYYY-MM-DD" e ISO com hora ("YYYY-MM-DDTHH:MM…"): o dia é sempre os 10 primeiros caracteres
  const d = String(date ?? "").trim().replace(/^(\d{4}-\d{2}-\d{2})T.*$/, "$1");
  if (!b) throw new Error("lockBarberDay: barbeiro vazio");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("lockBarberDay: data deve ser YYYY-MM-DD");
  return `booking:${b}:${d}`;
}

/** Mensagem única (painel, link público e /tools) quando o lock do barbeiro/dia não é obtido a tempo (55P03 → 409). */
export const LOCK_BUSY_MESSAGE = "A agenda deste barbeiro está sendo atualizada agora. Tente novamente em alguns segundos.";

/** lock_not_available (55P03): o lock do barbeiro/dia não foi obtido no prazo. */
export function isLockTimeout(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "55P03";
}
