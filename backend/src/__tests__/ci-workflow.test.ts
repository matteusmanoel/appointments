import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ci = readFileSync(resolve(here, "../../../.github/workflows/ci.yml"), "utf8");

describe("ci.yml", () => {
  const active = ci.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  const onBlock = active.slice(active.indexOf("\non:"), active.indexOf("\njobs:"));
  it("roda em pull_request para main e develop", () => {
    expect(onBlock).toMatch(/pull_request:/);
    expect(onBlock).toMatch(/branches:\s*\[\s*main\s*,\s*develop\s*\]/);
  });
});
