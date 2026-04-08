#!/usr/bin/env tsx
/**
 * Benchmark CLI — unified entry point for all benchmark operations.
 *
 * Usage:
 *   npx tsx benchmark/cli.ts <command> [options]
 *
 * Commands:
 *   run       Run benchmark scenarios and save result
 *   compare   Compare baseline vs candidate
 *   promote   Promote a candidate run to production
 *   report    (Re)generate report from existing run file
 *   refine    Analyze a run and generate refinement suggestions
 *   replay    Replay real conversations through the agent
 *   list      List saved runs
 *
 * Options:
 *   --mock            Run without OpenAI (for CI, deterministic checks only)
 *   --live            Run with real OpenAI + DB (default)
 *   --tags <t,t,...>  Filter scenarios by tags
 *   --scenario <id>   Run a single scenario by ID
 *   --no-judge        Skip LLM judge even in live mode
 *   --baseline <id>   Baseline run ID for comparison
 *   --candidate <id>  Candidate run ID for comparison
 *   --run <id|path>   Run ID or file path for report/refine commands
 *   --limit <n>       Max conversations for replay command
 *   --since <date>    ISO date for replay command (replay since this date)
 *   --commit <sha>    Git commit SHA to tag this run
 *   --prompt <ver>    Prompt version to tag this run
 */

import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load env from repo root
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://navalhia:navalhia_secret@localhost:5432/navalhia";
}

import { filterScenarios, getScenario, ALL_SCENARIOS } from "./scenarios/index.js";
import { runBenchmark } from "./runner/harness.js";
import { runReplay } from "./runner/replay.js";
import { saveRun, loadRun, loadRunFromFile, getLatestByTag, promoteToProduction, listRuns } from "./comparison/baseline.js";
import { compareRuns } from "./comparison/gate.js";
import { saveRunReport, saveComparisonReport, generateRunMarkdown } from "./reports/generator.js";
import { generateRefinementReport } from "./refinement/patcher.js";
import { resolveConfig } from "./config.js";
import { listIncidents, getIncident, updateIncidentStatus, extractScenarioDraft } from "./incidents.js";
import type { ScenarioTag } from "./types.js";

// ---------------------------------------------------------------------------
// CLI argument parsing (minimal, no external dependency)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else if (!arg.startsWith("-") && i === 0) {
      args["command"] = arg;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRun(args: Record<string, string | boolean>): Promise<void> {
  const mode = args["mock"] ? "mock" : "live";
  const enableJudge = !args["no-judge"];
  const filterTags = args["tags"]
    ? (String(args["tags"]).split(",") as ScenarioTag[])
    : [];
  const scenarioId = args["scenario"] ? String(args["scenario"]) : null;
  const commitSha = args["commit"] ? String(args["commit"]) : undefined;
  const promptVersion = args["prompt"] ? String(args["prompt"]) : undefined;

  let scenarios = scenarioId
    ? [getScenario(scenarioId)]
    : filterScenarios(filterTags);

  if (scenarios.length === 0) {
    console.error("No scenarios found for the given filters.");
    process.exit(1);
  }

  const config = resolveConfig({ enableJudge });

  const run = await runBenchmark({
    scenarios,
    mode,
    enableJudge,
    config,
    filterTags: filterTags.length > 0 ? filterTags : undefined,
    commitSha,
    promptVersion,
  });

  // Save run and generate reports
  const { jsonPath, mdPath } = await saveRunReport(run, config.resultsDir);
  await saveRun(run, "candidate", config.resultsDir);

  console.log(`\n📁 Arquivos salvos:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   MD:   ${mdPath}`);
  console.log(`\n   Run ID: ${run.meta.runId}`);
  console.log(`\n💡 Próximos passos:`);
  console.log(`   Compare com baseline: npx tsx benchmark/cli.ts compare`);
  console.log(`   Gere sugestões:       npx tsx benchmark/cli.ts refine --run ${run.meta.runId}`);
}

async function cmdCompare(args: Record<string, string | boolean>): Promise<void> {
  const config = resolveConfig();

  // Load baseline
  let baselineRun;
  const baselineArg = args["baseline"] ? String(args["baseline"]) : null;
  if (baselineArg) {
    try {
      baselineRun = baselineArg.endsWith(".json")
        ? await loadRunFromFile(baselineArg)
        : await loadRun(baselineArg, config.resultsDir);
    } catch (e) {
      console.error(`Failed to load baseline: ${(e as Error).message}`);
      process.exit(1);
    }
  } else {
    const record = await getLatestByTag("production", config.resultsDir);
    if (!record) {
      console.error(
        "No production baseline found. Run a benchmark and promote it first:\n" +
        "  npx tsx benchmark/cli.ts run --live\n" +
        "  npx tsx benchmark/cli.ts promote --candidate <runId>"
      );
      process.exit(1);
    }
    baselineRun = await loadRun(record.runId, config.resultsDir);
  }

  // Load candidate
  let candidateRun;
  const candidateArg = args["candidate"] ? String(args["candidate"]) : null;
  if (candidateArg) {
    candidateRun = candidateArg.endsWith(".json")
      ? await loadRunFromFile(candidateArg)
      : await loadRun(candidateArg, config.resultsDir);
  } else {
    // Latest candidate
    const records = await listRuns("candidate", config.resultsDir);
    if (records.length === 0) {
      console.error("No candidate run found. Run a benchmark first.");
      process.exit(1);
    }
    candidateRun = await loadRun(records[0].runId, config.resultsDir);
  }

  console.log(`\n⚖️  Comparando:`);
  console.log(`   Baseline:  ${baselineRun.meta.runId.slice(0, 8)} (${fmt(baselineRun.meta.runAt)})`);
  console.log(`   Candidato: ${candidateRun.meta.runId.slice(0, 8)} (${fmt(candidateRun.meta.runAt)})`);
  console.log("");

  const comparison = compareRuns(baselineRun, candidateRun, config.gate);
  const mdPath = await saveComparisonReport(comparison, config.resultsDir);

  // Print gate result
  const icon = comparison.gate.passed ? "✅" : comparison.gate.recommendation === "manual_review" ? "⚠️" : "❌";
  console.log(`${icon} Gate: ${comparison.gate.recommendation.toUpperCase()}`);
  console.log(`   ${comparison.gate.reason}`);
  console.log(`\n   Δ Score médio:     ${fmtDelta(comparison.deltaAvgScore)}`);
  console.log(`   Δ Violações críticas: ${fmtDelta(comparison.deltaCriticalViolations)}`);
  console.log(`   Δ Total violações: ${fmtDelta(comparison.deltaTotalViolations)}`);

  if (comparison.regressions.length > 0) {
    console.log(`\n   ⬇️  Regressões: ${comparison.regressions.map((r) => r.scenarioId).join(", ")}`);
  }
  if (comparison.improvements.length > 0) {
    console.log(`   ⬆️  Melhorias: ${comparison.improvements.map((r) => r.scenarioId).join(", ")}`);
  }

  console.log(`\n📄 Relatório: ${mdPath}`);

  if (comparison.gate.passed) {
    console.log(`\n💡 Para promover o candidato: npx tsx benchmark/cli.ts promote --candidate ${candidateRun.meta.runId}`);
  }
}

async function cmdPromote(args: Record<string, string | boolean>): Promise<void> {
  const config = resolveConfig();
  const candidateArg = args["candidate"] ? String(args["candidate"]) : null;

  let candidateRun;
  if (candidateArg) {
    candidateRun = await loadRun(candidateArg, config.resultsDir);
  } else {
    const records = await listRuns("candidate", config.resultsDir);
    if (records.length === 0) {
      console.error("No candidate run found.");
      process.exit(1);
    }
    candidateRun = await loadRun(records[0].runId, config.resultsDir);
  }

  // Re-run gate check if there's a production baseline
  const productionRecord = await getLatestByTag("production", config.resultsDir);
  if (productionRecord) {
    const baselineRun = await loadRun(productionRecord.runId, config.resultsDir);
    const comparison = compareRuns(baselineRun, candidateRun, config.gate);

    if (!comparison.gate.passed && comparison.gate.recommendation === "reject") {
      console.error(`\n❌ Promoção bloqueada pelo gate:`);
      console.error(`   ${comparison.gate.reason}`);
      console.error(`\n   Execute 'compare' para ver o relatório completo.`);
      process.exit(1);
    }

    if (comparison.gate.recommendation === "manual_review") {
      console.warn(`\n⚠️  Gate requer revisão manual antes de promover:`);
      console.warn(`   ${comparison.gate.reason}`);
      console.warn(`   Forçando promoção — certifique-se de ter revisado o relatório.`);
    }
  }

  await promoteToProduction(candidateRun.meta.runId, config.resultsDir);
  console.log(`\n✅ Run ${candidateRun.meta.runId.slice(0, 8)} promovido como baseline de produção.`);
}

async function cmdReport(args: Record<string, string | boolean>): Promise<void> {
  const config = resolveConfig();
  const runArg = args["run"] ? String(args["run"]) : null;

  let run;
  if (runArg) {
    run = runArg.endsWith(".json")
      ? await loadRunFromFile(runArg)
      : await loadRun(runArg, config.resultsDir);
  } else {
    const records = await listRuns(undefined, config.resultsDir);
    if (records.length === 0) {
      console.error("No runs found. Execute 'run' first.");
      process.exit(1);
    }
    run = await loadRun(records[0].runId, config.resultsDir);
  }

  const { mdPath } = await saveRunReport(run, config.resultsDir);
  console.log(`\n📄 Relatório gerado: ${mdPath}`);
  console.log("\n" + generateRunMarkdown(run).slice(0, 1500) + "\n...");
}

async function cmdRefine(args: Record<string, string | boolean>): Promise<void> {
  const config = resolveConfig();
  const runArg = args["run"] ? String(args["run"]) : null;

  let run;
  if (runArg) {
    run = runArg.endsWith(".json")
      ? await loadRunFromFile(runArg)
      : await loadRun(runArg, config.resultsDir);
  } else {
    const records = await listRuns(undefined, config.resultsDir);
    if (records.length === 0) {
      console.error("No runs found. Execute 'run' first.");
      process.exit(1);
    }
    run = await loadRun(records[0].runId, config.resultsDir);
  }

  console.log(`\n🔍 Analisando run ${run.meta.runId.slice(0, 8)}...`);

  const report = await generateRefinementReport(run, config.suggestionsDir, config.topPatternsCount);

  console.log(`\n📊 Top padrões de falha:`);
  for (const p of report.topPatterns) {
    console.log(`   ${p.violationType} [${p.severity}] — ${p.frequency}× em ${p.affectedScenarios.length} cenário(s)`);
  }

  console.log(`\n📝 Sugestões salvas em: ${report.suggestionsFile}`);
  console.log(`\n⚠️  Revise o arquivo antes de aplicar qualquer instrução.`);
}

async function cmdReplay(args: Record<string, string | boolean>): Promise<void> {
  const limit = args["limit"] ? parseInt(String(args["limit"]), 10) : 10;
  const since = args["since"] ? String(args["since"]) : undefined;

  const report = await runReplay({ limit, since });

  console.log(`\n📊 Replay concluído:`);
  console.log(`   Conversas: ${report.totalConversations}`);
  console.log(`   Regressões: ${report.totalRegressions}`);
  console.log(`   Melhorias: ${report.totalImprovements}`);
}

async function cmdList(_args: Record<string, string | boolean>): Promise<void> {
  const config = resolveConfig();
  const records = await listRuns(undefined, config.resultsDir);

  if (records.length === 0) {
    console.log("Nenhum run encontrado. Execute 'run' primeiro.");
    return;
  }

  console.log(`\n📋 Runs salvos (${records.length}):\n`);
  console.log(`${"ID".padEnd(12)} ${"Tag".padEnd(12)} ${"Data".padEnd(22)} ${"Score".padEnd(8)} Cenários`);
  console.log("─".repeat(70));

  for (const r of records) {
    const dateStr = new Date(r.savedAt).toLocaleString("pt-BR").slice(0, 20);
    const score = r.summary.avgScore.toFixed(1);
    const scenarios = `${r.summary.passedScenarios}/${r.meta.totalScenarios}`;
    console.log(
      `${r.runId.slice(0, 8).padEnd(12)} ${r.tag.padEnd(12)} ${dateStr.padEnd(22)} ${score.padEnd(8)} ${scenarios}`
    );
  }
}

// ---------------------------------------------------------------------------
// incidents command
// ---------------------------------------------------------------------------

async function cmdIncidents(args: Record<string, string | boolean>): Promise<void> {
  const subcommand = String(args["command"] ?? "list");
  const statusFilter = args["status"] ? String(args["status"]) : undefined;
  const barbershopFilter = args["barbershop"] ? String(args["barbershop"]) : undefined;

  if (subcommand === "list") {
    const incidents = await listIncidents({
      limit: args["limit"] ? Number(args["limit"]) : 50,
      status: statusFilter,
      barbershopId: barbershopFilter,
    });

    if (incidents.length === 0) {
      console.log("Nenhum incidente encontrado.");
      return;
    }

    const SEVERITY_ICON: Record<string, string> = {
      critical: "🔴",
      medium: "🟡",
      light: "🟢",
    };
    const STATUS_ICON: Record<string, string> = {
      open: "○",
      triaged: "◐",
      promoted: "●",
      archived: "×",
    };

    console.log(`\nIncidentes salvos (${incidents.length})\n`);
    console.log(`${"ID".padEnd(10)} ${"Sev".padEnd(5)} ${"Status".padEnd(10)} ${"Tipo".padEnd(32)} ${"Data"}`);
    console.log("─".repeat(80));
    for (const inc of incidents) {
      const sev = SEVERITY_ICON[inc.severity] ?? inc.severity;
      const st = STATUS_ICON[inc.status] ?? inc.status;
      const type = inc.incident_type.slice(0, 30).padEnd(32);
      const date = new Date(inc.created_at).toLocaleString("pt-BR").slice(0, 17);
      console.log(`${inc.id.slice(0, 8).padEnd(10)} ${sev.padEnd(5)} ${(st + " " + inc.status).padEnd(10)} ${type} ${date}`);
      if (inc.manager_note) {
        console.log(`  └─ ${inc.manager_note.slice(0, 80)}`);
      }
    }
    console.log();
    return;
  }

  if (subcommand === "export") {
    const id = args["id"] ? String(args["id"]) : null;
    if (!id) {
      console.error("Uso: benchmark incidents export --id <uuid>");
      process.exit(1);
    }
    const incident = await getIncident(id);
    if (!incident) {
      console.error(`Incidente não encontrado: ${id}`);
      process.exit(1);
    }
    const draft = extractScenarioDraft(incident);
    if (!draft) {
      console.error("Este incidente não possui rascunho de cenário.");
      process.exit(1);
    }
    console.log(JSON.stringify(draft, null, 2));
    console.log(`\n// Cole em: backend/benchmark/scenarios/barbershop/<arquivo>.ts`);
    console.log(`// Ajuste: id, name, turns, expected.asserts`);
    return;
  }

  if (subcommand === "status") {
    const id = args["id"] ? String(args["id"]) : null;
    const newStatus = args["set"] ? String(args["set"]) : null;
    if (!id || !newStatus) {
      console.error("Uso: benchmark incidents status --id <uuid> --set <open|triaged|promoted|archived>");
      process.exit(1);
    }
    const validStatuses = ["open", "triaged", "promoted", "archived"];
    if (!validStatuses.includes(newStatus)) {
      console.error(`Status inválido: ${newStatus}. Use: ${validStatuses.join(", ")}`);
      process.exit(1);
    }
    await updateIncidentStatus(id, newStatus as "open" | "triaged" | "promoted" | "archived");
    console.log(`✓ Incidente ${id.slice(0, 8)} → ${newStatus}`);
    return;
  }

  console.error(`Subcomando desconhecido: ${subcommand}. Use list, export ou status.`);
  process.exit(1);
}

function cmdHelp(): void {
  console.log(`
NavalhIA — Benchmark & Refinement CLI

USAGE:
  npx tsx benchmark/cli.ts <command> [options]

COMMANDS:
  run        Executar benchmark de cenários
  compare    Comparar baseline vs candidato
  promote    Promover candidato como produção
  report     Gerar/regen relatório de um run
  refine     Analisar falhas e gerar sugestões
  replay     Replay de conversas reais do DB
  list       Listar runs salvos
  incidents  Gerenciar incidentes de IA reportados

OPTIONS (run):
  --mock           Sem OpenAI (CI)
  --live           Com OpenAI + DB (padrão)
  --tags booking,cancellation   Filtrar por tags
  --scenario greet-01-vague     Rodar cenário específico
  --no-judge       Pular LLM judge
  --commit <sha>   SHA do commit para rastreabilidade
  --prompt <ver>   Versão do prompt para rastreabilidade

OPTIONS (compare):
  --baseline <id|path>    ID ou caminho do baseline
  --candidate <id|path>   ID ou caminho do candidato

OPTIONS (promote):
  --candidate <id>        ID do candidato a promover

OPTIONS (report / refine):
  --run <id|path>         ID ou caminho do run

OPTIONS (replay):
  --limit <n>     Número máximo de conversas (padrão: 10)
  --since <date>  Replay desde esta data (ISO)

EXEMPLOS:
  npx tsx benchmark/cli.ts run --mock
  npx tsx benchmark/cli.ts run --live --tags booking
  npx tsx benchmark/cli.ts compare
  npx tsx benchmark/cli.ts promote
  npx tsx benchmark/cli.ts refine
  npx tsx benchmark/cli.ts list
  npx tsx benchmark/cli.ts incidents list
  npx tsx benchmark/cli.ts incidents export <id>
  npx tsx benchmark/cli.ts incidents status <id> triaged
`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

function fmtDelta(n: number): string {
  const r = Math.round(n * 100) / 100;
  return r > 0 ? `+${r}` : `${r}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
    cmdHelp();
    return;
  }

  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case "run":
      await cmdRun(args);
      break;
    case "compare":
      await cmdCompare(args);
      break;
    case "promote":
      await cmdPromote(args);
      break;
    case "report":
      await cmdReport(args);
      break;
    case "refine":
      await cmdRefine(args);
      break;
    case "replay":
      await cmdReplay(args);
      break;
    case "list":
      await cmdList(args);
      break;
    case "incidents": {
      // Pass the subcommand as "command" key
      const subArgs = parseArgs(argv.slice(2));
      subArgs["command"] = argv[1] ?? "list";
      await cmdIncidents(subArgs);
      break;
    }
    default:
      console.error(`Comando desconhecido: ${command}`);
      cmdHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
