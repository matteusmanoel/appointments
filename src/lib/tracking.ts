/**
 * Rastreamento de anúncios (Meta Pixel + TikTok Pixel) e atribuição (UTM / click ids).
 *
 * Nada é carregado e nenhum evento é disparado sem:
 *   1) VITE_META_PIXEL_ID e/ou VITE_TIKTOK_PIXEL_ID definidos no build, e
 *   2) consentimento explícito do visitante (LGPD), gravado no localStorage.
 *
 * Sem os IDs, o módulo é um no-op (nenhum script, nenhuma requisição de rede).
 * Os IDs nunca são hardcoded — só vêm de variável de ambiente ou de override de teste.
 */

import { BILLING_PLANS } from "@/lib/billing-plans";
import type { BillingPlan } from "@/lib/api";

export const CONSENT_STORAGE_KEY = "navalhia_ads_consent";
export const ATTRIBUTION_STORAGE_KEY = "navalhia_attribution";
export const PURCHASE_STORAGE_PREFIX = "navalhia_purchase_event:";
export const PENDING_CHECKOUT_KEY = "navalhia_pending_checkout";
export const CONSENT_OPEN_EVENT = "navalhia:consent-open";
export const ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const STRIPE_METADATA_VALUE_MAX = 500;
/** Versão do TEXTO do banner de consentimento. Mudou o texto ou a política? Mude aqui (o aceite antigo deixa de valer). */
export const CONSENT_NOTICE_VERSION = "2026-11-14";
export const PRIVACY_POLICY_PATH = "/privacidade";
export const ONBOARDING_SESSION_KEY = "navalhia_onboarding_session";
/** Limites dos valores de atribuição (iguais no backend). */
export const UTM_VALUE_MAX = 100;
export const CLICK_ID_VALUE_MAX = 200;
/** Cookies que os pixels gravam no navegador do visitante. */
export const MARKETING_COOKIE_NAMES = ["_fbp", "_fbc", "_ttp", "ttclid", "_tt_enable_cookie", "_tt_sessionId"] as const;

export const ATTRIBUTION_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "ttclid",
  "gclid",
] as const;

export type AttributionParamKey = (typeof ATTRIBUTION_PARAM_KEYS)[number];
export type AttributionTouch = Partial<Record<AttributionParamKey, string>>;

export type ConsentChoice = "granted" | "denied";

export type TrackingConfig = {
  metaPixelId: string;
  tiktokPixelId: string;
};

type PendingCheckout = {
  plan: BillingPlan;
  value: number;
  currency: "BRL";
};

type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded?: boolean;
  version?: string;
  push?: unknown;
  disablePushState?: boolean;
  allowDuplicatePageViews?: boolean;
};

type TtqFn = {
  page?: (...args: unknown[]) => void;
  track?: (...args: unknown[]) => void;
  methods?: string[];
  load?: (...args: unknown[]) => void;
  instance?: (...args: unknown[]) => unknown;
  setAndDefer?: (...args: unknown[]) => void;
  _i?: Record<string, unknown>;
  _t?: Record<string, number>;
  _o?: Record<string, unknown>;
  push?: (...args: unknown[]) => void;
};

const META_SCRIPT_ID = "navalhia-meta-pixel";
const TIKTOK_SCRIPT_ID = "navalhia-tiktok-pixel";
const META_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";
const TIKTOK_SCRIPT_SRC = "https://analytics.tiktok.com/i18n/pixel/events.js";

const ATTRIBUTION_KEY_SET = new Set<string>(ATTRIBUTION_PARAM_KEYS);

let testConfigOverride: Partial<TrackingConfig> | null = null;
let pixelsLoaded = false;
let viewContentFired = false;
let lastPageView: { path: string; at: number } | null = null;
let metaInitialized = false;
let tiktokInitialized = false;
/** Atribuição vista antes do aceite: só em memória (nada vai ao localStorage nem ao Stripe sem consentimento). */
let pendingAttribution: AttributionTouch | null = null;

function readEnvId(value: unknown): string {
  return String(value ?? "").trim();
}

export function getTrackingConfig(): TrackingConfig {
  return {
    metaPixelId: (testConfigOverride?.metaPixelId ?? readEnvId(import.meta.env.VITE_META_PIXEL_ID)),
    tiktokPixelId: (testConfigOverride?.tiktokPixelId ?? readEnvId(import.meta.env.VITE_TIKTOK_PIXEL_ID)),
  };
}

/** Override só para testes. Passe `null` para voltar a ler as envs. */
export function setTrackingConfigForTests(cfg: Partial<TrackingConfig> | null): void {
  testConfigOverride = cfg;
}

export function resetTrackingForTests(): void {
  pixelsLoaded = false;
  viewContentFired = false;
  lastPageView = null;
  metaInitialized = false;
  tiktokInitialized = false;
  pendingAttribution = null;
  testConfigOverride = null;
  if (typeof document !== "undefined") {
    document.getElementById(META_SCRIPT_ID)?.remove();
    document.getElementById(TIKTOK_SCRIPT_ID)?.remove();
  }
  if (typeof window !== "undefined") {
    delete (window as Window & { fbq?: unknown }).fbq;
    delete (window as Window & { _fbq?: unknown })._fbq;
    delete (window as Window & { ttq?: unknown }).ttq;
    delete (window as Window & { TiktokAnalyticsObject?: unknown }).TiktokAnalyticsObject;
  }
}

export function hasPixelIds(config: TrackingConfig = getTrackingConfig()): boolean {
  return Boolean(config.metaPixelId || config.tiktokPixelId);
}

export type ConsentRecord = { choice: ConsentChoice; at: string; noticeVersion: string };

/**
 * Lê o registro de consentimento. Registro de outra versão do TEXTO do banner
 * (ou sem versão) não vale: o visitante é perguntado de novo.
 */
export function getConsentRecord(): ConsentRecord | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { choice?: string; at?: string; notice_version?: string };
    if (parsed.choice !== "granted" && parsed.choice !== "denied") return null;
    if (parsed.notice_version !== CONSENT_NOTICE_VERSION) return null;
    return { choice: parsed.choice, at: typeof parsed.at === "string" ? parsed.at : "", noticeVersion: parsed.notice_version };
  } catch {
    return null;
  }
}

export function getConsentChoice(): ConsentChoice | null {
  return getConsentRecord()?.choice ?? null;
}

export function hasMarketingConsent(): boolean {
  return getConsentChoice() === "granted";
}

export function canTrack(config: TrackingConfig = getTrackingConfig()): boolean {
  return hasMarketingConsent() && hasPixelIds(config);
}

/** Apaga um cookie em todos os domínios/caminhos plausíveis (os pixels gravam no domínio raiz). */
function expireCookie(name: string): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains: Array<string | null> = [null, host];
  for (let i = 1; i < parts.length - 1; i += 1) domains.push(`.${parts.slice(i).join(".")}`);
  for (const domain of domains) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/${domain ? `; domain=${domain}` : ""}`;
  }
}

/** Remove cookies dos pixels e a atribuição guardada (localStorage e memória). */
export function clearMarketingStorage(): void {
  pendingAttribution = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  for (const name of MARKETING_COOKIE_NAMES) expireCookie(name);
}

function callTtq(method: string): void {
  const ttq = (window as Window & { ttq?: Record<string, unknown> }).ttq;
  const fn = ttq?.[method];
  if (typeof fn === "function") {
    try {
      (fn as () => void).call(ttq);
    } catch {
      /* ignore */
    }
  }
}

function callFbqConsent(mode: "grant" | "revoke"): void {
  const fbq = (window as Window & { fbq?: FbqFn }).fbq;
  if (typeof fbq === "function") {
    try {
      fbq("consent", mode);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Grava a escolha (com a versão do texto do banner) e aplica o efeito.
 * Recusa/revogação: revoga Meta e TikTok, apaga _fbp/_fbc/_ttp e a atribuição.
 * Retorna `reloadRecommended: true` quando um script de pixel já estava ativo
 * (só recarregar a página o descarrega por completo).
 */
export function setConsent(choice: ConsentChoice): { reloadRecommended: boolean } {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ v: 1, notice_version: CONSENT_NOTICE_VERSION, choice, at: new Date().toISOString() }),
    );
  }
  if (typeof window === "undefined") return { reloadRecommended: false };
  if (choice === "granted") {
    const wasInitialized = metaInitialized || tiktokInitialized;
    if (pendingAttribution) {
      const pending = pendingAttribution;
      pendingAttribution = null;
      storeTouch(pending, Date.now());
    }
    loadPixelsIfAllowed();
    if (wasInitialized) {
      // Reaceite depois de revogar: sem isto o Meta continua revogado e perde os eventos.
      callFbqConsent("grant");
      callTtq("enableCookie");
      callTtq("grantConsent");
    }
    return { reloadRecommended: false };
  }
  const wasActive = pixelsLoaded || metaInitialized || tiktokInitialized;
  pixelsLoaded = false;
  callFbqConsent("revoke");
  callTtq("revokeConsent");
  callTtq("disableCookie");
  clearMarketingStorage();
  return { reloadRecommended: wasActive };
}

export function openConsentPreferences(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
  }
}

const SAFE_ATTRIBUTION_VALUE = /^[A-Za-z0-9 _.~:+|-]+$/;

function isClickIdKey(key: string): boolean {
  return /clid$/.test(key.replace(/^first_/, ""));
}

/**
 * Valida um valor de atribuição: tira caracteres de controle, trunca (utm_* 100, click ids 200)
 * e só aceita letras, números, espaço e `_ . ~ : + | -`. Qualquer outra coisa (por exemplo `@`, que
 * apareceria num e-mail) descarta o valor. utm_* que parece telefone (só dígitos, 8+) também é descartado.
 */
export function sanitizeAttributionValue(value: unknown, key = "utm_source"): string | undefined {
  if (value == null) return undefined;
  const clickId = isClickIdKey(key);
  const cleaned = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, clickId ? CLICK_ID_VALUE_MAX : UTM_VALUE_MAX)
    .trim();
  if (!cleaned) return undefined;
  if (!SAFE_ATTRIBUTION_VALUE.test(cleaned)) return undefined;
  if (!clickId && /^\d{8,}$/.test(cleaned.replace(/[ .+-]/g, ""))) return undefined;
  return cleaned;
}

export function parseAttributionParams(search: string | URLSearchParams): AttributionTouch {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search : `?${search}`) : search;
  const out: AttributionTouch = {};
  for (const [rawKey, rawValue] of params.entries()) {
    const key = rawKey.trim().toLowerCase();
    if (!ATTRIBUTION_KEY_SET.has(key)) continue;
    const value = sanitizeAttributionValue(rawValue, key);
    if (!value) continue;
    out[key as AttributionParamKey] = value;
  }
  return out;
}

function isExpired(capturedAt: number, now: number): boolean {
  return !Number.isFinite(capturedAt) || now - capturedAt > ATTRIBUTION_TTL_MS;
}

type AttributionStore = {
  v: 1;
  first: AttributionTouch;
  last: AttributionTouch;
  firstAt: number;
  lastAt: number;
};

function readAttributionStore(now = Date.now()): AttributionStore | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AttributionStore>;
    const firstAt = typeof parsed.firstAt === "number" ? parsed.firstAt : 0;
    const lastAt = typeof parsed.lastAt === "number" ? parsed.lastAt : 0;
    if (isExpired(firstAt, now) && isExpired(lastAt, now)) {
      localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
      return null;
    }
    return {
      v: 1,
      first: parsed.first && typeof parsed.first === "object" ? parsed.first : {},
      last: parsed.last && typeof parsed.last === "object" ? parsed.last : {},
      firstAt,
      lastAt,
    };
  } catch {
    return null;
  }
}

function writeAttributionStore(store: AttributionStore): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(store));
}

function touchIsEmpty(touch: AttributionTouch): boolean {
  return ATTRIBUTION_PARAM_KEYS.every((k) => !touch[k]);
}

function storeTouch(incoming: AttributionTouch, now: number): AttributionStore | null {
  if (touchIsEmpty(incoming)) return readAttributionStore(now);
  const existing = readAttributionStore(now);
  const firstExpired = !existing || isExpired(existing.firstAt, now);
  const store: AttributionStore = {
    v: 1,
    first: firstExpired || touchIsEmpty(existing.first) ? incoming : existing.first,
    last: incoming,
    firstAt: firstExpired || touchIsEmpty(existing?.first ?? {}) ? now : existing!.firstAt,
    lastAt: now,
  };
  writeAttributionStore(store);
  return store;
}

/**
 * Lê UTMs / click ids da URL. SÓ grava first-touch (se ainda não houver ou se expirou) e
 * last-touch (quando a URL traz parâmetros), com TTL de 90 dias, com consentimento de marketing.
 * Enquanto o visitante ainda não escolheu, fica só em memória (vai para o localStorage no aceite
 * e é descartada na recusa). Recusou: nada é guardado.
 */
export function captureAttributionFromSearch(search: string | URLSearchParams, now = Date.now()): AttributionStore | null {
  const incoming = parseAttributionParams(search);
  if (hasMarketingConsent()) return storeTouch(incoming, now);
  if (getConsentChoice() === null && !touchIsEmpty(incoming)) pendingAttribution = incoming;
  return null;
}

export function getStoredAttribution(now = Date.now()): AttributionStore | null {
  return readAttributionStore(now);
}

function flattenTouch(touch: AttributionTouch, prefix: "" | "first_"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ATTRIBUTION_PARAM_KEYS) {
    const value = sanitizeAttributionValue(touch[key], key);
    if (value) out[`${prefix}${key}`] = value;
  }
  return out;
}

/** Payload flattened para o body do checkout (first + last touch). Vazio sem consentimento de marketing. */
export function getAttributionForCheckout(now = Date.now()): Record<string, string> {
  if (!hasMarketingConsent()) return {};
  const store = readAttributionStore(now);
  if (!store) return {};
  return {
    ...flattenTouch(store.last, ""),
    ...flattenTouch(store.first, "first_"),
  };
}

export type CheckoutTrackingFields = {
  attribution?: Record<string, string>;
  marketing_consent?: boolean;
  marketing_consent_notice_version?: string;
  marketing_consent_at?: string;
};

/**
 * Campos de rastreamento para o body do checkout: a atribuição só vai com aceite
 * (e com `marketing_consent: true`, que o servidor exige). Quem já escolheu tem a escolha,
 * a versão do texto e a data registradas no metadata do checkout; quem não escolheu não envia nada.
 */
export function getCheckoutTrackingFields(now = Date.now()): CheckoutTrackingFields {
  const record = getConsentRecord();
  if (!record) return {};
  const fields: CheckoutTrackingFields = {
    marketing_consent: record.choice === "granted",
    marketing_consent_notice_version: record.noticeVersion,
    ...(record.at ? { marketing_consent_at: record.at } : {}),
  };
  if (record.choice === "granted") {
    const attribution = getAttributionForCheckout(now);
    if (Object.keys(attribution).length) fields.attribution = attribution;
  }
  return fields;
}

function planOffer(plan: BillingPlan): PendingCheckout {
  const meta = BILLING_PLANS.find((p) => p.id === plan);
  return { plan, value: meta?.priceValue ?? 0, currency: "BRL" };
}

export function rememberCheckoutOffer(plan: BillingPlan): PendingCheckout {
  const offer = planOffer(plan);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(offer));
  }
  return offer;
}

export function readPendingCheckout(): PendingCheckout | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCheckout>;
    if (parsed.plan !== "essential" && parsed.plan !== "pro" && parsed.plan !== "premium") return null;
    const value = typeof parsed.value === "number" && Number.isFinite(parsed.value) ? parsed.value : planOffer(parsed.plan).value;
    return { plan: parsed.plan, value, currency: "BRL" };
  } catch {
    return null;
  }
}

function injectScript(id: string, src: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("script");
  el.id = id;
  el.async = true;
  el.src = src;
  document.head.appendChild(el);
}

function ensureFbq(): FbqFn | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { fbq?: FbqFn; _fbq?: FbqFn };
  if (typeof w.fbq === "function") return w.fbq;
  const n: FbqFn = function fbqStub(this: FbqFn, ...args: unknown[]) {
    if (n.callMethod) n.callMethod.apply(n, args);
    else n.queue.push(args);
  } as FbqFn;
  n.queue = [];
  n.loaded = true;
  n.version = "2.0";
  n.push = n;
  w.fbq = n;
  w._fbq = n;
  return n;
}

function ensureTtq(): TtqFn | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { ttq?: TtqFn; TiktokAnalyticsObject?: string };
  if (w.ttq) return w.ttq;
  const ttq: TtqFn = [] as unknown as TtqFn;
  const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "grantConsent", "revokeConsent"];
  ttq.methods = methods;
  ttq.setAndDefer = (target: Record<string, unknown>, name: string) => {
    target[name] = function deferred(...args: unknown[]) {
      (target as { push: (v: unknown) => void }).push([name, ...args]);
    };
  };
  const arr = ttq as unknown as unknown[] & TtqFn;
  arr.push = Array.prototype.push;
  for (const name of methods) ttq.setAndDefer?.(arr as unknown as Record<string, unknown>, name);
  w.ttq = ttq;
  w.TiktokAnalyticsObject = "ttq";
  return ttq;
}

/**
 * Injeta os scripts apenas com ID + consentimento. Sem isso, não cria stubs nem tags <script>.
 */
export function loadPixelsIfAllowed(config: TrackingConfig = getTrackingConfig()): boolean {
  if (pixelsLoaded) return hasPixelIds(config) && hasMarketingConsent();
  if (!canTrack(config)) return false;

  if (config.metaPixelId) {
    const fbq = ensureFbq();
    if (fbq && !metaInitialized) {
      // Sem PageView automático em pushState e sem eventos automáticos (cliques, microdados):
      // só disparamos os eventos que o código escolhe, nas páginas permitidas.
      fbq.disablePushState = true;
      fbq.allowDuplicatePageViews = true;
      fbq("set", "autoConfig", false, config.metaPixelId);
      fbq("init", config.metaPixelId);
      metaInitialized = true;
    }
    injectScript(META_SCRIPT_ID, META_SCRIPT_SRC);
  }
  if (config.tiktokPixelId) {
    const ttq = ensureTtq();
    const src = `${TIKTOK_SCRIPT_SRC}?sdkid=${encodeURIComponent(config.tiktokPixelId)}&lib=ttq`;
    if (ttq && !tiktokInitialized) {
      ttq._i = ttq._i || {};
      ttq._t = ttq._t || {};
      ttq._o = ttq._o || {};
      ttq._i[config.tiktokPixelId] = [];
      ttq._t[config.tiktokPixelId] = Date.now();
      tiktokInitialized = true;
    }
    injectScript(TIKTOK_SCRIPT_ID, src);
  }
  pixelsLoaded = true;
  return true;
}

function pixelPayload(extra: Record<string, unknown> = {}) {
  return extra;
}

/** PageView e ViewContent: só nas páginas de marketing. */
const PAGE_EVENT_PATHS = new Set(["/"]);
/** Eventos de conversão: também no login (modal de checkout) e no retorno do pagamento. */
const CONVERSION_EVENT_PATHS = new Set(["/", "/login", "/onboarding"]);
/** Com qualquer um destes na URL, nenhum evento sai (a URL inteira iria para Meta/TikTok). */
const BLOCKING_QUERY_KEYS = new Set(["reset_token", "token", "access_token", "refresh_token", "id_token"]);

function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/**
 * Decide se a página atual pode emitir evento aos pixels e deixa a URL só com o que pode sair:
 *  - fora das páginas permitidas (/app, /b/:slug, /reagendar/:token, /cancelar/:token, /docs…): não;
 *  - com reset_token/token na URL: não;
 *  - /login: só sem query; /onboarding: a query (session_id) é removida da barra de endereço;
 *  - /: ficam só utm_*, fbclid, ttclid, gclid.
 * O pixel lê `location.href` na hora do evento, por isso a URL é limpa antes de disparar.
 */
export function preparePixelLocation(kind: "page" | "conversion"): boolean {
  if (typeof window === "undefined") return false;
  const { pathname, search, hash } = window.location;
  const path = normalizePath(pathname);
  const allowed = kind === "page" ? PAGE_EVENT_PATHS : CONVERSION_EVENT_PATHS;
  if (!allowed.has(path)) return false;
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (BLOCKING_QUERY_KEYS.has(key.trim().toLowerCase())) return false;
  }
  if (path === "/login") return search === "" || search === "?";
  const keep = path === "/" ? ATTRIBUTION_KEY_SET : new Set<string>();
  let changed = false;
  for (const key of [...params.keys()]) {
    if (!keep.has(key.trim().toLowerCase())) {
      params.delete(key);
      changed = true;
    }
  }
  const stripHash = path !== "/" && hash !== "";
  if (changed || stripHash) {
    const qs = params.toString();
    try {
      window.history.replaceState(window.history.state, "", `${pathname}${qs ? `?${qs}` : ""}${path === "/" ? hash : ""}`);
    } catch {
      return false;
    }
  }
  return true;
}

/** SHA-256 síncrono (hex), para o event_id do Purchase não expor o session_id do Stripe. */
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const K = new Uint32Array(64);
  let c = 0;
  for (let n = 2; c < 64; n += 1) {
    let prime = true;
    for (let d = 2; d * d <= n; d += 1) if (n % d === 0) prime = false;
    if (prime) {
      K[c] = Math.floor((n ** (1 / 3) % 1) * 2 ** 32);
      c += 1;
    }
  }
  const H = new Uint32Array(8);
  c = 0;
  for (let n = 2; c < 8; n += 1) {
    let prime = true;
    for (let d = 2; d * d <= n; d += 1) if (n % d === 0) prime = false;
    if (prime) {
      H[c] = Math.floor((n ** (1 / 2) % 1) * 2 ** 32);
      c += 1;
    }
  }
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  view.setUint32(total - 4, (bytes.length * 8) >>> 0);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, cc, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & cc) ^ (b & cc);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = cc;
      cc = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += cc; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** event_id do Purchase: hash do session_id (o session_id em si é um segredo de curta duração). */
export function purchaseEventId(sessionId: string): string {
  return `purchase_${sha256Hex(sessionId).slice(0, 40)}`;
}

export function trackPageView(path?: string): void {
  if (!canTrack()) return;
  if (!preparePixelLocation("page")) return;
  // A chave de dedupe é só o caminho (sem query); a URL que o pixel lê já foi limpa acima.
  const key = normalizePath((path ?? window.location.pathname).split(/[?#]/)[0] || "/");
  const now = Date.now();
  if (lastPageView && lastPageView.path === key && now - lastPageView.at < 1000) return;
  lastPageView = { path: key, at: now };
  loadPixelsIfAllowed();
  const w = window as Window & { fbq?: FbqFn; ttq?: TtqFn };
  w.fbq?.("track", "PageView");
  w.ttq?.page?.();
}

export function trackViewContentPlans(): void {
  if (!canTrack()) return;
  if (!preparePixelLocation("page")) return;
  if (viewContentFired) return;
  viewContentFired = true;
  loadPixelsIfAllowed();
  const payload = pixelPayload({
    content_name: "plans",
    content_type: "product",
    content_ids: BILLING_PLANS.map((p) => p.id),
    currency: "BRL",
  });
  const w = window as Window & { fbq?: FbqFn; ttq?: TtqFn };
  w.fbq?.("track", "ViewContent", payload);
  w.ttq?.track?.("ViewContent", payload);
}

export function observePlansSection(sectionId = "planos"): () => void {
  if (typeof document === "undefined" || typeof IntersectionObserver === "undefined") return () => {};
  const el = document.getElementById(sectionId);
  if (!el) return () => {};
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        trackViewContentPlans();
        observer.disconnect();
      }
    },
    { threshold: 0.35 },
  );
  observer.observe(el);
  return () => observer.disconnect();
}

export function trackInitiateCheckout(plan: BillingPlan): void {
  const offer = rememberCheckoutOffer(plan);
  if (!canTrack()) return;
  if (!preparePixelLocation("conversion")) return;
  loadPixelsIfAllowed();
  const payload = pixelPayload({
    content_name: offer.plan,
    content_ids: [offer.plan],
    content_type: "product",
    value: offer.value,
    currency: offer.currency,
  });
  const w = window as Window & { fbq?: FbqFn; ttq?: TtqFn };
  w.fbq?.("track", "InitiateCheckout", payload);
  w.ttq?.track?.("InitiateCheckout", payload);
}

export function purchaseAlreadyFired(sessionId: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PURCHASE_STORAGE_PREFIX + sessionId) === "1";
  } catch {
    return false;
  }
}

export function markPurchaseFired(sessionId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PURCHASE_STORAGE_PREFIX + sessionId, "1");
  } catch {
    /* quota */
  }
}

/**
 * Purchase no retorno de sucesso. Dispara no máximo uma vez por session_id do Stripe
 * (guarda no localStorage). event_id = hash do session_id (nunca o session_id), pronto para uma CAPI futura.
 * Retorna true se o evento foi de fato enviado.
 */
export function trackPurchase(opts: { sessionId: string; plan?: BillingPlan; value?: number }): boolean {
  const sessionId = opts.sessionId?.trim();
  if (!sessionId) return false;
  if (purchaseAlreadyFired(sessionId)) return false;
  // Reserva o id mesmo se o track estiver desligado, para não disparar duas vezes
  // quando o visitante aceitar cookies depois no mesmo retorno de sucesso? Não:
  // sem consentimento não marcamos, para poder disparar após o aceite na mesma visita.
  if (!canTrack()) return false;
  // O pixel lê a URL na hora do evento: a query (session_id) sai da barra de endereço antes.
  if (!preparePixelLocation("conversion")) return false;
  markPurchaseFired(sessionId);
  loadPixelsIfAllowed();
  const pending = readPendingCheckout();
  const plan = opts.plan ?? pending?.plan;
  const value = opts.value ?? pending?.value ?? (plan ? planOffer(plan).value : undefined);
  const payload = pixelPayload({
    ...(plan ? { content_name: plan, content_ids: [plan], content_type: "product" } : {}),
    ...(typeof value === "number" ? { value, currency: "BRL" } : { currency: "BRL" }),
  });
  const w = window as Window & { fbq?: FbqFn; ttq?: TtqFn };
  // Meta: eventID no 4º argumento (event_id para dedup com CAPI).
  const eventId = purchaseEventId(sessionId);
  w.fbq?.("track", "Purchase", payload, { eventID: eventId });
  // TikTok: CompletePayment é o evento padrão de compra; event_id no payload para CAPI futura.
  w.ttq?.track?.("CompletePayment", { ...payload, event_id: eventId });
  return true;
}

export const PIXEL_SCRIPT = {
  metaId: META_SCRIPT_ID,
  tiktokId: TIKTOK_SCRIPT_ID,
  metaSrc: META_SCRIPT_SRC,
  tiktokSrc: TIKTOK_SCRIPT_SRC,
} as const;
