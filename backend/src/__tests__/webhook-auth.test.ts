import crypto from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { checkWebhookSecret, getWebhookSecret, verifyMetaSignature, withWebhookToken } from "../integrations/whatsapp/webhook-auth.js";

describe("webhook-auth (unit)", () => {
  it("fail closed sem segredo", () => {
    expect(checkWebhookSecret({ headers: { apikey: "x" }, query: {} }, "")).toBe("unconfigured");
  });
  it("rejeita cabeçalho ausente e errado; aceita header ou ?token=", () => {
    expect(checkWebhookSecret({ headers: {}, query: {} }, "s3")).toBe("unauthorized");
    expect(checkWebhookSecret({ headers: { apikey: "errada" }, query: {} }, "s3")).toBe("unauthorized");
    expect(checkWebhookSecret({ headers: { apikey: "s3" }, query: {} }, "s3")).toBe("ok");
    expect(checkWebhookSecret({ headers: {}, query: { token: "s3" } }, "s3")).toBe("ok");
  });
  it("segredo: WHATSAPP_WEBHOOK_SECRET, com EVOLUTION_API_KEY só como fallback da Evolution", () => {
    expect(getWebhookSecret("uazapi", { EVOLUTION_API_KEY: "e" })).toBe("");
    expect(getWebhookSecret("evolution", { EVOLUTION_API_KEY: "e" })).toBe("e");
    expect(getWebhookSecret("uazapi", { WHATSAPP_WEBHOOK_SECRET: "w", EVOLUTION_API_KEY: "e" })).toBe("w");
  });
  it("withWebhookToken acrescenta o token", () => {
    expect(withWebhookToken("https://x.test/api/webhooks/uazapi", "abc")).toBe("https://x.test/api/webhooks/uazapi?token=abc");
    expect(withWebhookToken("https://x.test/a", "")).toBe("https://x.test/a");
  });
  it("assinatura da Meta", () => {
    const body = '{"a":1}';
    const sig = "sha256=" + crypto.createHmac("sha256", "app").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "app")).toBe(true);
    expect(verifyMetaSignature(body, sig, "outro")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "app")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false);
  });
});

describe("webhooks de WhatsApp (HTTP)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.WHATSAPP_APP_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("Evolution/Uazapi: 503 quando o segredo não está configurado", async () => {
    expect((await request(app).post("/api/webhooks/evolution").send({})).status).toBe(503);
    expect((await request(app).post("/api/webhooks/uazapi").send({})).status).toBe(503);
  });

  it("Evolution: sem cabeçalho → 401; errado → 401; correto → 200", async () => {
    process.env.EVOLUTION_API_KEY = "chave";
    expect((await request(app).post("/api/webhooks/evolution").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "errada").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "chave").send({})).status).toBe(200);
  });

  it("Uazapi: exige ?token=", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "segredo";
    expect((await request(app).post("/api/webhooks/uazapi").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/uazapi?token=segredo").send({})).status).toBe(200);
  });

  it("Meta: POST sem assinatura → 401/503; com assinatura válida → 200", async () => {
    expect((await request(app).post("/api/webhooks/whatsapp").send({})).status).toBe(503);
    process.env.WHATSAPP_APP_SECRET = "app";
    expect((await request(app).post("/api/webhooks/whatsapp").send({})).status).toBe(401);
    const body = JSON.stringify({ object: "page" });
    const sig = "sha256=" + crypto.createHmac("sha256", "app").update(body).digest("hex");
    const ok = await request(app).post("/api/webhooks/whatsapp").set("content-type", "application/json").set("x-hub-signature-256", sig).send(body);
    expect(ok.status).toBe(200);
  });
});
