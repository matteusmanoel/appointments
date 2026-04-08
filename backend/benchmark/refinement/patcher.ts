/**
 * Refinement patcher — generates hypotheses and suggested instructions
 * for fixing identified failure patterns.
 *
 * IMPORTANT: This module does NOT apply any changes automatically.
 * It produces a human-readable suggestion file that must be reviewed
 * and approved before being applied.
 *
 * Approval workflow:
 * 1. Run `benchmark refine` to generate suggestions
 * 2. Read benchmark/suggestions/YYYY-MM-DD.md
 * 3. Review and edit the suggested instructions
 * 4. Apply to `barbershop_ai_settings.additional_instructions` or prompt
 * 5. Re-run benchmark as candidate
 * 6. Compare with baseline via `benchmark compare`
 * 7. Promote if gate passes
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  BenchmarkRun,
  FailurePattern,
  RefinementHypothesis,
  RefinementReport,
  ViolationType,
} from "../types.js";
import { analyzeFailurePatterns, listFailedScenarios, identifyQuickWins } from "./analyzer.js";
import { DEFAULT_CONFIG } from "../config.js";

// ---------------------------------------------------------------------------
// Hypothesis knowledge base — one entry per violation type
// ---------------------------------------------------------------------------

interface ViolationFix {
  hypothesis: string;
  suggestedInstruction: string;
  confidence: RefinementHypothesis["confidence"];
  risk: RefinementHypothesis["risk"];
}

const VIOLATION_FIXES: Partial<Record<ViolationType, ViolationFix>> = {
  ai_exposure: {
    hypothesis:
      "O agente está respondendo com frases que revelam sua natureza automatizada. " +
      "Isso tipicamente acontece quando o modelo tenta ser honesto sobre suas limitações ou quando não tem dados para responder.",
    suggestedInstruction:
      "Nunca mencione que você é um sistema automatizado, bot, IA ou assistente virtual. " +
      "Se não souber algo, diga 'não tenho essa informação no momento' sem explicar o motivo técnico. " +
      "Nunca use frases como 'como IA', 'fui programado', 'meu sistema', ou 'não tenho acesso a'.",
    confidence: "high",
    risk: "safe",
  },
  uuid_leak: {
    hypothesis:
      "UUIDs estão aparecendo nas respostas ao cliente. Isso pode acontecer quando o agente " +
      "inclui IDs de barbeiros, serviços ou agendamentos diretamente no texto da resposta.",
    suggestedInstruction:
      "Nunca inclua identificadores técnicos (como IDs, códigos internos ou hashes) nas mensagens para o cliente. " +
      "Refira-se a barbeiros, serviços e agendamentos apenas pelo nome ou descrição.",
    confidence: "high",
    risk: "safe",
  },
  phone_ask: {
    hypothesis:
      "O agente está pedindo o telefone do cliente, mas já temos o número pelo WhatsApp. " +
      "Isso indica que o agente não está ciente de que o número de contato já é conhecido.",
    suggestedInstruction:
      "Você já tem o número de WhatsApp do cliente pelo canal de comunicação. " +
      "Nunca peça o telefone, celular ou WhatsApp do cliente — isso cria atrito desnecessário.",
    confidence: "high",
    risk: "safe",
  },
  pre_booking_claim: {
    hypothesis:
      "O agente afirma que criou um agendamento antes de a ferramenta de criação confirmar. " +
      "Isso cria expectativa falsa e pode causar confusão se o agendamento não for concluído.",
    suggestedInstruction:
      "Só confirme que um agendamento foi criado APÓS a ferramenta create_appointment retornar sucesso. " +
      "Até lá, use linguagem condicional: 'vou verificar', 'vou tentar', 'se tiver disponível'.",
    confidence: "high",
    risk: "safe",
  },
  past_time_suggestion: {
    hypothesis:
      "O agente está sugerindo horários no passado para o dia de hoje. " +
      "Provavelmente está chamando get_next_slots sem filtrar pelo horário atual.",
    suggestedInstruction:
      "Quando o cliente pedir horário 'hoje', sempre use get_next_slots com after_time definido para o horário atual. " +
      "Nunca sugira horários que já passaram.",
    confidence: "high",
    risk: "safe",
  },
  markdown_overuse: {
    hypothesis:
      "O agente está usando formatação markdown excessiva (muitos **negritos**) que aparece como texto literal no WhatsApp.",
    suggestedInstruction:
      "Evite usar formatação markdown. No WhatsApp, o texto aparece sem formatação visual. " +
      "Prefira listas simples com hífen ou enumere os itens de forma natural no texto.",
    confidence: "medium",
    risk: "safe",
  },
  duplicate_confirmation: {
    hypothesis:
      "O agente está pedindo confirmação múltiplas vezes na mesma conversa, o que cria atrito e parece robotizado.",
    suggestedInstruction:
      "Peça confirmação apenas uma vez antes de criar o agendamento. " +
      "Se o cliente já confirmou, proceda com a criação sem pedir confirmação novamente.",
    confidence: "medium",
    risk: "safe",
  },
  redundant_info_request: {
    hypothesis:
      "O agente está pedindo informações que o cliente já forneceu anteriormente na conversa. " +
      "Isso indica falha no uso do contexto da conversa.",
    suggestedInstruction:
      "Sempre verifique o histórico da conversa antes de fazer perguntas. " +
      "Se o cliente já informou nome, serviço, data ou horário, não peça novamente.",
    confidence: "high",
    risk: "safe",
  },
  technical_apology: {
    hypothesis:
      "O agente está se desculpando por erros técnicos de forma que expõe o sistema ao cliente.",
    suggestedInstruction:
      "Se houver um problema, diga simplesmente que 'não consegui verificar nesse momento' e ofereça tentar de outra forma. " +
      "Nunca mencione erros de sistema, falhas técnicas ou problemas de serviço.",
    confidence: "high",
    risk: "safe",
  },
  loop_detected: {
    hypothesis:
      "O agente está repetindo as mesmas respostas em turnos consecutivos, indicando um loop conversacional.",
    suggestedInstruction:
      "Se você perceber que está perguntando a mesma coisa ou dando a mesma resposta repetidamente, " +
      "mude de abordagem: tente uma perspectiva diferente ou proponha um caminho alternativo para avançar.",
    confidence: "medium",
    risk: "moderate",
  },
  excessive_emojis: {
    hypothesis:
      "O agente está usando mais de 4 emojis por mensagem, o que pode parecer excessivo e informal.",
    suggestedInstruction:
      "Use no máximo 1-2 emojis por mensagem, e apenas quando adicionarem valor expressivo. " +
      "Prefira mensagens limpas e diretas.",
    confidence: "high",
    risk: "safe",
  },
  message_too_long: {
    hypothesis:
      "O agente está enviando mensagens muito longas (>1200 chars) que são difíceis de ler no WhatsApp.",
    suggestedInstruction:
      "Mantenha cada mensagem com no máximo 3-4 informações principais. " +
      "Se houver muito conteúdo, divida em 2-3 mensagens curtas ao invés de uma longa.",
    confidence: "medium",
    risk: "safe",
  },
  missing_required_tool: {
    hypothesis:
      "O agente não está chamando ferramentas obrigatórias para o fluxo (ex: check_availability antes de confirmar horário).",
    suggestedInstruction:
      "Sempre consulte a disponibilidade via check_availability antes de sugerir ou confirmar um horário. " +
      "Nunca prometa um horário sem verificar primeiro.",
    confidence: "medium",
    risk: "moderate",
  },
};

// ---------------------------------------------------------------------------
// Hypothesis generation
// ---------------------------------------------------------------------------

export function generateHypotheses(patterns: FailurePattern[]): RefinementHypothesis[] {
  return patterns.map((pattern) => {
    const fix = VIOLATION_FIXES[pattern.violationType];

    if (fix) {
      return {
        pattern,
        hypothesis: fix.hypothesis,
        suggestedInstruction: fix.suggestedInstruction,
        confidence: fix.confidence,
        risk: fix.risk,
      };
    }

    // Generic fallback for violations without a specific fix
    return {
      pattern,
      hypothesis: `Padrão de violação '${pattern.violationType}' detectado em ${pattern.frequency} ocorrências. ` +
        `Investigar manualmente as ${pattern.sampleExcerpts.length} amostras abaixo.`,
      suggestedInstruction:
        `Revisar manualmente os cenários afetados: ${pattern.affectedScenarios.join(", ")}`,
      confidence: "low",
      risk: "risky",
    };
  });
}

// ---------------------------------------------------------------------------
// Suggestions markdown
// ---------------------------------------------------------------------------

function generateSuggestionsMarkdown(
  run: BenchmarkRun,
  patterns: FailurePattern[],
  hypotheses: RefinementHypothesis[],
  quickWins: ReturnType<typeof identifyQuickWins>,
  failedScenarios: ReturnType<typeof listFailedScenarios>
): string {
  const lines: string[] = [];

  lines.push(`# Sugestões de Refinamento`);
  lines.push("");
  lines.push(`**Run:** \`${run.meta.runId.slice(0, 8)}\`  `);
  lines.push(`**Gerado em:** ${new Date().toLocaleString("pt-BR")}  `);
  lines.push(`**Score médio:** ${run.summary.avgScore}/100  `);
  lines.push(`**Violações críticas:** ${run.summary.criticalViolations}`);
  lines.push("");
  lines.push(
    "> ⚠️ **Este documento é uma sugestão, não uma aplicação automática.** " +
    "Revise cada instrução antes de aplicar. Após aplicar, re-execute o benchmark como candidato " +
    "e compare com o baseline antes de promover."
  );
  lines.push("");

  // Quick wins
  if (quickWins.length > 0) {
    lines.push("## 🎯 Quick Wins (menor esforço, maior impacto)");
    lines.push("");
    for (const win of quickWins) {
      lines.push(
        `- **${win.scenarioId}** (score atual: ${win.currentScore} → potencial: ${win.potentialScore}): ${win.reason}`
      );
    }
    lines.push("");
  }

  // Hypotheses
  lines.push("## Hipóteses e Instruções Sugeridas");
  lines.push("");

  for (let i = 0; i < hypotheses.length; i++) {
    const h = hypotheses[i];
    const confidenceIcon = h.confidence === "high" ? "🟢" : h.confidence === "medium" ? "🟡" : "🔴";
    const riskIcon = h.risk === "safe" ? "✅" : h.risk === "moderate" ? "⚠️" : "🚫";

    lines.push(`### ${i + 1}. \`${h.pattern.violationType}\` — ${h.pattern.frequency}× ocorrências`);
    lines.push("");
    lines.push(`**Severidade:** ${h.pattern.severity} | **Confiança:** ${confidenceIcon} ${h.confidence} | **Risco:** ${riskIcon} ${h.risk}`);
    lines.push("");
    lines.push(`**Cenários afetados:** ${h.pattern.affectedScenarios.join(", ")}`);
    lines.push("");
    lines.push(`**Hipótese:**`);
    lines.push(`> ${h.hypothesis}`);
    lines.push("");

    if (h.pattern.sampleExcerpts.length > 0) {
      lines.push(`**Amostras do problema:**`);
      for (const excerpt of h.pattern.sampleExcerpts) {
        lines.push(`> _${excerpt}_`);
      }
      lines.push("");
    }

    lines.push(`**Instrução sugerida para \`additional_instructions\`:**`);
    lines.push("");
    lines.push("```");
    lines.push(h.suggestedInstruction);
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Failed scenarios summary
  if (failedScenarios.length > 0) {
    lines.push("## Cenários com Falha");
    lines.push("");
    lines.push("| Cenário | Score | Violações críticas | Tipos |");
    lines.push("|---------|-------|--------------------|-------|");
    for (const s of failedScenarios) {
      lines.push(
        `| ${s.scenarioId} | ${s.score} | ${s.criticalViolations} | ${s.topViolationTypes.map((t) => `\`${t}\``).join(", ")} |`
      );
    }
    lines.push("");
  }

  // Next steps
  lines.push("## Próximos Passos");
  lines.push("");
  lines.push(
    "1. Revise as instruções sugeridas acima e adapte ao tom e estilo da sua barbearia"
  );
  lines.push(
    "2. Aplique as instruções em `barbershop_ai_settings.additional_instructions` em ambiente de staging"
  );
  lines.push(
    "3. Re-execute o benchmark: `npm run benchmark:run -- --live`"
  );
  lines.push("4. Compare com o baseline: `npm run benchmark:compare`");
  lines.push("5. Se o gate passar, promova: `npm run benchmark:promote`");
  lines.push(
    "6. Mantenha o histórico de tentativas nesta pasta para rastreabilidade"
  );
  lines.push("");
  lines.push("---");
  lines.push(`*Gerado automaticamente pelo sistema de refinamento — não aplicar sem revisão humana*`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateRefinementReport(
  run: BenchmarkRun,
  suggestionsDir?: string,
  topN = DEFAULT_CONFIG.topPatternsCount
): Promise<RefinementReport> {
  const dir = suggestionsDir ?? DEFAULT_CONFIG.suggestionsDir;
  await fs.mkdir(dir, { recursive: true });

  const patterns = analyzeFailurePatterns(run, topN);
  const hypotheses = generateHypotheses(patterns);
  const quickWins = identifyQuickWins(run, run.summary.passThreshold);
  const failedScenarios = listFailedScenarios(run, run.summary.passThreshold);

  const dateStr = new Date().toISOString().split("T")[0];
  const filename = `${dateStr}-${run.meta.runId.slice(0, 8)}.md`;
  const suggestionsFile = path.join(dir, filename);

  const md = generateSuggestionsMarkdown(run, patterns, hypotheses, quickWins, failedScenarios);
  await fs.writeFile(suggestionsFile, md, "utf-8");

  return {
    runId: run.meta.runId,
    generatedAt: new Date().toISOString(),
    topPatterns: patterns,
    hypotheses,
    suggestionsFile,
  };
}
