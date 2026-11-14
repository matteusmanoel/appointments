/**
 * Sanitiza parâmetros de atribuição (UTM / click ids) antes de gravar no
 * metadata da sessão Stripe. Só passa chaves da lista; valores são
 * truncados no limite do Stripe (500) e sem caracteres de controle.
 */

export const STRIPE_METADATA_VALUE_MAX = 500;
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
]);

export function sanitizeAttributionValue(value: unknown, max = STRIPE_METADATA_VALUE_MAX): string | undefined {
  if (value == null) return undefined;
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, max);
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
    const value = sanitizeAttributionValue(rawValue);
    if (!value) continue;
    out[key] = value;
    if (Object.keys(out).length >= STRIPE_METADATA_KEYS_MAX) break;
  }
  return out;
}
