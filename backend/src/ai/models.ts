import type OpenAI from "openai";

/** Modelo padrão de conversa, interpretação e leitura de comprovante. */
export const DEFAULT_CHAT_MODEL = "gpt-6-luna";

export const TRANSCRIPTION_MODEL = "gpt-transcribe";
/** A OpenAI não confirma Opus em .ogg no gpt-transcribe. O whisper-1 cobre esse caso até sair, em 26/02/2027. */
export const TRANSCRIPTION_FALLBACK_MODEL = "whisper-1";

/** Modelos encerrados ou com data de saída: configurações antigas continuam atendendo. */
const RETIRED_CHAT_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "gpt-4-turbo",
  "gpt-4-turbo-2024-04-09",
]);

export function resolveChatModel(model?: string | null): string {
  const name = (model ?? "").trim();
  if (!name || RETIRED_CHAT_MODELS.has(name)) return DEFAULT_CHAT_MODEL;
  return name;
}

type ChatBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatOptions = Parameters<OpenAI["chat"]["completions"]["create"]>[1];

/** A documentação do gpt-6-luna não diz se aceita temperature: a primeira recusa vale para o processo. */
const modelsRejectingTemperature = new Set<string>();

function rejectedTemperature(error: unknown): boolean {
  const e = error as { status?: unknown; param?: unknown; message?: unknown } | null;
  if (e?.status !== 400) return false;
  return e.param === "temperature" || /temperature/i.test(String(e.message ?? ""));
}

/**
 * Chamada única de Chat Completions. No gpt-6-luna, ferramentas nessa API exigem reasoning_effort "none".
 */
export async function createChatCompletion(
  openai: OpenAI,
  body: ChatBody,
  options?: ChatOptions,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const model = resolveChatModel(body.model);
  const request: ChatBody = {
    ...body,
    model,
    ...(model.startsWith("gpt-6-luna") ? { reasoning_effort: "none" as const } : {}),
  };
  if (modelsRejectingTemperature.has(model)) delete request.temperature;
  try {
    return await openai.chat.completions.create(request, options);
  } catch (error) {
    if (request.temperature === undefined || !rejectedTemperature(error)) throw error;
    modelsRejectingTemperature.add(model);
    const { temperature: _temperature, ...withoutTemperature } = request;
    return openai.chat.completions.create(withoutTemperature, options);
  }
}

/** Só para testes. */
export function resetChatModelMemoryForTests(): void {
  modelsRejectingTemperature.clear();
}
