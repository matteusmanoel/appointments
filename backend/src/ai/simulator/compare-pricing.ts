/**
 * Tabela de preços do simulate:compare (USD por 1M de tokens).
 * Valores do gpt-4o-mini; atualize aqui se a tabela da OpenAI mudar.
 */
export const DEFAULT_COMPARE_MODEL = "gpt-4o-mini";

export const MINI_MODEL_PRICES_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6 },
};

export const DEFAULT_MAX_TOKENS = 300_000;
export const DEFAULT_MAX_RUNS = 1;

export function assertMiniModel(model: string): string {
  const name = model.trim();
  if (!name) throw new Error("Informe um modelo mini, ex. gpt-4o-mini.");
  if (!/mini/i.test(name)) {
    throw new Error(`--model só aceita modelos mini (recebido: ${name}).`);
  }
  return name;
}

export function priceForModel(model: string): { input: number; output: number } {
  const known = MINI_MODEL_PRICES_USD_PER_1M[model];
  if (known) return known;
  return MINI_MODEL_PRICES_USD_PER_1M[DEFAULT_COMPARE_MODEL]!;
}

export function estimateCostUsd(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const price = priceForModel(params.model);
  return (params.promptTokens * price.input + params.completionTokens * price.output) / 1_000_000;
}

export function formatUsd(value: number): string {
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(2);
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
