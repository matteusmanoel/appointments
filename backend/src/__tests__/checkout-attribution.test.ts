import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_METADATA_KEYS,
  attributionMetadata,
  checkoutAttribution,
  CLICK_ID_VALUE_MAX,
  marketingConsentMetadata,
  sanitizeAttributionValue,
  UTM_VALUE_MAX,
} from "../lib/checkout-attribution.js";
import request from "supertest";
import { beforeEach, vi } from "vitest";

const created: Record<string, unknown>[] = [];
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_tests";
  process.env.STRIPE_PRICE_ID_PRO = "price_pro_fake";
});
vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          created.push(args);
          return { url: "https://checkout.example/s", client_secret: "cs_fake" };
        },
      },
    };
    webhooks = { constructEvent: () => ({}) };
  }
  return { default: FakeStripe };
});

import { app } from "../app.js";

const body = {
  barbershop_name: "Barbearia Teste",
  phone: "5545999990000",
  email: "dono@example.test",
  plan: "pro",
  whatsapp_risk_accepted: true,
};

const attribution = {
  utm_source: "meta",
  utm_medium: "paid",
  utm_campaign: "navalhia_t3",
  utm_term: "barbearia",
  utm_content: "ad1",
  fbclid: "fb.abc",
  ttclid: "tt.xyz",
  gclid: "g.123",
  first_utm_source: "tiktok",
  first_utm_medium: "paid",
  first_utm_campaign: "t3_launch",
  first_fbclid: "fb.first",
  first_ttclid: "tt.first",
  // deve ser ignorado:
  plan: "premium",
  barbershop_name: "Hacker",
  evil: "drop-me",
  phone: "000",
};

let n = 0;
const post = (path: string, b: object) =>
  request(app).post(path).set("x-forwarded-for", `10.78.${Math.floor(n / 250)}.${(n++ % 250) + 1}`).send(b);

describe("attributionMetadata (sanitização)", () => {
  it("mantém só as chaves da whitelist, em minúsculas, e trunca utm_* em 100 e click ids em 200", () => {
    const long = "z".repeat(600);
    const out = attributionMetadata({
      UTM_SOURCE: "Meta",
      utm_campaign: `camp\u0000${long}`,
      evil: "nope",
      plan: "premium",
      fbclid: "  click-1  ",
      gclid: `g${long}`,
      empty: "",
    });
    expect(out.utm_source).toBe("Meta");
    expect(out.plan).toBeUndefined();
    expect(out.evil).toBeUndefined();
    expect(out.fbclid).toBe("click-1");
    expect(out.utm_campaign).toHaveLength(UTM_VALUE_MAX);
    expect(out.gclid).toHaveLength(CLICK_ID_VALUE_MAX);
    expect(out.utm_campaign?.includes("\u0000")).toBe(false);
    expect(Object.keys(out).every((k) => (ATTRIBUTION_METADATA_KEYS as readonly string[]).includes(k))).toBe(true);
  });

  it("descarta valores com e-mail, telefone, HTML ou objetos; aceita charset seguro", () => {
    const out = attributionMetadata({
      utm_source: "joao@example.com",
      utm_medium: "5545999990000",
      utm_campaign: "(45) 99999-0000",
      utm_term: "<script>alert(1)</script>",
      utm_content: "Black Friday_2026-v1.a",
      first_utm_source: { nested: "x" },
      gclid: "Cj0KCQ_abc-123",
    });
    expect(out).toEqual({ utm_content: "Black Friday_2026-v1.a", gclid: "Cj0KCQ_abc-123" });
  });

  it("ignora entrada que não é objeto", () => {
    expect(attributionMetadata(null)).toEqual({});
    expect(attributionMetadata("utm_source=meta")).toEqual({});
    expect(attributionMetadata(["utm_source", "meta"])).toEqual({});
    expect(sanitizeAttributionValue("  ")).toBeUndefined();
  });
});

describe("checkout: UTMs vão para o metadata da sessão Stripe e da assinatura", () => {
  beforeEach(() => {
    created.length = 0;
    delete process.env.CHECKOUT_REQUIRE_RISK_ACCEPTANCE;
  });

  it("nas duas rotas, as chaves permitidas entram em metadata e subscription_data.metadata", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/checkout_embedded"]) {
      const r = await post(path, { ...body, attribution, marketing_consent: true, marketing_consent_notice_version: "2026-11-14", marketing_consent_at: "2026-11-14T03:00:00.000Z" });
      expect(r.status).toBe(200);
    }
    expect(created).toHaveLength(2);
    for (const c of created) {
      const md = c.metadata as Record<string, string>;
      const sub = (c.subscription_data as { metadata: Record<string, string> }).metadata;
      expect(md.plan).toBe("pro");
      expect(md.barbershop_name).toBe("Barbearia Teste");
      expect(md.phone).toBe("5545999990000");
      expect(md.marketing_consent).toBe("granted");
      expect(md.marketing_consent_notice_version).toBe("2026-11-14");
      expect(md.marketing_consent_at).toBe("2026-11-14T03:00:00.000Z");
      expect(md.utm_source).toBe("meta");
      expect(md.utm_medium).toBe("paid");
      expect(md.utm_campaign).toBe("navalhia_t3");
      expect(md.utm_term).toBe("barbearia");
      expect(md.utm_content).toBe("ad1");
      expect(md.fbclid).toBe("fb.abc");
      expect(md.ttclid).toBe("tt.xyz");
      expect(md.gclid).toBe("g.123");
      expect(md.first_utm_source).toBe("tiktok");
      expect(md.first_utm_campaign).toBe("t3_launch");
      expect(md.first_fbclid).toBe("fb.first");
      expect(md.evil).toBeUndefined();
      expect(sub).toMatchObject({
        utm_source: "meta",
        utm_campaign: "navalhia_t3",
        fbclid: "fb.abc",
        first_utm_source: "tiktok",
        first_ttclid: "tt.first",
      });
      expect(sub.plan).toBeUndefined();
      expect(sub.barbershop_name).toBeUndefined();
      expect(sub.evil).toBeUndefined();
    }
  });

  it("sem attribution não envia subscription_data e não quebra o checkout", async () => {
    const r = await post("/api/billing/checkout", body);
    expect(r.status).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0]!.subscription_data).toBeUndefined();
    const md = created[0]!.metadata as Record<string, string>;
    expect(md.plan).toBe("pro");
    expect(md.utm_source).toBeUndefined();
  });
});

describe("checkout: atribuição só com consentimento explícito", () => {
  beforeEach(() => {
    created.length = 0;
    delete process.env.CHECKOUT_REQUIRE_RISK_ACCEPTANCE;
  });

  const ATTR_KEYS = [...ATTRIBUTION_METADATA_KEYS] as string[];
  const attrKeysIn = (md: Record<string, string>) => Object.keys(md).filter((k) => ATTR_KEYS.includes(k));

  it("com attribution mas sem a flag marketing_consent, nada de atribuição vai ao Stripe", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/checkout_embedded"]) {
      const r = await post(path, { ...body, attribution });
      expect(r.status).toBe(200);
    }
    expect(created).toHaveLength(2);
    for (const c of created) {
      expect(attrKeysIn(c.metadata as Record<string, string>)).toEqual([]);
      expect(c.subscription_data).toBeUndefined();
      expect((c.metadata as Record<string, string>).marketing_consent).toBeUndefined();
    }
  });

  it("com marketing_consent: false, nada de atribuição, e a recusa fica registrada com a versão do texto", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/checkout_embedded"]) {
      const r = await post(path, { ...body, attribution, marketing_consent: false, marketing_consent_notice_version: "2026-11-14" });
      expect(r.status).toBe(200);
    }
    for (const c of created) {
      const md = c.metadata as Record<string, string>;
      expect(attrKeysIn(md)).toEqual([]);
      expect(c.subscription_data).toBeUndefined();
      expect(md.marketing_consent).toBe("denied");
      expect(md.marketing_consent_notice_version).toBe("2026-11-14");
      expect(md.plan).toBe("pro");
    }
  });

  it("marketing_consent que não é booleano é rejeitado (400), não vira consentimento", async () => {
    const r = await post("/api/billing/checkout", { ...body, attribution, marketing_consent: "true" });
    expect(r.status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("o cliente não consegue sobrescrever as chaves de consentimento pela attribution", async () => {
    const r = await post("/api/billing/checkout", {
      ...body,
      marketing_consent: true,
      attribution: { utm_source: "meta", marketing_consent: "granted", marketing_consent_at: "2000-01-01" },
    });
    expect(r.status).toBe(200);
    const md = created[0]!.metadata as Record<string, string>;
    expect(md.marketing_consent).toBe("granted");
    expect(md.marketing_consent_at).toBeUndefined();
    expect(md.utm_source).toBe("meta");
  });
});

describe("checkoutAttribution / marketingConsentMetadata", () => {
  it("exige marketing_consent === true", () => {
    expect(checkoutAttribution({ attribution: { utm_source: "x" } })).toEqual({});
    expect(checkoutAttribution({ attribution: { utm_source: "x" }, marketing_consent: false })).toEqual({});
    expect(checkoutAttribution({ attribution: { utm_source: "x" }, marketing_consent: true })).toEqual({ utm_source: "x" });
  });

  it("registra só o que é válido: data inválida e versão com charset estranho são descartadas", () => {
    expect(marketingConsentMetadata({})).toEqual({});
    expect(marketingConsentMetadata({ marketing_consent: true, marketing_consent_at: "lixo", marketing_consent_notice_version: "a@b.c" })).toEqual({
      marketing_consent: "granted",
    });
  });
});
