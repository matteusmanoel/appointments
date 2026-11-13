import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ci = readFileSync(resolve(here, "../../../.github/workflows/ci.yml"), "utf8");
const deploy = readFileSync(resolve(here, "../../../.github/workflows/deploy.yml"), "utf8");
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const active = strip(ci);
const jobBlock = (name: string) => {
  const m = active.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`));
  return m ? m[1] : "";
};

describe("ci.yml", () => {
  const onBlock = active.slice(active.indexOf("\non:"), active.indexOf("\npermissions:"));

  it("roda em pull_request e push para main e develop", () => {
    expect(onBlock).toMatch(/pull_request:\s*\n\s*branches:\s*\[\s*main\s*,\s*develop\s*\]/);
    expect(onBlock).toMatch(/push:\s*\n\s*branches:\s*\[\s*main\s*,\s*develop\s*\]/);
  });

  it("token só de leitura, concorrência e timeout em todos os jobs", () => {
    expect(active).toMatch(/\npermissions:\s*\n\s+contents: read/);
    expect(active).toMatch(/concurrency:/);
    for (const j of ["test", "frontend", "terraform"]) expect(jobBlock(j)).toMatch(/timeout-minutes:/);
  });

  it("não deixa o CI sem banco (falso verde): serviço pgvector + DATABASE_URL antes do npm test", () => {
    const t = jobBlock("test");
    expect(t).toMatch(/image: pgvector\/pgvector:pg16/);
    expect(t).toMatch(/DATABASE_URL: postgres:\/\/ci:ci@localhost:5432\/ci/);
    expect(t.indexOf("run-all-migrations")).toBeGreaterThan(-1);
    expect(t.indexOf("run-all-migrations")).toBeLessThan(t.indexOf("npm test"));
  });

  it("o passo de teste do backend é bloqueante (sem continue-on-error)", () => {
    const t = jobBlock("test");
    const step = t.slice(t.indexOf("Backend — test"), t.indexOf("Backend — build"));
    expect(step).toContain("npm test");
    expect(step).not.toMatch(/continue-on-error/);
  });

  it("matriz inclui Node 20 (runtime das Lambdas) e 22 só como aviso", () => {
    const t = jobBlock("test");
    expect(t).toMatch(/node:\s*\[\s*"20"\s*,\s*"22"\s*\]/);
    expect(t).toMatch(/continue-on-error:\s*\$\{\{\s*matrix\.node == '22'\s*\}\}/);
  });

  it("o bundle das Lambdas só roda quando o script existe no branch", () => {
    expect(jobBlock("test")).toMatch(/if:\s*\$\{\{\s*hashFiles\('backend\/scripts\/bundle-lambdas\.mjs'\)\s*!=\s*''\s*\}\}/);
  });

  it("job de Terraform: fmt + init sem backend + validate, sem plan/apply nem credenciais", () => {
    const tf = jobBlock("terraform");
    expect(tf).toMatch(/terraform fmt -check -recursive infra/);
    expect(tf).toMatch(/terraform init -backend=false/);
    expect(tf).toMatch(/terraform validate/);
    expect(tf).not.toMatch(/terraform (plan|apply)/);
    expect(tf).not.toMatch(/configure-aws-credentials|AWS_/);
  });

  it("não usa pull_request_target nem secrets além do VITE_API_URL (com fallback público)", () => {
    expect(active).not.toMatch(/pull_request_target/);
    const secrets = [...active.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(new Set(secrets)).toEqual(new Set(["VITE_API_URL"]));
  });

  it("o deploy continua em Node 20 (runtime das Lambdas não foi alterado aqui)", () => {
    expect(strip(deploy)).toMatch(/node-version: "20"/);
  });
});
