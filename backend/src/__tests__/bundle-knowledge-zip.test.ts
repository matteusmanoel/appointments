import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());

describe("worker_knowledge.zip", () => {
  it("leva pdf-parse + pdfjs-dist + @napi-rs/canvas e lê um PDF real fora do repositório", () => {
    execFileSync(process.execPath, ["scripts/bundle-lambdas.mjs", "worker_knowledge"], { cwd: root, stdio: "pipe" });
    const out = execFileSync(process.execPath, ["scripts/verify-knowledge-zip.mjs"], { cwd: root, encoding: "utf8" });
    expect(out).toContain("OK: handler carregado");
    expect(out).toContain("NavalhIA");
  }, 120_000);
});
