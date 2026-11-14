import { pool } from "../db.js";
import { issueApiKey } from "../lib/api-keys.js";

async function main() {
  const barbershopId = process.argv[2];
  const name = process.argv[3] ?? "n8n";

  if (!barbershopId) {
    console.error("Usage: tsx src/scripts/create-api-key.ts <barbershop_id> [name]");
    process.exit(1);
  }

  const issued = await issueApiKey();

  const result = await pool.query(
    `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [barbershopId, name, issued.keyHash, issued.prefix, issued.lookupHash]
  );

  const row = result.rows[0];
  console.log("API key created:");
  console.log(`  id: ${row.id}`);
  console.log(`  barbershop_id: ${barbershopId}`);
  console.log(`  name: ${name}`);
  console.log("");
  console.log("  >>> Save this key securely, it will not be shown again:");
  console.log(`  api_key: ${issued.plaintext}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
