#!/usr/bin/env node
// Valida o zip do worker_knowledge FORA do repositório (sem node_modules do projeto por perto):
// extrai em um diretório temporário, importa o bundle e faz o parse real de um PDF mínimo com pdf-parse
// (pdfjs-dist + @napi-rs/canvas). Uso: node scripts/verify-knowledge-zip.mjs [build/lambda/worker_knowledge.zip]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const zip = resolve(process.argv[2] ?? join(root, "build", "lambda", "worker_knowledge.zip"));
const tmp = mkdtempSync(join(tmpdir(), "knowledge-zip-"));

function minimalPdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 50 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

try {
  console.log(`zip: ${zip} (${(statSync(zip).size / 1024 / 1024).toFixed(2)} MB)`);
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
    execFileSync("python3", ["-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, tmp]);
  }
  const probe = join(tmp, "dist", "workers", "probe.mjs");
  writeFileSync(join(tmp, "sample.pdf"), minimalPdf("Ola NavalhIA conhecimento"));
  writeFileSync(
    probe,
    `import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url).pathname;
// 1) o bundle da função carrega (mesmo caminho que o Lambda usa)
const mod = await import("./lambda-knowledge.mjs");
if (typeof mod.handler !== "function") throw new Error("handler ausente no bundle");
// 2) o MESMO helper que o worker usa para ler PDF (extractTextFromBuffer), exportado pelo bundle, lê um PDF de verdade
if (typeof mod.extractTextFromBuffer !== "function") throw new Error("extractTextFromBuffer não exportado pelo bundle");
const text = await mod.extractTextFromBuffer(readFileSync(root + "sample.pdf"), "application/pdf", "sample.pdf");
if (!String(text).includes("NavalhIA")) throw new Error("texto do PDF não extraído: " + JSON.stringify(text));
// 3) o binário nativo do canvas (usado pelo pdfjs) está no zip
const { createRequire } = await import("node:module");
const canvas = createRequire(import.meta.url)("@napi-rs/canvas");
if (typeof canvas.createCanvas !== "function") throw new Error("@napi-rs/canvas sem binário nativo");
console.log("OK: handler carregado; PDF lido ->", JSON.stringify(String(text).trim()));
process.exit(0);
`,
  );
  execFileSync(process.execPath, [probe], { cwd: tmp, stdio: "inherit", env: { PATH: process.env.PATH, AWS_LAMBDA_FUNCTION_NAME: "verify-only", // evita iniciar o loop de polling do worker ao importar
     HOME: tmp, NODE_ENV: "test", DATABASE_URL: "postgres://x:x@127.0.0.1:1/x", JWT_SECRET: "verify-only", APP_ENCRYPTION_KEY: "verify-only-verify-only-verify-only" } });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
