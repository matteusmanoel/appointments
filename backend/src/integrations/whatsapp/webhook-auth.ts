import crypto from "node:crypto";
import type { Request } from "express";

/** Comparação em tempo constante (strings de tamanhos diferentes → false sem vazar o tamanho). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Segredo dos webhooks de WhatsApp (Uazapi/Evolution).
 * WHATSAPP_WEBHOOK_SECRET tem prioridade; para a Evolution, EVOLUTION_API_KEY continua valendo como fallback.
 */
export function getWebhookSecret(provider: "uazapi" | "evolution", env: Record<string, string | undefined> = process.env): string {
  const generic = (env.WHATSAPP_WEBHOOK_SECRET ?? "").trim();
  if (generic) return generic;
  if (provider === "evolution") return (env.EVOLUTION_API_KEY ?? "").trim();
  return "";
}

/** Acrescenta ?token=<segredo> à URL do webhook (provedores que não enviam cabeçalho customizado). */
export function withWebhookToken(url: string, secret: string): string {
  if (!secret) return url;
  const u = new URL(url);
  u.searchParams.set("token", secret);
  return u.toString();
}

export type WebhookAuthResult = "ok" | "unconfigured" | "unauthorized";

/**
 * Fail closed: sem segredo configurado → "unconfigured" (503); cabeçalho/token ausente ou errado → "unauthorized" (401).
 * Aceita cabeçalho `apikey` / `x-api-key` / `x-webhook-secret` ou query `?token=`.
 */
export function checkWebhookSecret(req: Pick<Request, "headers" | "query">, secret: string): WebhookAuthResult {
  if (!secret) return "unconfigured";
  const h = req.headers;
  const candidates = [h["apikey"], h["x-api-key"], h["x-webhook-secret"], req.query?.token]
    .map((v) => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : ""))
    .filter(Boolean);
  return candidates.some((c) => safeEqual(c, secret)) ? "ok" : "unauthorized";
}

/** Valida X-Hub-Signature-256 (Meta) sobre o corpo cru. Sem app secret → false (fail closed). */
export function verifyMetaSignature(rawBody: string | Buffer | undefined, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!appSecret || !rawBody || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(signatureHeader.trim(), expected);
}
