/**
 * Compara os roteiros de replay e os goldens com --llm none e --llm openai.
 * Não lê .env: OPENAI_API_KEY precisa estar no ambiente do processo.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import { pool } from "../../db.js";
import { assertLocalDatabaseUrl } from "../../db/local-database-url.js";
import { BASIC_FLOW_SAFE_FALLBACK } from "../agent/slot-filling.js";
import { SAFE_CLIENT_FALLBACK } from "../agent.js";
import { loadBookingDraft } from "../booking-draft.js";
import { loadPendingIntents } from "../agent/pending-intents.js";
import {
  checkContracts,
  createGoldenFixture,
  deleteGoldenFixture,
  type GoldenFixture,
  type TurnOutcome,
} from "../../__tests__/golden/runner.js";
import { SCENARIOS } from "../../__tests__/golden/scenarios.js";
import { ensureSimulatorConversation, runSimulator, type SimulatorRunResult } from "./session.js";
import { simulatorClientPhone } from "./namespace.js";
import { loadLiveOpenAI } from "./openai-stub.js";
import { wallClockFrom } from "./clock.js";
import {
  DEFAULT_COMPARE_MODEL,
  DEFAULT_MAX_RUNS,
  DEFAULT_MAX_TOKENS,
  assertMiniModel,
  estimateCostUsd,
  formatUsd,
  priceForModel,
} from "./compare-pricing.js";

export const DEFAULT_EXAMPLE_FILES = [
  "cliente-decidido.yaml",
  "cliente-indeciso.yaml",
  "fora-do-horario.yaml",
  "voce-e-robo.yaml",
  "lembrete-confirmo.yaml",
] as const;

export type CompareMode = "none" | "openai";

export type CompareRow = {
  id: string;
  kind: "example" | "golden";
  run: number;
  mode: CompareMode;
  finalReply: string;
  contracts: "passou" | "falhou" | "—";
  contractFailures: string[];
  speechDiff: string;
  aiExposure: boolean;
  fallback: boolean;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export type CompareReport = {
  model: string;
  maxRuns: number;
  maxTokens: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  aborted?: string;
  rows: CompareRow[];
  generatedAt: string;
};

export type RunCompareOptions = {
  tenant?: string;
  examplesDir?: string;
  examples?: boolean | string[];
  goldens?: boolean | string[];
  only?: string;
  maxRuns?: number;
  maxTokens?: number;
  model?: string;
  outPath?: string;
  /** Cliente injetado nos testes. Sem isso, o modo openai exige OPENAI_API_KEY no ambiente. */
  openai?: OpenAI;
  requireApiKey?: boolean;
  print?: (line: string) => void;
};

const EXAMPLES_DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/examples");

export class TokenBudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenBudgetExceeded";
  }
}

function looksLikeFallback(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t === SAFE_CLIENT_FALLBACK.trim() || t === BASIC_FLOW_SAFE_FALLBACK.trim()) return true;
  if (/não consegui (entender|processar)|pode repetir/i.test(t) && t.length < 280) return true;
  return false;
}

function finalizeReply(result: SimulatorRunResult): string {
  const last = [...result.turns].reverse().find((t) => t.trace.userMessage !== "[event:reminders]") ?? result.turns.at(-1);
  return last?.reply ?? "";
}

function sumTokens(result: SimulatorRunResult): { prompt: number; completion: number; latency: number; exposure: boolean; fallback: boolean } {
  let prompt = 0;
  let completion = 0;
  let latency = 0;
  let exposure = false;
  let fallback = false;
  for (const turn of result.turns) {
    prompt += turn.trace.promptTokens ?? 0;
    completion += turn.trace.completionTokens ?? 0;
    latency += turn.trace.latencyMs ?? 0;
    if (turn.trace.aiExposure?.changed) exposure = true;
    if (looksLikeFallback(turn.reply)) fallback = true;
  }
  return { prompt, completion, latency, exposure, fallback };
}

function speechDiff(noneReply: string, openaiReply: string): string {
  const a = noneReply.trim();
  const b = openaiReply.trim();
  if (a === b) return "iguais";
  if (!a) return "só o modo openai falou";
  if (!b) return "só o modo none falou";
  return "diferentes";
}

async function todayAndTomorrow(): Promise<{ todayIso: string; tomorrowIso: string }> {
  const r = await pool.query<{ today: string; t: string }>(
    `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
            ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS t`,
  );
  if (r.rows[0]) return { todayIso: r.rows[0].today, tomorrowIso: r.rows[0].t };
  const wall = wallClockFrom(new Date());
  return { todayIso: wall.todayStr, tomorrowIso: wall.todayStr };
}

async function seedNamedClient(barbershopId: string, displayPhone: string, name = "Mateus") {
  const sandboxPhone = simulatorClientPhone(barbershopId, displayPhone);
  await ensureSimulatorConversation(barbershopId, displayPhone);
  await pool.query(
    `INSERT INTO public.clients (barbershop_id, name, phone, name_confirmed) VALUES ($1, $2, $3, true)
     ON CONFLICT (barbershop_id, phone) DO UPDATE SET name = $2, name_confirmed = true`,
    [barbershopId, name, sandboxPhone],
  );
  return sandboxPhone;
}

async function seedUpcomingForReminder(barbershopId: string, displayPhone: string, tomorrowIso: string) {
  const sandboxPhone = await seedNamedClient(barbershopId, displayPhone);
  const shop = await pool.query<{ service_id: string; barber_id: string }>(
    `SELECT
        (SELECT id FROM public.services WHERE barbershop_id = $1 AND is_active = true ORDER BY name LIMIT 1) AS service_id,
        (SELECT id FROM public.barbers WHERE barbershop_id = $1 AND status = 'active' ORDER BY name LIMIT 1) AS barber_id`,
    [barbershopId],
  );
  const serviceId = shop.rows[0]?.service_id;
  const barberId = shop.rows[0]?.barber_id;
  if (!serviceId || !barberId) {
    throw new Error("A barbearia do --tenant precisa de um serviço ativo e um barbeiro ativo para o roteiro de lembrete.");
  }
  const client = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients WHERE barbershop_id = $1 AND phone = $2`,
    [barbershopId, sandboxPhone],
  );
  const appt = await pool.query<{ id: string }>(
    `INSERT INTO public.appointments
       (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
     VALUES ($1, $2, $3, $4, $5::date, '18:00', 30, 40, 10, 'pending') RETURNING id`,
    [barbershopId, client.rows[0]!.id, barberId, serviceId, tomorrowIso],
  );
  await pool.query(
    `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
     VALUES ($1, $2, 40, 30, 'Corte', 0)
     ON CONFLICT DO NOTHING`,
    [appt.rows[0]!.id, serviceId],
  ).catch(() =>
    pool.query(
      `INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
       VALUES ($1, $2, 40, 30, 'Corte', 0)`,
      [appt.rows[0]!.id, serviceId],
    ),
  );
}

async function prepareExample(params: {
  tenant: string;
  file: string;
  run: number;
}): Promise<{ phone: string; now: string }> {
  const shop = await pool.query<{ id: string }>(
    `SELECT id FROM public.barbershops WHERE slug = $1 OR id::text = $1 LIMIT 1`,
    [params.tenant],
  );
  const barbershopId = shop.rows[0]?.id;
  if (!barbershopId) throw new Error(`Barbearia não encontrada: ${params.tenant}`);
  const dates = await todayAndTomorrow();
  const phone = `5500000004${String(params.run).padStart(2, "0")}${Math.floor(Math.random() * 900 + 100)}`;
  const name = params.file;
  if (name.includes("decidido") || name.includes("voce-e-robo") || name.includes("robo")) {
    await seedNamedClient(barbershopId, phone);
  }
  if (name.includes("lembrete")) {
    await seedUpcomingForReminder(barbershopId, phone, dates.tomorrowIso);
    return { phone, now: `${dates.todayIso}T18:00:00-03:00` };
  }
  if (name.includes("fora-do-horario") || name.includes("fora_do_horario")) {
    return { phone, now: `${dates.todayIso}T19:50:00-03:00` };
  }
  return { phone, now: `${dates.todayIso}T10:00:00-03:00` };
}

async function adaptGoldenForSimulator(fx: GoldenFixture): Promise<GoldenFixture> {
  const displayPhone = fx.clientPhone;
  const sandboxPhone = simulatorClientPhone(fx.barbershopId, displayPhone);
  const conversationId = await ensureSimulatorConversation(fx.barbershopId, displayPhone);
  if (fx.clientId) {
    await pool.query(`UPDATE public.clients SET phone = $1 WHERE id = $2 AND barbershop_id = $3`, [
      sandboxPhone,
      fx.clientId,
      fx.barbershopId,
    ]);
  }
  return { ...fx, conversationId, clientPhone: sandboxPhone };
}

async function outcomeFromSimulator(fx: GoldenFixture, result: SimulatorRunResult, turnIndex: number): Promise<TurnOutcome> {
  const turn = result.turns[turnIndex]!;
  const draft = await loadBookingDraft(result.conversationId);
  const pending = await loadPendingIntents(result.conversationId);
  const client = await pool.query<{ name: string | null; name_confirmed: boolean | null }>(
    `SELECT name, name_confirmed FROM public.clients WHERE barbershop_id = $1 AND phone = $2 LIMIT 1`,
    [fx.barbershopId, fx.clientPhone],
  );
  const row = client.rows[0];
  const appointments = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM public.appointments WHERE barbershop_id = $1`,
    [fx.barbershopId],
  );
  const activity = await pool.query<{ type: string }>(
    `SELECT type FROM public.agenda_activity WHERE conversation_id = $1`,
    [result.conversationId],
  );
  const agentResult = turn.agentResult ?? {
    reply: turn.reply,
    turnTrace: undefined,
    usage: {
      prompt_tokens: turn.trace.promptTokens,
      completion_tokens: turn.trace.completionTokens,
      total_tokens: turn.trace.totalTokens,
    },
  };
  return {
    result: agentResult,
    draft,
    pending,
    clientName: row && row.name_confirmed ? row.name : null,
    appointmentStatuses: new Map(appointments.rows.map((a) => [a.id, a.status])),
    activityTypes: activity.rows.map((a) => a.type),
  };
}

function cell(text: string, max = 180): string {
  const one = text.replace(/\r?\n/g, " ↵ ").replace(/\|/g, "\\|").trim();
  if (one.length <= max) return one || "—";
  return `${one.slice(0, max - 1)}…`;
}

export function formatCompareMarkdown(report: CompareReport): string {
  const price = priceForModel(report.model);
  const lines: string[] = [
    `# Comparação do simulador (none vs openai)`,
    "",
    `- Gerado em: ${report.generatedAt} (America/Sao_Paulo)`,
    `- Modelo: \`${report.model}\` (preço configurável em \`compare-pricing.ts\`: US$ ${price.input}/1M in, US$ ${price.output}/1M out)`,
    `- Rodadas por roteiro: ${report.maxRuns}`,
    `- Teto de tokens: ${report.maxTokens.toLocaleString("pt-BR")}`,
    `- Tokens acumulados: ${report.promptTokens} in / ${report.completionTokens} out`,
    `- Custo estimado: US$ ${formatUsd(report.costUsd)}`,
  ];
  if (report.aborted) lines.push(`- **Abortado:** ${report.aborted}`);
  lines.push(
    "",
    "| Roteiro | Tipo | Run | Modo | Resposta final | Contratos | Diff de fala | ai_exposure | fallback | Latência (ms) | Tokens in | Tokens out | Custo est. (USD) |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
  );
  for (const row of report.rows) {
    const contracts = row.contracts === "falhou" && row.contractFailures.length
      ? `falhou (${cell(row.contractFailures.join("; "), 80)})`
      : row.contracts;
    lines.push(
      `| ${row.id} | ${row.kind} | ${row.run} | ${row.mode} | ${cell(row.finalReply)} | ${contracts} | ${row.speechDiff} | ${row.aiExposure ? "sim" : "não"} | ${row.fallback ? "sim" : "não"} | ${row.latencyMs} | ${row.promptTokens} | ${row.completionTokens} | ${formatUsd(row.costUsd)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function listOrAll<T extends string>(value: boolean | T[] | undefined, all: readonly T[]): T[] {
  if (value === false) return [];
  if (Array.isArray(value)) return value;
  return [...all];
}

export async function runCompare(options: RunCompareOptions): Promise<CompareReport> {
  assertLocalDatabaseUrl();
  const print = options.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  const model = assertMiniModel(options.model ?? DEFAULT_COMPARE_MODEL);
  const maxRuns = Math.max(1, options.maxRuns ?? DEFAULT_MAX_RUNS);
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const requireKey = options.requireApiKey !== false;
  const examplesDir = options.examplesDir ?? EXAMPLES_DEFAULT_DIR;

  if (requireKey && !options.openai && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "OPENAI_API_KEY não está no ambiente. O simulate:compare não lê .env; exporte a chave no terminal (o valor não é impresso).",
    );
  }

  const exampleFiles = listOrAll(options.examples, DEFAULT_EXAMPLE_FILES).filter((name) =>
    options.only ? name.includes(options.only) : true,
  );
  const goldenIds = listOrAll(
    options.goldens,
    SCENARIOS.map((s) => s.id),
  ).filter((id) => (options.only ? id.includes(options.only) : true));

  if (exampleFiles.length && !options.tenant) {
    throw new Error("Informe --tenant (slug ou UUID) para rodar os roteiros de examples.");
  }

  let openai: OpenAI | undefined = options.openai;
  if (goldenIds.length || exampleFiles.length) {
    // loaded lazily on the openai pass
  }

  const rows: CompareRow[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let aborted: string | undefined;

  const addUsage = (p: number, c: number) => {
    promptTokens += p;
    completionTokens += c;
    if (promptTokens + completionTokens > maxTokens) {
      throw new TokenBudgetExceeded(
        `Teto de tokens excedido (${(promptTokens + completionTokens).toLocaleString("pt-BR")} > ${maxTokens.toLocaleString("pt-BR")}).`,
      );
    }
  };

  const prevInterp = process.env.AI_AGENT_SLOT_INTERPRET;
  const prevRewrite = process.env.AI_AGENT_LANGUAGE_REWRITE;

  const runOnce = async (args: {
    id: string;
    kind: "example" | "golden";
    run: number;
    mode: CompareMode;
    exec: (mode: CompareMode) => Promise<{ result: SimulatorRunResult; contractFailures: string[] }>;
  }) => {
    const { result, contractFailures } = await args.exec(args.mode);
    const tokens = sumTokens(result);
    addUsage(tokens.prompt, tokens.completion);
    const costUsd = estimateCostUsd({ model, promptTokens: tokens.prompt, completionTokens: tokens.completion });
    const row: CompareRow = {
      id: args.id,
      kind: args.kind,
      run: args.run,
      mode: args.mode,
      finalReply: finalizeReply(result),
      contracts: args.kind === "golden" ? (contractFailures.length ? "falhou" : "passou") : "—",
      contractFailures,
      speechDiff: "—",
      aiExposure: tokens.exposure,
      fallback: tokens.fallback,
      latencyMs: tokens.latency,
      promptTokens: tokens.prompt,
      completionTokens: tokens.completion,
      costUsd,
    };
    rows.push(row);
    return row;
  };

  try {
    for (const file of exampleFiles) {
      if (!options.tenant) break;
      for (let run = 1; run <= maxRuns; run++) {
        const prepared = await prepareExample({ tenant: options.tenant, file, run });
        const exec = async (mode: CompareMode) => {
          const result = await runSimulator({
            tenant: options.tenant!,
            phone: prepared.phone,
            now: prepared.now,
            replayPath: join(examplesDir, file),
            llm: mode,
            openai: mode === "openai" ? openai : undefined,
            slotInterpret: mode === "openai",
            languageRewrite: mode === "openai",
            model: mode === "openai" ? model : undefined,
            trace: false,
            print: () => {},
          });
          return { result, contractFailures: [] as string[] };
        };
        const noneRow = await runOnce({ id: file, kind: "example", run, mode: "none", exec });
        if (!openai) openai = options.openai ?? (await loadLiveOpenAI());
        process.env.AI_AGENT_SLOT_INTERPRET = "true";
        process.env.AI_AGENT_LANGUAGE_REWRITE = "true";
        try {
          const openRow = await runOnce({ id: file, kind: "example", run, mode: "openai", exec });
          const diff = speechDiff(noneRow.finalReply, openRow.finalReply);
          noneRow.speechDiff = diff;
          openRow.speechDiff = diff;
        } finally {
          if (prevInterp === undefined) delete process.env.AI_AGENT_SLOT_INTERPRET;
          else process.env.AI_AGENT_SLOT_INTERPRET = prevInterp;
          if (prevRewrite === undefined) delete process.env.AI_AGENT_LANGUAGE_REWRITE;
          else process.env.AI_AGENT_LANGUAGE_REWRITE = prevRewrite;
        }
      }
    }

    for (const scenario of SCENARIOS) {
      if (!goldenIds.includes(scenario.id)) continue;
      for (let run = 1; run <= maxRuns; run++) {
        const exec = async (mode: CompareMode) => {
          const raw = await createGoldenFixture(`${scenario.id}-${mode}-${run}`, scenario.client);
          let fx = await adaptGoldenForSimulator(raw);
          try {
            if (scenario.prepare) await scenario.prepare(fx);
            const contractFailures: string[] = [];
            let result: SimulatorRunResult | undefined;
            for (const [index, turn] of scenario.turns.entries()) {
              const step = await runSimulator({
                tenant: fx.barbershopId,
                phone: raw.clientPhone,
                turns: [{ role: "user", text: turn.user }],
                llm: mode,
                openai: mode === "openai" ? openai : undefined,
                slotInterpret: mode === "openai",
                languageRewrite: mode === "openai",
                model: mode === "openai" ? model : undefined,
                trace: false,
                print: () => {},
              });
              fx = { ...fx, conversationId: step.conversationId };
              if (!result) result = step;
              else result.turns.push(...step.turns);
              const outcome = await outcomeFromSimulator(fx, step, 0);
              contractFailures.push(
                ...checkContracts(outcome, turn.contracts(fx)).map((f) => `t${index + 1}: ${f}`),
              );
            }
            if (!result) throw new Error(`Golden ${scenario.id} sem turnos.`);
            return { result, contractFailures };
          } finally {
            await deleteGoldenFixture(raw);
          }
        };
        const noneRow = await runOnce({ id: scenario.id, kind: "golden", run, mode: "none", exec });
        if (!openai) openai = options.openai ?? (await loadLiveOpenAI());
        process.env.AI_AGENT_SLOT_INTERPRET = "true";
        process.env.AI_AGENT_LANGUAGE_REWRITE = "true";
        try {
          const openRow = await runOnce({ id: scenario.id, kind: "golden", run, mode: "openai", exec });
          const diff = speechDiff(noneRow.finalReply, openRow.finalReply);
          noneRow.speechDiff = diff;
          openRow.speechDiff = diff;
        } finally {
          if (prevInterp === undefined) delete process.env.AI_AGENT_SLOT_INTERPRET;
          else process.env.AI_AGENT_SLOT_INTERPRET = prevInterp;
          if (prevRewrite === undefined) delete process.env.AI_AGENT_LANGUAGE_REWRITE;
          else process.env.AI_AGENT_LANGUAGE_REWRITE = prevRewrite;
        }
      }
    }
  } catch (e) {
    if (e instanceof TokenBudgetExceeded) {
      aborted = e.message;
    } else {
      throw e;
    }
  } finally {
    if (prevInterp === undefined) delete process.env.AI_AGENT_SLOT_INTERPRET;
    else process.env.AI_AGENT_SLOT_INTERPRET = prevInterp;
    if (prevRewrite === undefined) delete process.env.AI_AGENT_LANGUAGE_REWRITE;
    else process.env.AI_AGENT_LANGUAGE_REWRITE = prevRewrite;
  }

  const report: CompareReport = {
    model,
    maxRuns,
    maxTokens,
    promptTokens,
    completionTokens,
    costUsd: estimateCostUsd({ model, promptTokens, completionTokens }),
    aborted,
    rows,
    generatedAt: new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date()).replace(" ", "T") + "-03:00",
  };

  const md = formatCompareMarkdown(report);
  print(md);
  if (options.outPath) {
    mkdirSync(dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, md, "utf8");
    print(`Relatório gravado em ${options.outPath}`);
  }
  return report;
}
