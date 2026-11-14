/**
 * Sanitiza parâmetros de atribuição (UTM / click ids) antes de gravar no
 * metadata da sessão Stripe. Só passa chaves da lista; valores são sem caracteres de controle,
 * truncados (utm_* 100, click ids 200) e limitados a um charset seguro.
 * A atribuição só entra com `marketing_consent: true` no pedido (ver `checkoutAttribution`).
 */

export const STRIPE_METADATA_VALUE_MAX = 500;
export const UTM_VALUE_MAX = 100;
export const CLICK_ID_VALUE_MAX = 200;
export const STRIPE_METADATA_KEY_MAX = 40;
export const STRIPE_METADATA_KEYS_MAX = 50;

export const ATTRIBUTION_METADATA_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "ttclid",
  "gclid",
  "first_utm_source",
  "first_utm_medium",
  "first_utm_campaign",
  "first_utm_term",
  "first_utm_content",
  "first_fbclid",
  "first_ttclid",
  "first_gclid",
] as const;

export type AttributionMetadataKey = (typeof ATTRIBUTION_METADATA_KEYS)[number];

const ALLOWED = new Set<string>(ATTRIBUTION_METADATA_KEYS);

/** Chaves já usadas no metadata da sessão de checkout — nunca podem ser sobrescritas pelo cliente. */
export const RESERVED_CHECKOUT_METADATA_KEYS = new Set([
  "barbershop_name",
  "barbershopName",
  "cnpj",
  "phone",
  "contact_name",
  "plan",
  "extra_numbers",
  "whatsapp_numbers_total",
  "whatsapp_risk_accepted_at",
  "whatsapp_risk_notice_version",
  "barbershop_id",
  "credit_type",
  "quantity",
  "marketing_consent",
  "marketing_consent_notice_version",
  "marketing_consent_at",
]);

const SAFE_ATTRIBUTION_VALUE = /^[A-Za-z0-9 _.~:+|-]+$/;

function isClickIdKey(key: string): boolean {
  return /clid$/.test(key.replace(/^first_/, ""));
}

/**
 * Valor de atribuição seguro: sem caracteres de controle, truncado (utm_* 100, click ids 200) e só
 * com letras, números, espaço e `_ . ~ : + | -`. Qualquer outro caractere (por exemplo `@` de um e-mail)
 * descarta o valor. utm_* que parece telefone (só dígitos, 8 ou mais) também é descartado.
 */
export function sanitizeAttributionValue(value: unknown, key = "utm_source"): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const clickId = isClickIdKey(key);
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, clickId ? CLICK_ID_VALUE_MAX : UTM_VALUE_MAX)
    .trim();
  if (!cleaned) return undefined;
  if (!SAFE_ATTRIBUTION_VALUE.test(cleaned)) return undefined;
  if (!clickId && /^\d{8,}$/.test(cleaned.replace(/[ .+-]/g, ""))) return undefined;
  return cleaned;
}

/**
 * Filtra um objeto solto (body.attribution) e devolve só chaves permitidas,
 * prontas para ir ao metadata do Stripe.
 */
export function attributionMetadata(input: unknown): Record<string, string> {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase();
    if (!ALLOWED.has(key)) continue;
    if (RESERVED_CHECKOUT_METADATA_KEYS.has(key)) continue;
    if (key.length > STRIPE_METADATA_KEY_MAX) continue;
    const value = sanitizeAttributionValue(rawValue, key);
    if (!value) continue;
    out[key] = value;
    if (Object.keys(out).length >= STRIPE_METADATA_KEYS_MAX) break;
  }
  return out;
}

export type MarketingConsentFields = {
  marketing_consent?: boolean;
  marketing_consent_notice_version?: string;
  marketing_consent_at?: string;
};

/**
 * Atribuição só com consentimento explícito: sem `marketing_consent === true` no pedido,
 * qualquer `attribution` enviado é ignorado.
 */
export function checkoutAttribution(body: MarketingConsentFields & { attribution?: unknown }): Record<string, string> {
  if (body.marketing_consent !== true) return {};
  return attributionMetadata(body.attribution);
}

/**
 * Registro da escolha de consentimento no metadata do checkout (prova do aceite ou da recusa, com a versão do texto).
 * Só existe quando o pedido traz a escolha (`marketing_consent` booleano).
 */
export function marketingConsentMetadata(body: MarketingConsentFields): Record<string, string> {
  if (typeof body.marketing_consent !== "boolean") return {};
  const out: Record<string, string> = {
    marketing_consent: body.marketing_consent ? "granted" : "denied",
  };
  const version = body.marketing_consent_notice_version?.trim();
  if (version && /^[A-Za-z0-9._-]{1,40}$/.test(version)) out.marketing_consent_notice_version = version;
  const at = body.marketing_consent_at?.trim();
  if (at && at.length <= 40 && !Number.isNaN(Date.parse(at))) out.marketing_consent_at = at;
  return out;
}
