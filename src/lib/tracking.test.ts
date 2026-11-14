import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_STORAGE_KEY,
  ATTRIBUTION_TTL_MS,
  CONSENT_STORAGE_KEY,
  PIXEL_SCRIPT,
  PURCHASE_STORAGE_PREFIX,
  CLICK_ID_VALUE_MAX,
  CONSENT_NOTICE_VERSION,
  MARKETING_COOKIE_NAMES,
  UTM_VALUE_MAX,
  captureAttributionFromSearch,
  canTrack,
  getAttributionForCheckout,
  getCheckoutTrackingFields,
  getConsentChoice,
  getStoredAttribution,
  hasMarketingConsent,
  loadPixelsIfAllowed,
  parseAttributionParams,
  purchaseAlreadyFired,
  purchaseEventId,
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

  it("dispara uma vez por session_id, com event_id derivado (hash) do session Stripe", () => {
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
    // O event_id é um hash: o session_id do Stripe (que troca por login) nunca vai ao Meta/TikTok.
    expect(purchases[0][3]).toEqual({ eventID: purchaseEventId(sessionId) });
    expect(JSON.stringify(fbq.queue)).not.toContain(sessionId);

    const ttq = (window as unknown as { ttq: unknown[] }).ttq;
    const complete = (ttq as unknown[]).filter((c) => Array.isArray(c) && c[0] === "track" && c[1] === "CompletePayment");
    expect(complete).toHaveLength(1);
    expect((complete[0] as unknown[])[2]).toMatchObject({ event_id: purchaseEventId(sessionId), value: 297, currency: "BRL" });
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
    resetTrackingForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T03:00:00-03:00"));
    setConsent("granted");
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

  it("trunca utm_* em 100 e click ids em 200, e remove caracteres de controle", () => {
    const long = "x".repeat(600);
    const parsed = parseAttributionParams(new URLSearchParams({ utm_source: `meta\u0000${long}`, fbclid: `fb${long}` }));
    expect(parsed.utm_source?.startsWith("metax")).toBe(true);
    expect(parsed.utm_source?.includes("\u0000")).toBe(false);
    expect(parsed.utm_source).toHaveLength(UTM_VALUE_MAX);
    expect(parsed.fbclid).toHaveLength(CLICK_ID_VALUE_MAX);
  });

  it("descarta valores fora do charset seguro e utm_* que parece e-mail ou telefone", () => {
    const parsed = parseAttributionParams(
      new URLSearchParams({
        utm_source: "joao@example.com",
        utm_medium: "5545999990000",
        utm_campaign: "(11) 99999-0000",
        utm_term: "<script>alert(1)</script>",
        utm_content: "Black Friday_2026-v1.a",
        gclid: "Cj0KCQ_abc-123",
      }),
    );
    expect(parsed).toEqual({ utm_content: "Black Friday_2026-v1.a", gclid: "Cj0KCQ_abc-123" });
  });
});

type FbqCall = { args: unknown[]; href: string };

/** Troca o fbq por um espião que guarda a URL no instante do evento (é isso que o pixel real lê). */
function spyOnFbq(): FbqCall[] {
  const calls: FbqCall[] = [];
  const fbq = (window as unknown as { fbq: { callMethod?: (...a: unknown[]) => void } }).fbq;
  fbq.callMethod = (...args: unknown[]) => calls.push({ args, href: window.location.href });
  return calls;
}

function cookieNames(): string[] {
  return document.cookie
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter(Boolean);
}

describe("tracking: atribuição só com consentimento", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    resetTrackingForTests();
  });

  const SEARCH = "?utm_source=meta&utm_campaign=t3&fbclid=abc123&ttclid=tt1&gclid=g1";

  it("sem escolha e sem ID de pixel: nada vai ao localStorage nem ao checkout", () => {
    setTrackingConfigForTests({ metaPixelId: "", tiktokPixelId: "" });
    expect(captureAttributionFromSearch(SEARCH)).toBeNull();
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(getAttributionForCheckout()).toEqual({});
    expect(getCheckoutTrackingFields()).toEqual({});
  });

  it("recusou: nada é guardado, e um aceite depois não traz de volta o que veio antes", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    setConsent("denied");
    captureAttributionFromSearch(SEARCH);
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(getAttributionForCheckout()).toEqual({});
    setConsent("granted");
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  });

  it("antes da escolha fica só em memória, e vai ao localStorage no aceite", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    captureAttributionFromSearch(SEARCH);
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(getAttributionForCheckout()).toEqual({});
    setConsent("granted");
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).not.toBeNull();
    expect(getAttributionForCheckout()).toMatchObject({ utm_source: "meta", fbclid: "abc123", first_ttclid: "tt1" });
  });

  it("antes da escolha e depois de recusar, a atribuição em memória é descartada", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    captureAttributionFromSearch(SEARCH);
    setConsent("denied");
    setConsent("granted");
    expect(getAttributionForCheckout()).toEqual({});
  });

  it("com aceite, grava e o checkout leva a atribuição, o consentimento e a versão do texto", () => {
    setConsent("granted");
    captureAttributionFromSearch(SEARCH);
    const fields = getCheckoutTrackingFields();
    expect(fields.marketing_consent).toBe(true);
    expect(fields.marketing_consent_notice_version).toBe(CONSENT_NOTICE_VERSION);
    expect(fields.marketing_consent_at).toBeTruthy();
    expect(fields.attribution).toMatchObject({ utm_source: "meta", utm_campaign: "t3", gclid: "g1" });
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) || "{}").notice_version).toBe(CONSENT_NOTICE_VERSION);
  });

  it("com recusa, o checkout leva só a recusa registrada e nenhuma atribuição", () => {
    setConsent("denied");
    const fields = getCheckoutTrackingFields();
    expect(fields).toMatchObject({ marketing_consent: false, marketing_consent_notice_version: CONSENT_NOTICE_VERSION });
    expect(fields.attribution).toBeUndefined();
  });

  it("registro de consentimento de outra versão do texto não vale: volta a perguntar", () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: 1, notice_version: "antiga", choice: "granted", at: "2026-01-01T00:00:00Z" }));
    expect(getConsentChoice()).toBeNull();
    expect(hasMarketingConsent()).toBe(false);
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: 1, choice: "granted", at: "2026-01-01T00:00:00Z" }));
    expect(hasMarketingConsent()).toBe(false);
  });
});

describe("tracking: revogação limpa tudo e o reaceite volta a funcionar", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    window.history.replaceState(null, "", "/");
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "TT456" });
  });

  afterEach(() => {
    for (const name of MARKETING_COOKIE_NAMES) document.cookie = `${name}=; max-age=0; path=/`;
    resetTrackingForTests();
  });

  it("recusar apaga _fbp, _fbc, _ttp e a atribuição, revoga no Meta e no TikTok e pede recarregar", () => {
    setConsent("granted");
    captureAttributionFromSearch("?utm_source=meta&fbclid=abc");
    trackPageView("/");
    document.cookie = "_fbp=fb.1.123; path=/";
    document.cookie = "_fbc=fb.1.123.abc; path=/";
    document.cookie = "_ttp=tt123; path=/";
    document.cookie = "outro=1; path=/";
    expect(cookieNames()).toEqual(expect.arrayContaining(["_fbp", "_fbc", "_ttp", "outro"]));
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).not.toBeNull();

    const result = setConsent("denied");

    expect(result.reloadRecommended).toBe(true);
    const names = cookieNames();
    expect(names).not.toContain("_fbp");
    expect(names).not.toContain("_fbc");
    expect(names).not.toContain("_ttp");
    expect(names).toContain("outro");
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(getAttributionForCheckout()).toEqual({});
    const fbq = (window as unknown as { fbq: { queue: unknown[] } }).fbq;
    expect(fbq.queue).toContainEqual(["consent", "revoke"]);
    const ttq = (window as unknown as { ttq: unknown[] }).ttq;
    expect(ttq).toContainEqual(["revokeConsent"]);
    expect(ttq).toContainEqual(["disableCookie"]);
  });

  it("recusar sem pixel carregado não pede recarregar", () => {
    expect(setConsent("denied").reloadRecommended).toBe(false);
  });

  it("depois de recusar, nenhum evento sai; ao aceitar de novo chama fbq consent grant e os eventos voltam", () => {
    setConsent("granted");
    trackPageView("/");
    setConsent("denied");
    const fbq = (window as unknown as { fbq: { queue: unknown[] } }).fbq;
    const before = fbq.queue.length;
    window.history.replaceState(null, "", "/?x=1");
    trackPageView("/");
    trackViewContentPlans();
    expect(fbq.queue.length).toBe(before);

    window.history.replaceState(null, "", "/");
    setConsent("granted");
    expect(fbq.queue).toContainEqual(["consent", "grant"]);
    expect((window as unknown as { ttq: unknown[] }).ttq).toContainEqual(["grantConsent"]);
    trackViewContentPlans();
    expect(fbq.queue.some((c) => Array.isArray(c) && c[0] === "track" && c[1] === "ViewContent")).toBe(true);
    // O pixel não é inicializado duas vezes.
    expect(fbq.queue.filter((c) => Array.isArray(c) && c[0] === "init")).toHaveLength(1);
  });

  it("o Meta é iniciado sem PageView automático em pushState nem eventos automáticos", () => {
    setConsent("granted");
    const fbq = (window as unknown as { fbq: { queue: unknown[]; disablePushState?: boolean } }).fbq;
    expect(fbq.disablePushState).toBe(true);
    expect(fbq.queue).toContainEqual(["set", "autoConfig", false, "META123"]);
  });
});

describe("tracking: rotas excluídas e URL limpa", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    window.history.replaceState(null, "", "/");
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "TT456" });
    setConsent("granted");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    resetTrackingForTests();
  });

  const pageViews = (calls: FbqCall[]) => calls.filter((c) => c.args[0] === "track" && c.args[1] === "PageView");

  it.each([
    "/login",
    "/login?reset_token=SEGREDO123",
    "/login?first_access=1",
    "/onboarding?session_id=cs_test_SEGREDO",
    "/reagendar/TOKENPUBLICO",
    "/cancelar/TOKENPUBLICO",
    "/b/barbearia-do-ze",
    "/app",
    "/app/clientes",
    "/docs",
    "/privacidade",
    "/qualquer-coisa",
  ])("PageView não dispara em %s", (url) => {
    setConsent("granted");
    window.history.replaceState(null, "", "/");
    trackPageView("/");
    const calls = spyOnFbq();
    window.history.replaceState(null, "", url);
    // O pulo de 1s do dedupe não deve mascarar o resultado.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    trackPageView(url.split("?")[0]);
    trackViewContentPlans();
    vi.useRealTimers();
    expect(pageViews(calls)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("PageView dispara na página inicial e a URL vista pelo pixel não carrega parâmetros desconhecidos", () => {
    trackPageView("/"); // carrega o pixel
    const calls = spyOnFbq();
    window.history.replaceState(null, "", "/?utm_source=meta&fbclid=abc&email=joao%40example.com&reset=1#planos");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    trackPageView("/?utm_source=meta&email=joao%40example.com");
    vi.useRealTimers();
    const views = pageViews(calls);
    expect(views).toHaveLength(1);
    expect(views[0].href).toContain("utm_source=meta");
    expect(views[0].href).toContain("fbclid=abc");
    expect(views[0].href).not.toContain("email");
    expect(views[0].href).not.toContain("reset");
  });

  it("InitiateCheckout não dispara com reset_token, em /app nem em /b/:slug; dispara na landing e no login sem query", () => {
    trackPageView("/");
    const calls = spyOnFbq();
    const initiate = () => calls.filter((c) => c.args[0] === "track" && c.args[1] === "InitiateCheckout");
    for (const url of ["/login?reset_token=SEGREDO", "/app/planos", "/b/slug", "/reagendar/tok"]) {
      window.history.replaceState(null, "", url);
      trackInitiateCheckout("pro");
    }
    expect(initiate()).toHaveLength(0);
    window.history.replaceState(null, "", "/login");
    trackInitiateCheckout("pro");
    window.history.replaceState(null, "", "/");
    trackInitiateCheckout("pro");
    expect(initiate()).toHaveLength(2);
  });

  it("Purchase em /onboarding?session_id=… tira o session_id da URL antes do evento e nunca o envia", () => {
    trackPageView("/");
    const calls = spyOnFbq();
    window.history.replaceState(null, "", "/onboarding?session_id=cs_test_SEGREDO");
    expect(trackPurchase({ sessionId: "cs_test_SEGREDO", plan: "pro", value: 297 })).toBe(true);
    const purchase = calls.find((c) => c.args[0] === "track" && c.args[1] === "Purchase");
    expect(purchase).toBeTruthy();
    expect(purchase!.href).not.toContain("cs_test_SEGREDO");
    expect(JSON.stringify(purchase!.args)).not.toContain("cs_test_SEGREDO");
    expect(window.location.search).toBe("");
  });

  it("Purchase não dispara (e não marca) com reset_token ou fora das páginas permitidas", () => {
    trackPageView("/");
    for (const url of ["/login?reset_token=SEGREDO", "/app/planos"]) {
      window.history.replaceState(null, "", url);
      expect(trackPurchase({ sessionId: "cs_test_x", plan: "pro", value: 297 })).toBe(false);
    }
    expect(purchaseAlreadyFired("cs_test_x")).toBe(false);
  });
});

describe("tracking: sha256 do event_id", () => {
  it("é determinístico e não contém o session_id", () => {
    expect(purchaseEventId("cs_test_1")).toBe(purchaseEventId("cs_test_1"));
    expect(purchaseEventId("cs_test_1")).not.toBe(purchaseEventId("cs_test_2"));
    expect(purchaseEventId("cs_test_1")).not.toContain("cs_test_1");
    expect(purchaseEventId("cs_test_1")).toMatch(/^purchase_[0-9a-f]{40}$/);
  });

  it("bate com o SHA-256 do Node (vetor conhecido de 'abc' e de mensagem longa)", async () => {
    const { createHash } = await import("node:crypto");
    for (const msg of ["abc", "cs_test_a1b2c3", "x".repeat(200), "ç".repeat(70)]) {
      const expected = createHash("sha256").update(msg).digest("hex").slice(0, 40);
      expect(purchaseEventId(msg)).toBe(`purchase_${expected}`);
    }
  });
});
