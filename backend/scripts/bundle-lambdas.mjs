#!/usr/bin/env node
// Gera UM zip por função Lambda (api, worker_ai, worker_scheduled, worker_knowledge) com esbuild.
// Antes: um zip único com dist + node_modules inteiro (centenas de MB) para as 4 funções → cold start e
// limite de 250 MB. Agora cada zip leva só o bundle dessa função.
//   cd backend && npm run bundle:lambdas      → build/lambda/<fn>.zip
//   terraform: -var 'lambda_zip_paths={api="…/api.zip",worker_ai="…",worker_scheduled="…",worker_knowledge="…"}'
// Os handlers do Terraform continuam iguais (dist/lambda.handler, dist/workers/lambda-ai.handler, …):
// o runtime nodejs20.x resolve dist/lambda.mjs para "dist/lambda.handler".
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "lambda");

export const FUNCTIONS = {
  api: { entry: "src/lambda.ts", outfile: "dist/lambda.mjs" },
  worker_ai: { entry: "src/workers/lambda-ai.ts", outfile: "dist/workers/lambda-ai.mjs" },
  worker_scheduled: { entry: "src/workers/lambda-scheduled.ts", outfile: "dist/workers/lambda-scheduled.mjs" },
  // pdf-parse é carregado via createRequire em runtime: não dá para empacotar, vai como node_modules/pdf-parse no zip.
  // Ele depende de pdfjs-dist (ESM carregado por import() em runtime) e de @napi-rs/canvas (binário nativo): sem eles o
  // worker de conhecimento quebra no primeiro PDF ("Cannot find module 'pdfjs-dist'"). O Lambda é nodejs20.x em x86_64
  // (Amazon Linux 2023, glibc) → só o binário @napi-rs/canvas-linux-x64-gnu. Se a arquitetura mudar para arm64,
  // troque por @napi-rs/canvas-linux-arm64-gnu (o check `verifyKnowledgeZip` falha se o binário certo não estiver no zip).
  worker_knowledge: {
    entry: "src/workers/lambda-knowledge.ts",
    outfile: "dist/workers/lambda-knowledge.mjs",
    external: ["pdf-parse"],
    copyModules: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas", "@napi-rs/canvas-linux-x64-gnu"],
  },
};

// Arquivos de node_modules copiados que não fazem falta em runtime (mapas de fonte, tipos, viewer web).
export function pruneModuleFile(src) {
  const p = src.split("\\").join("/");
  if (p.endsWith(".map")) return false;
  if (/\/node_modules\/pdfjs-dist\/(types|web|legacy\/web)(\/|$)/.test(p)) return false;
  return true;
}

const banner = [
  'import { createRequire as __cr } from "node:module";',
  "const require = __cr(import.meta.url);",
].join("\n");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

/** Falha o build se o worker de conhecimento ficar sem alguma dependência que o PDF exige em runtime. */
function verifyKnowledgeZipDir(dir) {
  const need = [
    "node_modules/pdf-parse/package.json",
    "node_modules/pdfjs-dist/package.json",
    "node_modules/pdfjs-dist/build/pdf.mjs",
    "node_modules/pdfjs-dist/build/pdf.worker.mjs",
    "node_modules/@napi-rs/canvas/package.json",
    "node_modules/@napi-rs/canvas-linux-x64-gnu/package.json",
  ];
  const missing = need.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`worker_knowledge incompleto, faltam: ${missing.join(", ")}`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const [name, cfg] of Object.entries(FUNCTIONS)) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(out, name);
  await build({
    entryPoints: [join(root, cfg.entry)],
    outfile: join(dir, cfg.outfile),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: { js: banner },
    external: cfg.external ?? [],
    legalComments: "none",
    logLevel: "warning",
  });
  for (const m of cfg.copyModules ?? []) {
    const src = join(root, "node_modules", m);
    if (!existsSync(src)) throw new Error(`node_modules/${m} não encontrado (rode npm ci)`);
    cpSync(src, join(dir, "node_modules", m), { recursive: true, filter: pruneModuleFile });
  }
  if (name === "worker_knowledge") verifyKnowledgeZipDir(dir);
  // zip determinístico: mtime fixo + ordem estável + sem atributos extras → mesmo conteúdo = mesmo hash
  const fixed = new Date("2020-01-01T00:00:00Z");
  const files = walk(dir).sort();
  for (const f of files) utimesSync(f, fixed, fixed);
  const zip = join(out, `${name}.zip`);
  const rel = files.map((f) => f.slice(dir.length + 1));
  try {
    execFileSync("zip", ["-X", "-q", zip, ...rel], { cwd: dir });
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
    // sem `zip` instalado: python3 (também determinístico: data fixa, ordem estável)
    const py = [
      "import sys, zipfile",
      "z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)",
      "for f in sys.argv[2:]:",
      "    i = zipfile.ZipInfo(f, (2020, 1, 1, 0, 0, 0)); i.compress_type = zipfile.ZIP_DEFLATED; i.external_attr = 0o644 << 16",
      "    z.writestr(i, open(f, 'rb').read())",
      "z.close()",
    ].join("\n");
    execFileSync("python3", ["-c", py, zip, ...rel], { cwd: dir });
  }
  console.log(`${name}: ${(statSync(zip).size / 1024 / 1024).toFixed(2)} MB → ${zip}`);
}
