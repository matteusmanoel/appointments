import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "../../../scripts/seed-production.sql"), "utf8");

describe("scripts/seed-production.sql", () => {
  it("não contém senha fixa", () => {
    expect(sql).not.toMatch(/admin123/);
    expect(sql).not.toMatch(/crypt\('/);
  });
  it("exige admin_password via variável do psql e falha se faltar/for curta", () => {
    expect(sql).toMatch(/crypt\(:'admin_password'/);
    expect(sql).toMatch(/\\if :\{\?admin_password\}/);
    expect(sql).toMatch(/length\(:'admin_password'\) >= 12/);
    expect(sql).toMatch(/ON_ERROR_STOP on/);
  });
  it("aborta em banco com barbearias reais e avisa para não rodar no Neon novo", () => {
    expect(sql).toMatch(/slug IS DISTINCT FROM 'minha-navalhia'/);
    expect(sql).toMatch(/NÃO rodar no Neon novo/);
  });
});
