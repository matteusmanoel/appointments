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
  timeoutMs = 10_000
): Promise<void> {
  const ms = Math.max(1, Math.floor(timeoutMs));
  await client.query(`SET LOCAL lock_timeout = '${ms}ms'`);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`booking:${barberId}:${date}`]);
}

/** lock_not_available (55P03): o lock do barbeiro/dia não foi obtido no prazo. */
export function isLockTimeout(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "55P03";
}
