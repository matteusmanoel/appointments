/**
 * Motor do simulador CLI: conversa com runAgent no Postgres local,
 * sem WhatsApp, sem ngrok e sem jobs de envio.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type OpenAI from "openai";
import { pool } from "../../db.js";
import { assertLocalDatabaseUrl } from "../../db/local-database-url.js";
import { runAgent } from "../agent.js";
import { loadBookingDraft } from "../booking-draft.js";
import { isValidUuid } from "../../lib/uuid.js";
import { maskPhone } from "../turn-trace.js";
import { useNoopWhatsAppOutbound } from "../../integrations/whatsapp/noop-outbound.js";
import { parseSimulatedNow } from "./clock.js";
import { parseReplayFile, type ReplayScript, type ReplayTurn } from "./replay-file.js";
import { NO_DUE_REMINDER_NOTICE, runSimulatorReminders } from "./reminders.js";
import { stubOpenAI, loadLiveOpenAI } from "./openai-stub.js";
import type { SlotInterpreter } from "../agent/slot-interpreter.js";
import type { LanguageRewriter } from "../agent/language-rewrite.js";
import {
  formatSimulatorTurn,
  isSimulatorTraceEnabled,
  saveSimulatorTurnTrace,
  setSimulatorTraceEnabled,
  type SimulatorTurnTrace,
} from "./trace.js";
import { SIMULATOR_CHANNEL, simulatorClientPhone, simulatorThreadId } from "./namespace.js";

export type SimulatorOptions = {
  tenant: string;
  phone?: string;
  now?: string;
  replayPath?: string;
  turns?: ReplayTurn[];
  interactive?: boolean;
  llm?: "none" | "openai";
  openai?: OpenAI;
  /** Só grava trace no Postgres quando true (--trace). Default: desligado. */
  trace?: boolean;
  persistAssistantMessages?: boolean;
  print?: (line: string) => void;
  /** Roda o job de lembrete 24h no relógio simulado, via provider noop. */
  runReminders?: boolean;
  /** Testes: intérprete fake determinístico (--llm none). */
  slotInterpreter?: SlotInterpreter;
  slotInterpret?: boolean;
  languageRewrite?: boolean;
  languageRewriter?: LanguageRewriter;
  /** Sobrescreve o modelo (simulate:compare). */
  model?: string;
};

export type SimulatorTurnResult = {
  trace: SimulatorTurnTrace;
  printed: string;
  reply: string;
  agentResult?: import("../agent.js").AgentResult;
};

export type SimulatorRunResult = {
  barbershopId: string;
  conversationId: string;
  phone: string;
  phoneMasked: string;
  simulatedNow: string | null;
  turns: SimulatorTurnResult[];
};

const DEFAULT_PHONE = "5500000000001";

export async function resolveTenant(tenant: string): Promise<{ id: string; name: string; slug: string | null }> {
  const key = tenant.trim();
  if (!key) throw new Error("Informe --tenant com o slug ou o id da barbearia.");
  if (isValidUuid(key)) {
    const byId = await pool.query<{ id: string; name: string; slug: string | null }>(
      `SELECT id, name, slug FROM public.barbershops WHERE id = $1`,
      [key],
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const bySlug = await pool.query<{ id: string; name: string; slug: string | null }>(
    `SELECT id, name, slug FROM public.barbershops WHERE slug = $1`,
    [key],
  );
  if (bySlug.rows[0]) return bySlug.rows[0];
  throw new Error(`Barbearia não encontrada: ${key}`);
}

export async function ensureSimulatorConversation(
  barbershopId: string,
  phone: string,
): Promise<string> {
  const digits = phone.replace(/\D/g, "");
  const threadId = simulatorThreadId(digits);
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM public.ai_conversations
     WHERE barbershop_id = $1 AND channel = $2 AND external_thread_id = $3
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [barbershopId, SIMULATOR_CHANNEL, threadId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, is_sandbox, updated_at)
     VALUES ($1, $2, $3, true, now())
     RETURNING id`,
    [barbershopId, SIMULATOR_CHANNEL, threadId],
  );
  return created.rows[0]!.id;
}

async function insertMessage(conversationId: string, role: "user" | "assistant", content: string) {
  await pool.query(
    `INSERT INTO public.ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
    [conversationId, role, content],
  );
}

async function nextTurnIndex(conversationId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.ai_messages WHERE conversation_id = $1 AND role = 'user'`,
    [conversationId],
  );
  return Number(r.rows[0]?.n ?? "0");
}

export async function runSimulatorTurn(params: {
  barbershopId: string;
  conversationId: string;
  phone: string;
  userText: string;
  now?: string;
  openai: OpenAI;
  persistAssistantMessages?: boolean;
  slotInterpreter?: SlotInterpreter;
  slotInterpret?: boolean;
  languageRewrite?: boolean;
  languageRewriter?: LanguageRewriter;
  model?: string;
}): Promise<SimulatorTurnTrace & { agentResult: import("../agent.js").AgentResult }> {
  const started = Date.now();
  await insertMessage(params.conversationId, "user", params.userText);
  const turnIndex = await nextTurnIndex(params.conversationId);
  const result = await runAgent(params.barbershopId, params.conversationId, params.phone, params.openai, {
    persistAssistantMessages: params.persistAssistantMessages !== false,
    simulatedNow: params.now,
    captureSimulatorTrace: true,
    slotInterpreter: params.slotInterpreter,
    slotInterpret: params.slotInterpret,
    languageRewrite: params.languageRewrite,
    languageRewriter: params.languageRewriter,
    model: params.model,
  });
  const captured = result.simulatorTrace;
  const draft = await loadBookingDraft(params.conversationId);
  const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const trace: SimulatorTurnTrace = {
    barbershopId: params.barbershopId,
    conversationId: params.conversationId,
    turnIndex: captured?.turnIndex ?? turnIndex,
    simulatedNow: params.now ?? null,
    userMessage: params.userText,
    intent: captured?.intent ?? result.turnTrace?.intent ?? result.turnTrace?.routing ?? null,
    draft: captured?.draft ?? draft,
    tools: captured?.tools ?? (result.turnTrace?.toolsExecuted ?? []).map((t) => ({ name: t.name, ok: t.ok })),
    finalReply: result.reply,
    aiExposure: captured?.aiExposure ?? null,
    latencyMs: captured?.latencyMs ?? Date.now() - started,
    promptTokens: captured?.promptTokens ?? usage.prompt_tokens ?? 0,
    completionTokens: captured?.completionTokens ?? usage.completion_tokens ?? 0,
    totalTokens: captured?.totalTokens ?? usage.total_tokens ?? 0,
  };
  await saveSimulatorTurnTrace(trace);
  return Object.assign(trace, { agentResult: result });
}

export async function runSimulator(options: SimulatorOptions): Promise<SimulatorRunResult> {
  assertLocalDatabaseUrl();
  useNoopWhatsAppOutbound();
  if (options.trace === true) setSimulatorTraceEnabled(true);
  else setSimulatorTraceEnabled(false);

  const print = options.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  let script: ReplayScript | undefined;
  if (options.replayPath) script = parseReplayFile(options.replayPath);
  const shop = await resolveTenant(options.tenant ?? script?.tenant ?? "");
  const phone = (options.phone ?? script?.phone ?? DEFAULT_PHONE).replace(/\D/g, "") || DEFAULT_PHONE;
  const nowRaw = options.now ?? script?.now;
  if (nowRaw && !parseSimulatedNow(nowRaw)) {
    throw new Error(`--now inválido (${nowRaw}). Use ISO, ex. 2026-11-14T18:08:00-03:00.`);
  }
  const conversationId = await ensureSimulatorConversation(shop.id, phone);
  const sandboxPhone = simulatorClientPhone(shop.id, phone);
  const openai =
    options.openai ??
    (options.llm === "openai" ? await loadLiveOpenAI() : stubOpenAI());
  const phoneMasked = maskPhone(phone);

  print(`Simulador NavalhIA · ${shop.name}${shop.slug ? ` (${shop.slug})` : ""}`);
  print(`conversa ${conversationId} · telefone ${phoneMasked} · WhatsApp: noop (nada é enviado)`);
  print(`trace Postgres: ${isSimulatorTraceEnabled() ? "ligado" : "desligado"}`);
  if (nowRaw) print(`relógio simulado: ${nowRaw}`);
  print("");

  const results: SimulatorTurnResult[] = [];

  const play = async (text: string) => {
    const trace = await runSimulatorTurn({
      barbershopId: shop.id,
      conversationId,
      phone: sandboxPhone,
      userText: text,
      now: nowRaw,
      openai,
      persistAssistantMessages: options.persistAssistantMessages,
      slotInterpreter: options.slotInterpreter,
      slotInterpret: options.slotInterpret ?? options.llm === "openai",
      languageRewrite: options.languageRewrite,
      languageRewriter: options.languageRewriter,
      model: options.model,
    });
    const printed = formatSimulatorTurn(trace, phoneMasked);
    print(printed);
    print("");
    results.push({ trace, printed, reply: trace.finalReply, agentResult: trace.agentResult });
  };

  const playReminders = async () => {
    const sent = await runSimulatorReminders({
      barbershopId: shop.id,
      conversationId,
      phone: sandboxPhone,
      now: nowRaw,
    });
    const body = sent.length ? sent.map((s) => s.body).join("\n\n") : NO_DUE_REMINDER_NOTICE;
    print(`── lembrete (noop, ${sent.length}):`);
    print(body);
    print("");
    results.push({
      trace: {
        barbershopId: shop.id,
        conversationId,
        turnIndex: results.length,
        simulatedNow: nowRaw ?? null,
        userMessage: "[event:reminders]",
        intent: { event: "reminders" },
        draft: null,
        tools: [],
        finalReply: body,
        aiExposure: null,
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      printed: body,
      reply: body,
    });
  };

  const seeded = options.turns ?? script?.turns ?? [];
  const hasReminderEvent = seeded.some((turn) => turn.role === "system" && turn.event === "reminders");
  if (options.runReminders && !hasReminderEvent) {
    await playReminders();
  }
  for (const turn of seeded) {
    if (turn.role === "system") {
      await playReminders();
      continue;
    }
    if (turn.role === "assistant") {
      await insertMessage(conversationId, "assistant", turn.text);
      print(`── (histórico) assistente: ${turn.text}`);
      print("");
      continue;
    }
    await play(turn.text);
  }

  if (options.interactive) {
    const rl = createInterface({ input, output });
    print("Modo interativo. Digite a mensagem do cliente (vazio ou /sair para encerrar).");
    try {
      for (;;) {
        const line = (await rl.question("> ")).trim();
        if (!line || line === "/sair" || line === "/exit") break;
        await play(line);
      }
    } finally {
      rl.close();
    }
  }

  if (!seeded.length && !options.interactive && !options.runReminders) {
    throw new Error("Informe --replay <arquivo>, --interactive ou --run-reminders.");
  }

  return {
    barbershopId: shop.id,
    conversationId,
    phone,
    phoneMasked,
    simulatedNow: nowRaw ?? null,
    turns: results,
  };
}
