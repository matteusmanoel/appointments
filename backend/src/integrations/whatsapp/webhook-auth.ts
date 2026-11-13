import crypto from "node:crypto";
import type { Request } from "express";

/** Comparação em tempo constante (strings de tamanhos diferentes → false sem vazar o tamanho). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

type Env = Record<string, string | undefined>;

/**
 * Segredo ATUAL dos webhooks de WhatsApp (Uazapi/Evolution) = WHATSAPP_WEBHOOK_SECRET, e só ele.
 * Não há mais fallback para EVOLUTION_API_KEY: a chave mestra da Evolution não pode virar segredo de webhook
 * (ela iria na URL/cabeçalho que a própria Evolution registra e loga). `provider` é mantido por compatibilidade.
 */
export function getWebhookSecret(_provider: "uazapi" | "evolution", env: Env = process.env): string {
  return (env.WHATSAPP_WEBHOOK_SECRET ?? "").trim();
}

/**
 * Segredos aceitos no recebimento: o atual e, durante uma rotação, o anterior (WHATSAPP_WEBHOOK_SECRET_PREVIOUS).
 * Ordem de rotação: 1) pôr o novo em WHATSAPP_WEBHOOK_SECRET e o velho em _PREVIOUS e publicar; 2) reconfigurar as
 * instâncias com o novo (scripts/reconfigure-whatsapp-webhooks.ts); 3) remover _PREVIOUS. Sem atual → lista vazia
 * (fail closed; o anterior sozinho nunca basta).
 */
export function getAcceptedWebhookSecrets(env: Env = process.env): string[] {
  const current = (env.WHATSAPP_WEBHOOK_SECRET ?? "").trim();
  if (!current) return [];
  const previous = (env.WHATSAPP_WEBHOOK_SECRET_PREVIOUS ?? "").trim();
  return previous && previous !== current ? [current, previous] : [current];
}

/** App Secrets aceitos da Meta (atual + anterior durante rotação). */
export function getAcceptedMetaAppSecrets(env: Env = process.env): string[] {
  const current = (env.WHATSAPP_APP_SECRET ?? "").trim();
  if (!current) return [];
  const previous = (env.WHATSAPP_APP_SECRET_PREVIOUS ?? "").trim();
  return previous && previous !== current ? [current, previous] : [current];
}

/** Acrescenta ?token=<segredo> à URL do webhook (provedores que não enviam cabeçalho customizado). */
export function withWebhookToken(url: string, secret: string): string {
  if (!secret) return url;
  const u = new URL(url);
  u.searchParams.set("token", secret);
  return u.toString();
}

/**
 * Máscara segura para logs/saída de script: nunca ecoa caracteres do segredo.
 * Mostra só o tamanho e os 6 primeiros hex do SHA-256 (ou o nome, se o chamador prefixar).
 */
export function maskWebhookSecret(secret: string): string {
  if (!secret) return "(vazio)";
  const digest = crypto.createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 6);
  return `sha256:${digest}… (${secret.length} chars)`;
}

function collectedSecrets(env: Env): string[] {
  const values = [
    ...(env.WHATSAPP_WEBHOOK_SECRET ?? "").trim() ? [(env.WHATSAPP_WEBHOOK_SECRET ?? "").trim()] : [],
    ...(env.WHATSAPP_WEBHOOK_SECRET_PREVIOUS ?? "").trim() ? [(env.WHATSAPP_WEBHOOK_SECRET_PREVIOUS ?? "").trim()] : [],
    ...(env.WHATSAPP_APP_SECRET ?? "").trim() ? [(env.WHATSAPP_APP_SECRET ?? "").trim()] : [],
    ...(env.WHATSAPP_APP_SECRET_PREVIOUS ?? "").trim() ? [(env.WHATSAPP_APP_SECRET_PREVIOUS ?? "").trim()] : [],
    ...getAcceptedWebhookSecrets(env),
    ...getAcceptedMetaAppSecrets(env),
  ];
  return [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
}

/**
 * Remove `token=…` (query ou percent-encoded) e qualquer valor conhecido de segredo
 * antes de log, resposta HTTP, last_error ou saída de script.
 */
export function redactWebhookSecrets(text: string, env: Env = process.env): string {
  let out = text
    .replace(/([?&]token=)[^&\s"'`]*/gi, "$1[redacted]")
    .replace(/([?&]token%3D)[^&\s"'`]*/gi, "$1[redacted]");
  for (const secret of collectedSecrets(env)) {
    out = out.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join("[redacted]");
  }
  return out;
}

/** Mensagem de erro segura para log, resposta e last_error. */
export function webhookErrorText(err: unknown, env: Env = process.env): string {
  return redactWebhookSecrets(err instanceof Error ? err.message : String(err), env);
}

export type WebhookAuthResult = "ok" | "unconfigured" | "unauthorized";

/**
 * Fail closed: sem segredo configurado → "unconfigured" (503); cabeçalho/token ausente ou errado → "unauthorized" (401).
 * Aceita cabeçalho `apikey` / `x-api-key` / `x-webhook-secret` ou query `?token=`.
 */
export function checkWebhookSecret(req: Pick<Request, "headers" | "query">, secretOrSecrets: string | string[]): WebhookAuthResult {
  const secrets = (Array.isArray(secretOrSecrets) ? secretOrSecrets : [secretOrSecrets]).filter(Boolean);
  if (secrets.length === 0) return "unconfigured";
  const h = req.headers;
  const candidates = [h["apikey"], h["x-api-key"], h["x-webhook-secret"], req.query?.token]
    .map((v) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : ""))
    .filter(Boolean);
  return candidates.some((c) => secrets.some((s) => safeEqual(c, s))) ? "ok" : "unauthorized";
}

/** Valida X-Hub-Signature-256 (Meta) sobre o corpo cru. Sem app secret → false (fail closed). */
export function verifyMetaSignature(
  rawBody: string | Buffer | undefined,
  signatureHeader: string | undefined,
  appSecretOrSecrets: string | string[]
): boolean {
  const secrets = (Array.isArray(appSecretOrSecrets) ? appSecretOrSecrets : [appSecretOrSecrets]).filter(Boolean);
  if (secrets.length === 0 || !rawBody || !signatureHeader) return false;
  return secrets.some((s) => safeEqual(signatureHeader.trim(), "sha256=" + crypto.createHmac("sha256", s).update(rawBody).digest("hex")));
}
