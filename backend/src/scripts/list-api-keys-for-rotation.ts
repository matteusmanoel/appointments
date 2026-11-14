import { pool } from "../db.js";
import { API_KEY_MIN_SECRET_BITS, listApiKeysNeedingRotation } from "../lib/api-keys.js";

/**
 * Lista (somente leitura) as API keys ativas que precisam ser rotacionadas: entropia desconhecida
 * (emitidas antes do formato de 128 bits e ainda não vistas) ou abaixo de 128 bits.
 * Não imprime chave nem hash. NÃO rotaciona nada: criar a chave nova, trocar no n8n e revogar a
 * antiga é manual (docs/RUNBOOK.md, "API keys de tools").
 *
 * Uso: tsx src/scripts/list-api-keys-for-rotation.ts
 */
async function main() {
  const rows = await listApiKeysNeedingRotation();
  if (rows.length === 0) {
    console.log(`Nenhuma API key ativa com menos de ${API_KEY_MIN_SECRET_BITS} bits (ou de entropia desconhecida).`);
    return;
  }
  console.log(`${rows.length} API key(s) ativa(s) para rotacionar (key_secret_bits NULL ou < ${API_KEY_MIN_SECRET_BITS}):`);
  for (const r of rows) {
    console.log(
      [
        `id=${r.id}`,
        `barbershop_id=${r.barbershop_id}`,
        `name=${JSON.stringify(r.name)}`,
        `created_at=${new Date(r.created_at).toISOString()}`,
        `last_used_at=${r.last_used_at ? new Date(r.last_used_at).toISOString() : "nunca"}`,
        `bits=${r.key_secret_bits ?? "desconhecido"}`,
      ].join(" "),
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
