/**
 * Pepper do lookup de API keys (HMAC-SHA256). Segredo de servidor: nunca gravar no banco,
 * em log ou em relatório. Módulo sem dependências para poder ser importado por config.ts.
 */
export const API_KEY_LOOKUP_PEPPER_ENV = "API_KEY_LOOKUP_PEPPER";
export const API_KEY_LOOKUP_PEPPER_MIN_LENGTH = 32;

/** Valor fixo e público: só vale quando o processo é de teste (vitest / NODE_ENV=test). */
const TEST_ONLY_PEPPER = "test-only-api-key-lookup-pepper-not-a-secret-0000";

export class ApiKeyPepperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyPepperError";
  }
}

function isTestProcess(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * Devolve o pepper. Falha fechado: sem pepper (ou curto demais) em produção lança erro claro.
 * Fora de produção e fora de teste também exige a variável, para o ambiente local não gerar
 * hashes com um valor conhecido sem perceber.
 */
export function getApiKeyLookupPepper(): string {
  const raw = process.env[API_KEY_LOOKUP_PEPPER_ENV] ?? "";
  if (raw === "") {
    if (process.env.NODE_ENV !== "production" && isTestProcess()) return TEST_ONLY_PEPPER;
    throw new ApiKeyPepperError(
      `Missing env: ${API_KEY_LOOKUP_PEPPER_ENV} (segredo de pelo menos ${API_KEY_LOOKUP_PEPPER_MIN_LENGTH} caracteres, ex.: openssl rand -hex 32). A autenticação de API keys fica desligada sem ele.`,
    );
  }
  if (raw.length < API_KEY_LOOKUP_PEPPER_MIN_LENGTH) {
    throw new ApiKeyPepperError(
      `${API_KEY_LOOKUP_PEPPER_ENV} deve ter pelo menos ${API_KEY_LOOKUP_PEPPER_MIN_LENGTH} caracteres.`,
    );
  }
  return raw;
}

/** Chamado no boot (config.ts): em produção, a falta do pepper derruba o processo na partida. */
export function assertApiKeyLookupPepperConfigured(): void {
  if (process.env.NODE_ENV === "production") getApiKeyLookupPepper();
}
