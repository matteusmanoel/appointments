import bcrypt from "bcryptjs";
import { pool } from "../db.js";

async function main() {
  const barbershopId = process.argv[2];
  const name = process.argv[3] ?? "n8n";

  if (!barbershopId) {
    console.error("Usage: tsx src/scripts/create-api-key.ts <barbershop_id> [name]");
    process.exit(1);
  }

  const apiKey = `bfk_${crypto.randomUUID()}_${Math.random().toString(36).slice(2, 10)}`;
  const keyHash = await bcrypt.hash(apiKey, 10);

  const result = await pool.query(
    `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [barbershopId, name, keyHash]
  );

  const row = result.rows[0];
  console.log("API key created:");
  console.log(`  id: ${row.id}`);
  console.log(`  barbershop_id: ${barbershopId}`);
  console.log(`  name: ${name}`);
  console.log("");
  console.log("  >>> Save this key securely, it will not be shown again:");
  console.log(`  api_key: ${apiKey}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

