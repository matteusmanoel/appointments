import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { riskAcceptanceMetadata, riskAcceptanceRequired, WHATSAPP_RISK_NOTICE_VERSION } from "../routes/billing.js";

const body = {
  barbershop_name: "Barbearia Teste",
  phone: "5545999990000",
  email: "dono@example.test",
  plan: "pro",
};
let n = 0;
const post = (path: string, b: object) =>
  request(app).post(path).set("x-forwarded-for", `10.77.${Math.floor(n / 250)}.${(n++ % 250) + 1}`).send(b);

describe("aceite do aviso de risco do WhatsApp no checkout (servidor)", () => {
  beforeEach(() => {
    created.length = 0;
    delete process.env.CHECKOUT_REQUIRE_RISK_ACCEPTANCE;
  });

  it("sem aceite → 400 com código, nas duas rotas, e nenhuma sessão é criada", async () => {
    for (const path of ["/api/billing/checkout", "/api/billing/checkout_embedded"]) {
      for (const extra of [{}, { whatsapp_risk_accepted: false }]) {
        const r = await post(path, { ...body, ...extra });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe("whatsapp_risk_not_accepted");
      }
    }
    expect(created).toHaveLength(0);
  });

  it("com aceite → cria a sessão e grava quando/qual versão no metadata do Stripe", async () => {
    // A UI manda a versão do texto que exibiu; o servidor grava essa versão na sessão do Stripe.
    const r1 = await post("/api/billing/checkout", {
      ...body,
      whatsapp_risk_accepted: true,
      whatsapp_risk_notice_version: WHATSAPP_RISK_NOTICE_VERSION,
    });
    expect(r1.status).toBe(200);
    const r2 = await post("/api/billing/checkout_embedded", { ...body, whatsapp_risk_accepted: true });
    expect(r2.status).toBe(200);
    expect(created).toHaveLength(2);
    for (const c of created) {
      const md = c.metadata as Record<string, string>;
      expect(md.whatsapp_risk_accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(md.whatsapp_risk_notice_version).toBe(WHATSAPP_RISK_NOTICE_VERSION);
    }
  });

  it("aceite com tipo errado ('true' string) não vale", async () => {
    const r = await post("/api/billing/checkout", { ...body, whatsapp_risk_accepted: "true" });
    expect(r.status).toBe(400);
  });

  it("CHECKOUT_REQUIRE_RISK_ACCEPTANCE=false desliga a exigência (janela de deploy) e não grava metadata", async () => {
    process.env.CHECKOUT_REQUIRE_RISK_ACCEPTANCE = "false";
    expect(riskAcceptanceRequired()).toBe(false);
    const r = await post("/api/billing/checkout", body);
    expect(r.status).toBe(200);
    expect((created[0]!.metadata as Record<string, string>).whatsapp_risk_accepted_at).toBeUndefined();
  });

  it("riskAcceptanceMetadata grava a versão que a UI exibiu (mesmo antiga) e cai na atual quando ela não manda", () => {
    expect(
      riskAcceptanceMetadata({ whatsapp_risk_accepted: true, whatsapp_risk_notice_version: "2026-11-13" }).whatsapp_risk_notice_version,
    ).toBe("2026-11-13");
    expect(riskAcceptanceMetadata({ whatsapp_risk_accepted: true }).whatsapp_risk_notice_version).toBe(WHATSAPP_RISK_NOTICE_VERSION);
  });

  it("riskAcceptanceMetadata só existe com aceite explícito", () => {
    expect(riskAcceptanceMetadata({})).toEqual({});
    expect(riskAcceptanceMetadata({ whatsapp_risk_accepted: false })).toEqual({});
    expect(riskAcceptanceMetadata({ whatsapp_risk_accepted: true }, new Date("2026-11-13T12:00:00Z"))).toEqual({
      whatsapp_risk_accepted_at: "2026-11-13T12:00:00.000Z",
      whatsapp_risk_notice_version: WHATSAPP_RISK_NOTICE_VERSION,
    });
  });
});
