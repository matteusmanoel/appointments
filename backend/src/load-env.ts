import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.join(here, "../../.env"),
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), "../.env"),
];

try {
  const require = createRequire(import.meta.url);
  const dotenv = require("dotenv") as { config: (opts: { path: string }) => { error?: Error } };
  for (const file of candidates) {
    const result = dotenv.config({ path: file });
    if (!result.error) break;
  }
} catch {
  // Compose/Lambda already inject process.env
}
