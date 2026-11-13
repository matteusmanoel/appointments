import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wf = readFileSync(resolve(here, "../../../.github/workflows/deploy.yml"), "utf8");

describe("deploy.yml legado", () => {
  const active = wf.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  it("não dispara em push/pull_request/schedule", () => {
    const onBlock = active.slice(active.indexOf("\non:"), active.indexOf("\npermissions:"));
    expect(onBlock).not.toMatch(/^\s{2}(push|pull_request|schedule|workflow_run):/m);
    expect(onBlock).toMatch(/workflow_dispatch:/);
  });
  it("todo job exige confirmação manual", () => {
    const jobsPart = active.slice(active.indexOf("\njobs:"));
    const jobs = jobsPart.match(/^  [a-z0-9-]+:\n/gm) ?? [];
    expect(jobs.length).toBeGreaterThan(0);
    const guards = jobsPart.match(/if: \$\{\{ inputs\.confirmar == 'legado' \}\}/g) ?? [];
    expect(guards.length).toBe(jobs.length);
  });
});

describe("role OIDC do GitHub (infra/ci/oidc-github-role.yaml)", () => {
  const tpl = readFileSync(resolve(here, "../../../infra/ci/oidc-github-role.yaml"), "utf8");
  const active = tpl.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  it("não confia em repo:<repo>:* (qualquer branch/PR)", () => {
    expect(active).not.toMatch(/repo:\$\{GitHubRepo\}:\*/);
    expect(active).not.toMatch(/StringLike/);
  });
  it("só o ref do parâmetro GitHubRef (padrão refs/heads/main), com StringEquals", () => {
    expect(active).toMatch(/StringEquals:[\s\S]*:sub": !Sub "repo:\$\{GitHubRepo\}:ref:\$\{GitHubRef\}"/);
    expect(active).toMatch(/GitHubRef:\s+Type: String\s+Default: "refs\/heads\/main"/);
  });
});
