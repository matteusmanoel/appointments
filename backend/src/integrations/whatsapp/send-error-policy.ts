/**
 * Classifica falhas de envio do provider WhatsApp (Evolution/Uazapi) para decidir
 * se o job deve ser re-tentado. Re-tentar um erro 4xx apenas re-executa o agente
 * (custo OpenAI) e muta estado sem nunca entregar a mensagem.
 */
export type SendErrorClass = "not_on_whatsapp" | "rejected" | "transient";

const RETRYABLE_4XX = new Set([408, 425, 429]);

export function providerHttpStatus(message: string): number | null {
  const m = (message ?? "").match(/\bfailed(?:\s*\([^)]*\))?:\s*(\d{3})\b/i);
  if (!m) return null;
  const status = parseInt(m[1] ?? "", 10);
  return Number.isFinite(status) ? status : null;
}

export function classifySendError(message: string): SendErrorClass {
  const m = (message ?? "").toLowerCase();
  if (
    m.includes("not on whatsapp") ||
    /"?exists"?\s*:\s*false/.test(m)
  ) {
    return "not_on_whatsapp";
  }
  const status = providerHttpStatus(message);
  if (status != null && status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) {
    return "rejected";
  }
  return "transient";
}

export function isNonRetryableSendError(message: string): boolean {
  return classifySendError(message) !== "transient";
}
