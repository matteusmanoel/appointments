import type { PoolClient } from "pg";

/**
 * Serializa criações/remarcações do MESMO barbeiro no MESMO dia.
 * Deve ser chamado dentro de uma transação (BEGIN) já aberta em `client`; o lock é liberado
 * automaticamente no COMMIT/ROLLBACK. Quem chega depois só consulta conflitos depois do commit do primeiro,
 * então "checar e inserir" deixa de ter janela de corrida (antes: check fora da transação → double booking).
 * Não exige constraint nova, logo funciona com dados antigos que já tenham sobreposição.
 */
export async function lockBarberDay(client: PoolClient, barberId: string, date: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`booking:${barberId}:${date}`]);
}
