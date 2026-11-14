import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_STORAGE_KEY,
  ATTRIBUTION_TTL_MS,
  CONSENT_STORAGE_KEY,
  PIXEL_SCRIPT,
  PURCHASE_STORAGE_PREFIX,
  captureAttributionFromSearch,
  canTrack,
  getAttributionForCheckout,
  getConsentChoice,
  getStoredAttribution,
  hasMarketingConsent,
  loadPixelsIfAllowed,
  parseAttributionParams,
  purchaseAlreadyFired,
  resetTrackingForTests,
  setConsent,
  setTrackingConfigForTests,
  trackInitiateCheckout,
  trackPageView,
  trackPurchase,
  trackViewContentPlans,
} from "./tracking";

function scriptSrcs(): string[] {
  return [...document.querySelectorAll("script")].map((s) => s.src);
}

describe("tracking: env + consent gate", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    resetTrackingForTests();
  });

  it("sem IDs e sem consentimento, não injeta script e não dispara evento", () => {
    setTrackingConfigForTests({ metaPixelId: "", tiktokPixelId: "" });
    expect(canTrack()).toBe(false);
    expect(loadPixelsIfAllowed()).toBe(false);
    trackPageView("/");
    trackViewContentPlans();
    trackInitiateCheckout("pro");
    expect(trackPurchase({ sessionId: "cs_test_1", plan: "pro", value: 297 })).toBe(false);
    expect(scriptSrcs()).toEqual([]);
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect((window as unknown as { ttq?: unknown }).ttq).toBeUndefined();
  });

  it("com IDs mas sem consentimento, não carrega pixel nem dispara", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "TT456" });
    expect(getConsentChoice()).toBeNull();
    expect(hasMarketingConsent()).toBe(false);
    expect(loadPixelsIfAllowed()).toBe(false);
    trackPageView("/");
    expect(scriptSrcs()).toEqual([]);
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect((window as unknown as { ttq?: unknown }).ttq).toBeUndefined();
  });

  it("com consentimento mas sem IDs, continua no-op (nada na rede)", () => {
    setTrackingConfigForTests({ metaPixelId: "", tiktokPixelId: "" });
    setConsent("granted");
    expect(hasMarketingConsent()).toBe(true);
    expect(canTrack()).toBe(false);
    trackPageView("/");
    expect(scriptSrcs()).toEqual([]);
  });

  it("com IDs e aceite, injeta os dois scripts e dispara PageView", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "TT456" });
    setConsent("granted");
    expect(canTrack()).toBe(true);
    trackPageView("/precos");
    const srcs = scriptSrcs();
    expect(srcs.some((s) => s.includes("connect.facebook.net/en_US/fbevents.js"))).toBe(true);
    expect(srcs.some((s) => s.includes("analytics.tiktok.com/i18n/pixel/events.js"))).toBe(true);
    expect(document.getElementById(PIXEL_SCRIPT.metaId)).toBeTruthy();
    expect(document.getElementById(PIXEL_SCRIPT.tiktokId)).toBeTruthy();
    const fbq = (window as unknown as { fbq: { queue: unknown[] } }).fbq;
    expect(fbq.queue).toContainEqual(["init", "META123"]);
    expect(fbq.queue).toContainEqual(["track", "PageView"]);
  });

  it("recusar depois do aceite impede novos eventos e não relê os IDs vazios como carga", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    setConsent("granted");
    trackPageView("/a");
    expect(document.getElementById(PIXEL_SCRIPT.metaId)).toBeTruthy();
    const callsBefore = ((window as unknown as { fbq: { queue: unknown[] } }).fbq.queue || []).length;
    setConsent("denied");
    expect(hasMarketingConsent()).toBe(false);
    trackPageView("/b");
    trackViewContentPlans();
    const callsAfter = ((window as unknown as { fbq: { queue: unknown[] } }).fbq.queue || []).length;
    // no máximo o consent/revoke; nenhum PageView/ViewContent novo
    const tracks = ((window as unknown as { fbq: { queue: unknown[] } }).fbq.queue || []).filter(
      (c) => Array.isArray(c) && c[0] === "track",
    );
    expect(tracks.filter((c) => c[1] === "PageView")).toHaveLength(1);
    expect(tracks.some((c) => c[1] === "ViewContent")).toBe(false);
    expect(callsAfter).toBeGreaterThanOrEqual(callsBefore);
  });

  it("consentimento fica no localStorage e é reversível", () => {
    setConsent("denied");
    expect(getConsentChoice()).toBe("denied");
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) || "{}").choice).toBe("denied");
    setConsent("granted");
    expect(getConsentChoice()).toBe("granted");
  });
});

describe("tracking: Purchase dedupe e event_id", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "TT456" });
    setConsent("granted");
  });

  afterEach(() => {
    resetTrackingForTests();
  });

  it("dispara uma vez por session_id, com event_id = session Stripe", () => {
    const sessionId = "cs_test_abc123";
    expect(trackPurchase({ sessionId, plan: "pro", value: 297 })).toBe(true);
    expect(purchaseAlreadyFired(sessionId)).toBe(true);
    expect(localStorage.getItem(PURCHASE_STORAGE_PREFIX + sessionId)).toBe("1");
    expect(trackPurchase({ sessionId, plan: "pro", value: 297 })).toBe(false);
    expect(trackPurchase({ sessionId, plan: "premium", value: 449 })).toBe(false);

    const fbq = (window as unknown as { fbq: { queue: unknown[] } }).fbq;
    const purchases = fbq.queue.filter((c) => Array.isArray(c) && c[0] === "track" && c[1] === "Purchase");
    expect(purchases).toHaveLength(1);
    expect(purchases[0][2]).toMatchObject({ value: 297, currency: "BRL", content_ids: ["pro"] });
    expect(purchases[0][3]).toEqual({ eventID: sessionId });

    const ttq = (window as unknown as { ttq: unknown[] }).ttq;
    const complete = (ttq as unknown[]).filter((c) => Array.isArray(c) && c[0] === "track" && c[1] === "CompletePayment");
    expect(complete).toHaveLength(1);
    expect((complete[0] as unknown[])[2]).toMatchObject({ event_id: sessionId, value: 297, currency: "BRL" });
  });

  it("sem consentimento não marca o session_id, para poder disparar depois do aceite", () => {
    setConsent("denied");
    const sessionId = "cs_test_later";
    expect(trackPurchase({ sessionId, plan: "essential", value: 147 })).toBe(false);
    expect(purchaseAlreadyFired(sessionId)).toBe(false);
    setConsent("granted");
    expect(trackPurchase({ sessionId, plan: "essential", value: 147 })).toBe(true);
    expect(trackPurchase({ sessionId, plan: "essential", value: 147 })).toBe(false);
  });

  it("session_id vazio não dispara", () => {
    expect(trackPurchase({ sessionId: "  ", plan: "pro" })).toBe(false);
  });
});

describe("tracking: UTM parse + first/last touch + TTL 90 dias", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T03:00:00-03:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("parseia só as chaves permitidas, em minúsculas, e ignora vazio", () => {
    const parsed = parseAttributionParams(
      "?UTM_SOURCE=meta&utm_medium=paid&utm_campaign=navalhia_t3&utm_term=&utm_content=ad1&fbclid=abc&gclid=g1&ttclid=t1&evil=drop&unused=1",
    );
    expect(parsed).toEqual({
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: "navalhia_t3",
      utm_content: "ad1",
      fbclid: "abc",
      gclid: "g1",
      ttclid: "t1",
    });
  });

  it("first-touch permanece; last-touch atualiza quando chega uma nova campanha", () => {
    const t0 = Date.now();
    captureAttributionFromSearch("?utm_source=meta&utm_campaign=t3&fbclid=first", t0);
    const later = t0 + 5 * 24 * 60 * 60 * 1000;
    captureAttributionFromSearch("?utm_source=tiktok&utm_campaign=t3b&ttclid=second", later);
    const store = getStoredAttribution(later)!;
    expect(store.first).toMatchObject({ utm_source: "meta", utm_campaign: "t3", fbclid: "first" });
    expect(store.last).toMatchObject({ utm_source: "tiktok", utm_campaign: "t3b", ttclid: "second" });
    const payload = getAttributionForCheckout(later);
    expect(payload.utm_source).toBe("tiktok");
    expect(payload.utm_campaign).toBe("t3b");
    expect(payload.ttclid).toBe("second");
    expect(payload.first_utm_source).toBe("meta");
    expect(payload.first_utm_campaign).toBe("t3");
    expect(payload.first_fbclid).toBe("first");
  });

  it("visita sem UTM não sobrescreve o last-touch", () => {
    const t0 = Date.now();
    captureAttributionFromSearch("?utm_source=meta&utm_medium=paid", t0);
    captureAttributionFromSearch("", t0 + 1000);
    captureAttributionFromSearch("?", t0 + 2000);
    const store = getStoredAttribution(t0 + 2000)!;
    expect(store.last).toMatchObject({ utm_source: "meta", utm_medium: "paid" });
  });

  it("depois de 90 dias o registro expira e um novo UTM vira first-touch", () => {
    const t0 = Date.now();
    captureAttributionFromSearch("?utm_source=meta&utm_campaign=old", t0);
    expect(getStoredAttribution(t0)?.first.utm_source).toBe("meta");
    const expired = t0 + ATTRIBUTION_TTL_MS + 1;
    expect(getStoredAttribution(expired)).toBeNull();
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    captureAttributionFromSearch("?utm_source=tiktok&utm_campaign=new", expired);
    const store = getStoredAttribution(expired)!;
    expect(store.first).toMatchObject({ utm_source: "tiktok", utm_campaign: "new" });
    expect(store.last).toMatchObject({ utm_source: "tiktok", utm_campaign: "new" });
  });

  it("corta valores no limite do metadata do Stripe e remove caracteres de controle", () => {
    const long = "x".repeat(600);
    const parsed = parseAttributionParams(new URLSearchParams({ utm_source: `meta\u0000${long}` }));
    expect(parsed.utm_source?.startsWith("metax")).toBe(true);
    expect(parsed.utm_source?.includes("\u0000")).toBe(false);
    expect(parsed.utm_source).toHaveLength(500);
  });
});
