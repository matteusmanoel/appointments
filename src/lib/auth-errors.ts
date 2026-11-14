import { ApiError } from "./api";

export const LOGIN_CONNECTION_MESSAGE = "Não conseguimos conectar agora. Tente de novo em instantes.";
export const LOGIN_CREDENTIALS_MESSAGE = "E-mail ou senha incorretos. Verifique e tente novamente.";
export const LOGIN_RATE_LIMIT_MESSAGE = "Muitas tentativas de entrada. Aguarde alguns minutos e tente de novo.";

/**
 * Mensagem de login para o dono (nunca detalhes técnicos):
 *  - 401 (e demais 4xx) → credenciais incorretas;
 *  - 429 → muitas tentativas;
 *  - rede, timeout, 5xx ou qualquer erro sem status → falha de conexão.
 */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return LOGIN_RATE_LIMIT_MESSAGE;
    if (err.status >= 500) return LOGIN_CONNECTION_MESSAGE;
    return LOGIN_CREDENTIALS_MESSAGE;
  }
  return LOGIN_CONNECTION_MESSAGE;
}
