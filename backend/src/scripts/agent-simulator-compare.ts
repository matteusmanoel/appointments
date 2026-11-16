/**
 * Compara roteiros de replay e goldens com --llm none e --llm openai.
 * Não lê .env. Exige OPENAI_API_KEY no ambiente. Guarda de banco local.
 *
 *   npm run simulate:compare -- --tenant <slug> --out /tmp/navalhia-simulate-compare.md
 */
import { parseCompareLimit, runCompare, COMPARE_MAX_RUNS_CAP, COMPARE_MAX_TOKEN_CAP } from "../ai/simulator/compare.js";
import { assertLocalDatabaseUrl } from "../db/local-database-url.js";
import { DEFAULT_COMPARE_MODEL, DEFAULT_MAX_RUNS, DEFAULT_MAX_TOKENS } from "../ai/simulator/compare-pricing.js";

function usage(): string {
  return `Uso:
  npm run simulate:compare -- --tenant <slug|uuid> [--out arquivo.md] [--model gpt-4o-mini]
                              [--max-runs 1] [--max-tokens 300000] [--only <id>]

Opções:
  --tenant, -t     Slug ou UUID da barbearia (obrigatório para os roteiros de examples)
  --out, -o        Arquivo Markdown de saída (também imprime no terminal)
  --model          Só modelos mini (padrão: ${DEFAULT_COMPARE_MODEL})
  --max-runs       Rodadas por roteiro (padrão: ${DEFAULT_MAX_RUNS})
  --max-tokens     Teto de tokens acumulados; aborta se passar (padrão: ${DEFAULT_MAX_TOKENS})
  --only           Filtra roteiros/goldens pelo id ou nome do arquivo
  --skip-examples  Não roda os roteiros de scripts/examples/
  --skip-goldens   Não roda os goldens

O modo openai liga AI_AGENT_SLOT_INTERPRET e AI_AGENT_LANGUAGE_REWRITE só neste processo.
A flag de reescrita não chama o modelo: este comando não injeta languageRewriter.
Este comando não lê .env: exporte OPENAI_API_KEY (e DATABASE_URL) no terminal.
Nada é enviado pelo WhatsApp. Não use contra clientes reais.`;
}

function arg(args: string[], names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) return "";
      return next;
    }
    for (const name of names) {
      if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
    }
  }
  return undefined;
}

function has(args: string[], names: string[]): boolean {
  return args.some((a) => names.includes(a));
}

async function main() {
  assertLocalDatabaseUrl();
  const args = process.argv.slice(2);
  if (has(args, ["-h", "--help"])) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const tenant = arg(args, ["--tenant", "-t"]);
  const skipExamples = has(args, ["--skip-examples"]);
  let maxRuns: number;
  let maxTokens: number;
  try {
    maxRuns = parseCompareLimit(arg(args, ["--max-runs"]) ?? DEFAULT_MAX_RUNS, "--max-runs", COMPARE_MAX_RUNS_CAP);
    maxTokens = parseCompareLimit(arg(args, ["--max-tokens"]) ?? DEFAULT_MAX_TOKENS, "--max-tokens", COMPARE_MAX_TOKEN_CAP);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
  if (!tenant && !skipExamples) {
    process.stderr.write("Faltou --tenant (necessário para os roteiros de examples).\n\n" + usage() + "\n");
    process.exit(1);
  }
  try {
    const report = await runCompare({
      tenant: tenant || undefined,
      outPath: arg(args, ["--out", "-o"]),
      model: arg(args, ["--model"]) ?? DEFAULT_COMPARE_MODEL,
      maxRuns,
      maxTokens,
      only: arg(args, ["--only"]),
      examples: skipExamples ? false : undefined,
      goldens: has(args, ["--skip-goldens"]) ? false : undefined,
      requireApiKey: true,
    });
    if (report.aborted) process.exit(2);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}

main();
