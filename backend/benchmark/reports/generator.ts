/**
 * Report generator — produces human-readable Markdown and machine-readable JSON
 * reports from benchmark run results and comparisons.
 *
 * Markdown reports are designed for reading in GitHub, Notion, or a terminal pager.
 * JSON outputs are designed for programmatic consumption and long-term storage.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { BenchmarkRun, ComparisonResult, ScenarioResult, ViolationType } from "../types.js";
import { VIOLATION_SEVERITY } from "../types.js";
import { DEFAULT_CONFIG } from "../config.js";

// ---------------------------------------------------------------------------
// Markdown report for a single run
// ---------------------------------------------------------------------------

export function generateRunMarkdown(run: BenchmarkRun): string {
  const { meta, summary, scenarios } = run;
  const lines: string[] = [];

  // Header
  lines.push(`# Benchmark Report — ${meta.runId.slice(0, 8)}`);
  lines.push("");
  lines.push(`**Data:** ${fmt(meta.runAt)}  `);
  lines.push(`**Modo:** ${meta.mode}  `);
  lines.push(`**Judge:** ${meta.judgeEnabled ? "ativado" : "desativado"}  `);
  if (meta.commitSha) lines.push(`**Commit:** \`${meta.commitSha.slice(0, 8)}\`  `);
  if (meta.promptVersion) lines.push(`**Versão do prompt:** \`${meta.promptVersion}\`  `);
  lines.push("");

  // Executive summary
  lines.push("## Resumo Executivo");
  lines.push("");
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Cenários executados | ${meta.totalScenarios} |`);
  lines.push(`| Passou (score ≥ ${summary.passThreshold}) | ${summary.passedScenarios} (${pct(summary.passedScenarios, meta.totalScenarios)}) |`);
  lines.push(`| Falhou | ${summary.failedScenarios} (${pct(summary.failedScenarios, meta.totalScenarios)}) |`);
  lines.push(`| Score médio | **${summary.avgScore}** |`);
  lines.push(`| Score mínimo | ${summary.minScore} |`);
  lines.push(`| Score máximo | ${summary.maxScore} |`);
  lines.push(`| Violações críticas | **${summary.criticalViolations}** |`);
  lines.push(`| Violações médias | ${summary.mediumViolations} |`);
  lines.push(`| Violações leves | ${summary.lightViolations} |`);
  lines.push(`| Taxa de conclusão de tarefa | ${(summary.taskCompletionRate * 100).toFixed(1)}% |`);
  if (summary.avgJudgeScore !== undefined) {
    lines.push(`| Score médio do judge | ${summary.avgJudgeScore}/100 |`);
  }
  lines.push(`| Total de tokens | ${summary.totalTokens.toLocaleString()} |`);
  lines.push(`| Tokens por cenário (média) | ${summary.avgTokensPerScenario.toFixed(0)} |`);
  lines.push(`| Tempo médio por cenário | ${(summary.avgElapsedMsPerScenario / 1000).toFixed(1)}s |`);
  lines.push("");

  // Verdict
  const overallVerdict = getOverallVerdict(summary);
  lines.push(`## Veredicto Geral`);
  lines.push("");
  lines.push(`> ${overallVerdict}`);
  lines.push("");

  // Top violations
  if (summary.topViolations.length > 0) {
    lines.push("## Violações Mais Frequentes");
    lines.push("");
    lines.push("| Violação | Severidade | Ocorrências |");
    lines.push("|----------|-----------|-------------|");
    for (const v of summary.topViolations) {
      lines.push(`| \`${v.type}\` | ${VIOLATION_SEVERITY[v.type]} | ${v.count} |`);
    }
    lines.push("");
  }

  // Per-scenario results
  lines.push("## Resultados por Cenário");
  lines.push("");
  lines.push("| ID | Nome | Score | Tarefa | Violações | Judge |");
  lines.push("|----|------|-------|--------|-----------|-------|");
  for (const s of scenarios) {
    const taskIcon = s.taskCompleted ? "✓" : "✗";
    const judgeStr = s.judge ? s.judge.overall.toString() : "—";
    const violStr = s.allViolations.length > 0
      ? s.allViolations.map((v) => `\`${v.type}\``).join(", ")
      : "—";
    lines.push(
      `| ${s.scenarioId} | ${s.scenarioName} | **${s.score}** | ${taskIcon} | ${violStr} | ${judgeStr} |`
    );
  }
  lines.push("");

  // Failed scenarios detail
  const failed = scenarios.filter((s) => s.score < summary.passThreshold);
  if (failed.length > 0) {
    lines.push("## Detalhes dos Cenários com Falha");
    lines.push("");
    for (const s of failed) {
      lines.push(`### ${s.scenarioId} — ${s.scenarioName}`);
      lines.push(`**Score:** ${s.score} | **Tarefa concluída:** ${s.taskCompleted ? "Sim" : "Não"}`);
      lines.push("");
      appendScenarioDetail(lines, s);
      lines.push("");
    }
  }

  // Judge details (if available)
  const withJudge = scenarios.filter((s) => s.judge !== undefined);
  if (withJudge.length > 0) {
    lines.push("## Detalhes do Judge (LLM)");
    lines.push("");
    for (const s of withJudge) {
      lines.push(`### ${s.scenarioId} — ${s.scenarioName} (judge: ${s.judge!.overall}/100)`);
      lines.push("");
      lines.push("| Métrica | Score |");
      lines.push("|---------|-------|");
      for (const [metric, score] of Object.entries(s.judge!.scores)) {
        lines.push(`| ${metric} | ${score}/5 |`);
      }
      lines.push("");
      lines.push(`**Rationale:** ${s.judge!.rationale}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`*Gerado em ${new Date().toISOString()} | Judge version: ${withJudge[0]?.judge?.judgeVersion ?? "N/A"}*`);

  return lines.join("\n");
}

function appendScenarioDetail(lines: string[], s: ScenarioResult): void {
  if (s.allViolations.length > 0) {
    lines.push("**Violações:**");
    for (const v of s.allViolations) {
      lines.push(`- \`${v.type}\` [${v.severity}] turno ${v.turnIndex + 1}: _${v.excerpt}_`);
    }
  }
  if (s.assertFailures.length > 0) {
    lines.push("**Asserts falhos:**");
    for (const f of s.assertFailures) {
      lines.push(`- [${f.severity}] turno ${f.turnIndex + 1}: ${f.name}`);
    }
  }
  lines.push(`**Score breakdown:** base=${s.scoreBreakdown.base} | critica=-${s.scoreBreakdown.criticalPenalty} | media=-${s.scoreBreakdown.mediumPenalty} | leve=-${s.scoreBreakdown.lightPenalty} | qualidade=+${s.scoreBreakdown.qualityBonus} | tarefa=+${s.scoreBreakdown.taskCompletionBonus} | final=${s.scoreBreakdown.final}${s.scoreBreakdown.cappedByCritical ? " (cap)" : ""}`);

  // Sample turn excerpts
  if (s.turns.length > 0) {
    lines.push("**Últimas mensagens:**");
    const lastTurns = s.turns.slice(-2);
    for (const t of lastTurns) {
      lines.push(`> _Cliente:_ ${t.userMessage.slice(0, 100)}`);
      lines.push(`> _Agente:_ ${t.agentReply.slice(0, 200)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown report for a comparison
// ---------------------------------------------------------------------------

export function generateComparisonMarkdown(comparison: ComparisonResult): string {
  const lines: string[] = [];
  const { gate } = comparison;

  lines.push(`# Comparação Baseline × Candidato`);
  lines.push("");
  lines.push(`**Baseline:** \`${comparison.baselineRunId.slice(0, 8)}\`  `);
  lines.push(`**Candidato:** \`${comparison.candidateRunId.slice(0, 8)}\`  `);
  lines.push(`**Data:** ${fmt(comparison.comparedAt)}`);
  lines.push("");

  // Gate result
  const gateIcon = gate.passed ? "✅" : gate.recommendation === "manual_review" ? "⚠️" : "❌";
  lines.push(`## ${gateIcon} Resultado do Gate`);
  lines.push("");
  lines.push(`**Recomendação:** \`${gate.recommendation}\`  `);
  lines.push(`**Motivo:** ${gate.reason}`);
  lines.push("");

  lines.push("### Regras do Gate");
  lines.push("");
  for (const rule of gate.rules) {
    const icon = rule.passed ? "✓" : "✗";
    lines.push(`**${icon} ${rule.name}**`);
    lines.push(`> ${rule.message}`);
    if (rule.baselineValue !== undefined && rule.candidateValue !== undefined) {
      lines.push(`> Baseline: \`${rule.baselineValue}\` → Candidato: \`${rule.candidateValue}\``);
    }
    lines.push("");
  }

  // Delta summary
  lines.push("## Variações (Candidato − Baseline)");
  lines.push("");
  lines.push("| Métrica | Delta |");
  lines.push("|---------|-------|");
  lines.push(`| Score médio | ${delta(comparison.deltaAvgScore)} |`);
  lines.push(`| Violações críticas | ${delta(comparison.deltaCriticalViolations)} |`);
  lines.push(`| Total de violações | ${delta(comparison.deltaTotalViolations)} |`);
  lines.push(`| Taxa de conclusão | ${delta(comparison.deltaTaskCompletionRate * 100, "%")} |`);
  if (comparison.deltaAvgJudgeScore !== undefined) {
    lines.push(`| Score do judge | ${delta(comparison.deltaAvgJudgeScore)} |`);
  }
  lines.push(`| Tokens médios/cenário | ${delta(comparison.deltaAvgTokens)} |`);
  lines.push("");

  // Regressions
  if (comparison.regressions.length > 0) {
    lines.push("## ⬇️ Regressões por Cenário");
    lines.push("");
    for (const r of comparison.regressions) {
      lines.push(`- \`${r.scenarioId}\`: Δ${r.delta}`);
    }
    lines.push("");
  }

  // Improvements
  if (comparison.improvements.length > 0) {
    lines.push("## ⬆️ Melhorias por Cenário");
    lines.push("");
    for (const r of comparison.improvements) {
      lines.push(`- \`${r.scenarioId}\`: Δ+${r.delta}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Gerado em ${new Date().toISOString()}*`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export interface ReportPaths {
  jsonPath: string;
  mdPath: string;
}

export async function saveRunReport(
  run: BenchmarkRun,
  outputDir?: string
): Promise<ReportPaths> {
  const dir = outputDir ?? DEFAULT_CONFIG.resultsDir;
  await fs.mkdir(dir, { recursive: true });

  const base = path.join(dir, run.meta.runId);
  const jsonPath = `${base}.json`;
  const mdPath = `${base}.md`;

  await fs.writeFile(jsonPath, JSON.stringify(run, null, 2), "utf-8");
  await fs.writeFile(mdPath, generateRunMarkdown(run), "utf-8");

  return { jsonPath, mdPath };
}

export async function saveComparisonReport(
  comparison: ComparisonResult,
  outputDir?: string
): Promise<string> {
  const dir = outputDir ?? DEFAULT_CONFIG.resultsDir;
  await fs.mkdir(dir, { recursive: true });

  const filename = `compare-${comparison.baselineRunId.slice(0, 8)}-vs-${comparison.candidateRunId.slice(0, 8)}.md`;
  const mdPath = path.join(dir, filename);
  await fs.writeFile(mdPath, generateComparisonMarkdown(comparison), "utf-8");

  return mdPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function pct(part: number, total: number): string {
  if (total === 0) return "—";
  return `${((part / total) * 100).toFixed(0)}%`;
}

function delta(value: number, unit = ""): string {
  const rounded = typeof value === "number" ? Math.round(value * 100) / 100 : value;
  if (rounded > 0) return `**+${rounded}${unit}** ✅`;
  if (rounded < 0) return `**${rounded}${unit}** ❌`;
  return `0${unit} —`;
}

function getOverallVerdict(summary: BenchmarkRunSummary): string {
  if (summary.criticalViolations > 0) {
    return `⛔ **Atenção crítica:** ${summary.criticalViolations} violação(ões) crítica(s) detectada(s). O agente não está apto para produção com essa configuração.`;
  }
  if (summary.passedScenarios === summary.passedScenarios + summary.failedScenarios) {
    return `✅ **Excelente:** todos os ${summary.passedScenarios} cenários passaram. Score médio: ${summary.avgScore}/100.`;
  }
  const passRate = summary.passedScenarios / (summary.passedScenarios + summary.failedScenarios);
  if (passRate >= 0.8) {
    return `✅ **Bom:** ${(passRate * 100).toFixed(0)}% dos cenários passaram. Score médio: ${summary.avgScore}/100. Ver detalhes dos cenários com falha.`;
  }
  if (passRate >= 0.5) {
    return `⚠️ **Atenção:** apenas ${(passRate * 100).toFixed(0)}% dos cenários passaram. Score médio: ${summary.avgScore}/100. Revisão necessária.`;
  }
  return `❌ **Crítico:** ${(passRate * 100).toFixed(0)}% de aprovação. Score médio: ${summary.avgScore}/100. O agente precisa de ajustes antes de ir para produção.`;
}
