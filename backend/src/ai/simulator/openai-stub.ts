import type OpenAI from "openai";

/**
 * OpenAI de mentira: o fluxo determinístico não chama o modelo.
 * Se um turno cair no loop de tools, falha de forma explícita — sem custo de API.
 */
export function stubOpenAI(message = "simulador: este turno caiu no LLM; use --llm openai só se quiser chamar o modelo"): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error(message);
        },
      },
    },
  } as unknown as OpenAI;
}

export async function loadLiveOpenAI(): Promise<OpenAI> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY não definida. O modo --llm openai precisa dela; o valor não é impresso.");
  }
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey: key });
}
