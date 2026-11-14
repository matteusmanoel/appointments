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

function readConsentRecord(): { choice: ConsentChoice; at: string } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { choice?: string; at?: string };
    if (parsed.choice !== "granted" && parsed.choice !== "denied") return null;
    return { choice: parsed.choice, at: typeof parsed.at === "string" ? parsed.at : "" };
  } catch {
    return null;
  }
}

export function getConsentChoice(): ConsentChoice | null {
  return readConsentRecord()?.choice ?? null;
}

export function hasMarketingConsent(): boolean {
  return getConsentChoice() === "granted";
}

export function canTrack(config: TrackingConfig = getTrackingConfig()): boolean {
  return hasMarketingConsent() && hasPixelIds(config);
}

export function setConsent(choice: ConsentChoice): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: 1, choice, at: new Date().toISOString() }));
  }
  if (choice === "granted") {
    loadPixelsIfAllowed();
  } else {
    // Eventos passam a ser no-op. Scripts já injetados não são um desligamento completo
    // (limitação dos pixels); o visitante pode recarregar a página após recusar.
    pixelsLoaded = false;
    const w = window as Window & { fbq?: FbqFn };
    if (typeof w.fbq === "function") {
      try {
        w.fbq("consent", "revoke");
      } catch {
        /* ignore */
      }
    }
  }
}

export function openConsentPreferences(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
  }
}

export function sanitizeAttributionValue(value: unknown, max = STRIPE_METADATA_VALUE_MAX): string | undefined {
  if (value == null) return undefined;
  const cleaned = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, max);
}

export function parseAttributionParams(search: string | URLSearchParams): AttributionTouch {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search : `?${search}`) : search;
  const out: AttributionTouch = {};
  for (const [rawKey, rawValue] of params.entries()) {
    const key = rawKey.trim().toLowerCase();
    if (!ATTRIBUTION_KEY_SET.has(key)) continue;
    const value = sanitizeAttributionValue(rawValue);
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

/**
 * Lê UTMs / click ids da URL, grava first-touch (se ainda não houver ou se expirou)
 * e last-touch (quando a URL traz parâmetros), com TTL de 90 dias.
 */
export function captureAttributionFromSearch(search: string | URLSearchParams, now = Date.now()): AttributionStore | null {
  const incoming = parseAttributionParams(search);
  const existing = readAttributionStore(now);
  if (touchIsEmpty(incoming)) return existing;

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

export function getStoredAttribution(now = Date.now()): AttributionStore | null {
  return readAttributionStore(now);
}

function flattenTouch(touch: AttributionTouch, prefix: "" | "first_"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ATTRIBUTION_PARAM_KEYS) {
    const value = sanitizeAttributionValue(touch[key]);
    if (value) out[`${prefix}${key}`] = value;
  }
  return out;
}

/** Payload flattened para o body do checkout (first + last touch). */
export function getAttributionForCheckout(now = Date.now()): Record<string, string> {
  const store = readAttributionStore(now);
  if (!store) return {};
  return {
    ...flattenTouch(store.last, ""),
    ...flattenTouch(store.first, "first_"),
  };
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
  const methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
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
    fbq?.("init", config.metaPixelId);
    injectScript(META_SCRIPT_ID, META_SCRIPT_SRC);
  }
  if (config.tiktokPixelId) {
    const ttq = ensureTtq();
    const src = `${TIKTOK_SCRIPT_SRC}?sdkid=${encodeURIComponent(config.tiktokPixelId)}&lib=ttq`;
    if (ttq) {
      ttq._i = ttq._i || {};
      ttq._t = ttq._t || {};
      ttq._o = ttq._o || {};
      ttq._i[config.tiktokPixelId] = [];
      ttq._t[config.tiktokPixelId] = Date.now();
    }
    injectScript(TIKTOK_SCRIPT_ID, src);
  }
  pixelsLoaded = true;
  return true;
}

function pixelPayload(extra: Record<string, unknown> = {}) {
  return extra;
}

export function trackPageView(path?: string): void {
  if (!canTrack()) return;
  const key = path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
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
 * (guarda no localStorage). event_id = session_id, pronto para uma CAPI futura.
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
  w.fbq?.("track", "Purchase", payload, { eventID: sessionId });
  // TikTok: CompletePayment é o evento padrão de compra; event_id no payload para CAPI futura.
  w.ttq?.track?.("CompletePayment", { ...payload, event_id: sessionId });
  return true;
}

export const PIXEL_SCRIPT = {
  metaId: META_SCRIPT_ID,
  tiktokId: TIKTOK_SCRIPT_ID,
  metaSrc: META_SCRIPT_SRC,
  tiktokSrc: TIKTOK_SCRIPT_SRC,
} as const;
