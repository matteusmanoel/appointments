import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConsentBanner } from "./ConsentBanner";
import { SiteFooter } from "./SiteFooter";
import { TrackingRoot } from "./TrackingRoot";
import {
  ATTRIBUTION_STORAGE_KEY,
  CONSENT_NOTICE_VERSION,
  CONSENT_STORAGE_KEY,
  getConsentChoice,
  resetTrackingForTests,
  setTrackingConfigForTests,
} from "@/lib/tracking";

function renderBanner(initial = "/") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ConsentBanner />
    </MemoryRouter>,
  );
}

describe("ConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    resetTrackingForTests();
  });

  it("não aparece sem ID de pixel", () => {
    setTrackingConfigForTests({ metaPixelId: "", tiktokPixelId: "" });
    renderBanner();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cita Meta, TikTok, Stripe, atribuição, transferência internacional e linka a política", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    renderBanner();
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    for (const term of ["Meta", "TikTok", "Stripe", "UTM", "identificadores de clique", "90 dias", "transferência internacional"]) {
      expect(text).toContain(term);
    }
    const link = screen.getByRole("link", { name: /Política de Privacidade/i });
    expect(link.getAttribute("href")).toBe("/privacidade");
  });

  it("Aceitar e Recusar têm exatamente o mesmo estilo", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    renderBanner();
    const accept = screen.getByRole("button", { name: "Aceitar" });
    const refuse = screen.getByRole("button", { name: "Recusar" });
    expect(accept.className).toBe(refuse.className);
  });

  it("Aceitar grava a escolha com a versão do texto; Recusar também, e nada de atribuição fica", () => {
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
    window.history.replaceState(null, "", "/?utm_source=meta&fbclid=abc");
    const { unmount } = renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(getConsentChoice()).toBe("granted");
    const saved = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) || "{}");
    expect(saved.notice_version).toBe(CONSENT_NOTICE_VERSION);
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toContain("meta");
    unmount();

    renderBanner();
    // já escolheu: o banner não reabre sozinho
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent(window, new Event("navalhia:consent-open"));
    const original = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
    expect(getConsentChoice()).toBe("denied");
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    // havia pixel carregado: recarrega para descarregar os scripts da Meta
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("TrackingRoot + rodapé", () => {
  beforeEach(() => {
    localStorage.clear();
    resetTrackingForTests();
    document.head.innerHTML = "";
    window.history.replaceState(null, "", "/");
    setTrackingConfigForTests({ metaPixelId: "META123", tiktokPixelId: "" });
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    resetTrackingForTests();
  });

  it("sem aceite, limpa atribuição e cookies de uma visita anterior e não guarda a da visita atual", () => {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify({ v: 1, first: { utm_source: "x" }, last: {}, firstAt: Date.now(), lastAt: Date.now() }));
    document.cookie = "_fbp=fb.1.1; path=/";
    window.history.replaceState(null, "", "/?utm_source=meta");
    render(
      <MemoryRouter initialEntries={["/?utm_source=meta"]}>
        <TrackingRoot />
      </MemoryRouter>,
    );
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain("_fbp");
    expect(document.getElementById("navalhia-meta-pixel")).toBeNull();
  });

  it("com aceite, só a página inicial dispara PageView; /login?reset_token não envia nada", () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ v: 1, notice_version: CONSENT_NOTICE_VERSION, choice: "granted", at: new Date().toISOString() }),
    );
    window.history.replaceState(null, "", "/login?reset_token=SEGREDO");
    render(
      <MemoryRouter initialEntries={["/login?reset_token=SEGREDO"]}>
        <TrackingRoot />
      </MemoryRouter>,
    );
    const fbq = (window as unknown as { fbq?: { queue: unknown[] } }).fbq;
    const tracked = (fbq?.queue ?? []).filter((c) => Array.isArray(c) && c[0] === "track");
    expect(tracked).toHaveLength(0);
    expect(window.location.search).toBe("?reset_token=SEGREDO");
  });

  it("o rodapé tem o link da Política de Privacidade e o atalho Cookies", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Política de Privacidade" }).getAttribute("href")).toBe("/privacidade");
    expect(screen.getByRole("button", { name: "Cookies" })).toBeTruthy();
  });
});
