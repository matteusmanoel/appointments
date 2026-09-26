// Load the repo's real .env (same mechanism as src/load-env.ts) BEFORE falling back to a
// dummy DATABASE_URL. Without this, nothing in the db.ts -> config.ts import chain ever
// reads the real .env in the vitest process, so every "DB-backed" integration test was
// silently degrading to the credential-less fallback below and vacuously no-op'ing (their
// own try/catch treats the connection failure as "DB unavailable" and returns early,
// reporting green without ever exercising a real query).
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "url";

try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);
  const dotenv = require("dotenv") as { config: (opts: { path: string }) => { error?: Error } };
  const candidates = [path.join(here, "../../../.env"), path.join(process.cwd(), ".env"), path.join(process.cwd(), "../.env")];
  for (const file of candidates) {
    const result = dotenv.config({ path: file });
    if (!result.error) break;
  }
} catch {
  // no dotenv / no .env found — fall back below
}

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://localhost:5432/test";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret";
