import crypto from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import {
  checkWebhookSecret,
  getAcceptedMetaAppSecrets,
  getAcceptedWebhookSecrets,
  getWebhookSecret,
  maskWebhookSecret,
  redactWebhookSecrets,
  verifyMetaSignature,
  webhookErrorText,
  withWebhookToken,
} from "../integrations/whatsapp/webhook-auth.js";

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
  it("segredo: só WHATSAPP_WEBHOOK_SECRET; EVOLUTION_API_KEY NÃO é fallback (nenhum provedor)", () => {
    expect(getWebhookSecret("evolution", { EVOLUTION_API_KEY: "e" })).toBe("");
    expect(getWebhookSecret("uazapi", { EVOLUTION_API_KEY: "e" })).toBe("");
    expect(getWebhookSecret("evolution", { WHATSAPP_WEBHOOK_SECRET: "w", EVOLUTION_API_KEY: "e" })).toBe("w");
    expect(getAcceptedWebhookSecrets({ EVOLUTION_API_KEY: "e" })).toEqual([]);
  });
  it("rotação: aceita atual e anterior; o anterior sozinho não basta", () => {
    expect(getAcceptedWebhookSecrets({ WHATSAPP_WEBHOOK_SECRET: "novo", WHATSAPP_WEBHOOK_SECRET_PREVIOUS: "velho" })).toEqual(["novo", "velho"]);
    expect(getAcceptedWebhookSecrets({ WHATSAPP_WEBHOOK_SECRET_PREVIOUS: "velho" })).toEqual([]);
    expect(getAcceptedWebhookSecrets({ WHATSAPP_WEBHOOK_SECRET: "x", WHATSAPP_WEBHOOK_SECRET_PREVIOUS: "x" })).toEqual(["x"]);
    const both = ["novo", "velho"];
    expect(checkWebhookSecret({ headers: { apikey: "velho" }, query: {} }, both)).toBe("ok");
    expect(checkWebhookSecret({ headers: { apikey: "novo" }, query: {} }, both)).toBe("ok");
    expect(checkWebhookSecret({ headers: { apikey: "terceiro" }, query: {} }, both)).toBe("unauthorized");
    expect(getAcceptedMetaAppSecrets({ WHATSAPP_APP_SECRET: "a", WHATSAPP_APP_SECRET_PREVIOUS: "b" })).toEqual(["a", "b"]);
    expect(getAcceptedMetaAppSecrets({ WHATSAPP_APP_SECRET_PREVIOUS: "b" })).toEqual([]);
  });
  it("aceita também os cabeçalhos x-api-key e x-webhook-secret; rejeita valor errado neles", () => {
    expect(checkWebhookSecret({ headers: { "x-api-key": "s3" }, query: {} }, "s3")).toBe("ok");
    expect(checkWebhookSecret({ headers: { "x-webhook-secret": "s3" }, query: {} }, "s3")).toBe("ok");
    expect(checkWebhookSecret({ headers: { "x-api-key": "outro" }, query: {} }, "s3")).toBe("unauthorized");
    expect(checkWebhookSecret({ headers: { "x-webhook-secret": "" }, query: {} }, "s3")).toBe("unauthorized");
  });
  it("withWebhookToken preserva a query que a URL já tem e substitui um ?token= antigo", () => {
    expect(withWebhookToken("https://x.test/w?a=1", "abc")).toBe("https://x.test/w?a=1&token=abc");
    expect(withWebhookToken("https://x.test/w?token=velho&a=1", "novo")).toBe("https://x.test/w?token=novo&a=1");
    expect(withWebhookToken("https://x.test/w", "")).toBe("https://x.test/w"); // sem segredo: URL intacta
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
    expect(verifyMetaSignature(body, sig, ["velho", "app"])).toBe(true);
    expect(verifyMetaSignature(body, sig, [])).toBe(false);
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
    process.env.WHATSAPP_WEBHOOK_SECRET = "chave";
    expect((await request(app).post("/api/webhooks/evolution").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "errada").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "chave").send({})).status).toBe(200);
  });

  it("Evolution: EVOLUTION_API_KEY sozinha NÃO autentica o webhook (fallback removido)", async () => {
    process.env.EVOLUTION_API_KEY = "mestra";
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "mestra").send({})).status).toBe(503);
    process.env.WHATSAPP_WEBHOOK_SECRET = "dedicado";
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "mestra").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/evolution?token=mestra").send({})).status).toBe(401);
  });

  it("rotação via HTTP: o segredo anterior só vale com WHATSAPP_WEBHOOK_SECRET definido", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET_PREVIOUS = "velho";
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "velho").send({})).status).toBe(503);
    process.env.WHATSAPP_WEBHOOK_SECRET = "novo";
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "velho").send({})).status).toBe(200);
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "novo").send({})).status).toBe(200);
    expect((await request(app).post("/api/webhooks/uazapi?token=velho").send({})).status).toBe(200);
    delete process.env.WHATSAPP_WEBHOOK_SECRET_PREVIOUS;
    expect((await request(app).post("/api/webhooks/evolution").set("apikey", "velho").send({})).status).toBe(401);
  });

  it("Uazapi: token errado, vazio ou de outro provedor → 401; cabeçalho também aceito", async () => {
    process.env.WHATSAPP_WEBHOOK_SECRET = "segredo";
    expect((await request(app).post("/api/webhooks/uazapi?token=errado").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/uazapi?token=").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/uazapi?token=segredo%20").send({})).status).toBe(401);
    expect((await request(app).post("/api/webhooks/uazapi").set("apikey", "segredo").send({})).status).toBe(200);
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

describe("webhook Meta: assinatura errada e corpo adulterado", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = "app";
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  const sign = (body: string, secret = "app") => "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  const post = (body: string, sig?: string) => {
    const r = request(app).post("/api/webhooks/whatsapp").set("content-type", "application/json");
    if (sig) r.set("x-hub-signature-256", sig);
    return r.send(body);
  };

  it("assinatura com outro segredo → 401", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect((await post(body, sign(body, "outro"))).status).toBe(401);
  });
  it("corpo adulterado depois de assinado → 401", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const sig = sign(body);
    expect((await post(body.replace("entry", "entrx"), sig)).status).toBe(401);
    expect((await post(body + " ", sig)).status).toBe(401);
  });
  it("assinatura sem prefixo sha256= ou truncada → 401; válida → 200", async () => {
    const body = JSON.stringify({ object: "page" });
    expect((await post(body, sign(body).replace("sha256=", ""))).status).toBe(401);
    expect((await post(body, sign(body).slice(0, -4))).status).toBe(401);
    expect((await post(body, sign(body))).status).toBe(200);
  });
  it("rotação do App Secret: aceita a assinatura com o anterior", async () => {
    process.env.WHATSAPP_APP_SECRET_PREVIOUS = "velho";
    const body = JSON.stringify({ object: "page" });
    expect((await post(body, sign(body, "velho"))).status).toBe(200);
    expect((await post(body, sign(body, "terceiro"))).status).toBe(401);
  });
});

describe("GET /api/public/:slug não expõe o id da barbearia", () => {
  it("a resposta não contém id (o nome da instância do WhatsApp deriva dele)", async () => {
    const { pool } = await import("../db.js");
    try {
      await pool.query("SELECT 1");
    } catch {
      return; // sem banco: nada a verificar
    }
    const slug = `test-pubid-${Date.now()}`;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Teste id público', '5511999990000', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [slug],
    );
    try {
      const res = await request(app).get(`/api/public/${slug}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(r.rows[0]!.id);
    } finally {
      await pool.query("DELETE FROM public.barbershops WHERE id = $1", [r.rows[0]!.id]);
    }
  });
});

describe("redação do segredo (erros, logs, script)", () => {
  const SECRET = "super-secret-webhook-value-xyz";
  const env = { WHATSAPP_WEBHOOK_SECRET: SECRET, WHATSAPP_WEBHOOK_SECRET_PREVIOUS: "previous-secret-aaa" };

  it("maskWebhookSecret não ecoa o valor: só tamanho e SHA-256 curto", () => {
    const masked = maskWebhookSecret(SECRET);
    expect(masked).toMatch(new RegExp(`^sha256:[0-9a-f]{6}… \\(${SECRET.length} chars\\)$`));
    expect(masked).not.toContain(SECRET);
    expect(masked).not.toContain(SECRET.slice(0, 2));
    expect(masked).not.toContain(SECRET.slice(-2));
    expect(maskWebhookSecret("")).toBe("(vazio)");
  });

  it("redactWebhookSecrets remove token= e o valor do segredo (atual, anterior e encoded)", () => {
    const url = `https://api.test/w?token=${SECRET}&x=1`;
    const out = redactWebhookSecrets(
      `falhou ao configurar apontando para: ${url} secret=${SECRET}`,
      env
    );
    expect(out).not.toContain(SECRET);
    expect(out).toContain("token=[redacted]");
    expect(out).toContain("secret=[redacted]");
    expect(redactWebhookSecrets(`token=${encodeURIComponent("previous-secret-aaa")}`, env)).not.toContain("previous-secret-aaa");
    expect(redactWebhookSecrets("https://api.test/w?token%3D" + SECRET, env)).not.toContain(SECRET);
  });

  it("webhookErrorText reda a mensagem; last_error, detail e linha do script ficam limpos", () => {
    const err = new Error(
      "Uazapi retornou 405 (Method Not Allowed) em todos os endpoints de webhook testados. " +
        "Configure o webhook manualmente no painel da Uazapi (ex.: severo.uazapi.com) para esta instância, " +
        `apontando para: https://api.test/api/webhooks/uazapi?token=${SECRET}`
    );
    const detail = webhookErrorText(err, env);
    const lastError = `Webhook não configurado: ${detail}`.slice(0, 500);
    const scriptLine = `  ! shop-id uazapi: ${detail}`;
    for (const s of [detail, lastError, scriptLine]) {
      expect(s).not.toContain(SECRET);
      expect(s).not.toMatch(/token=(?!\[redacted\])/);
    }
    expect(detail).toContain("apontando para: https://api.test/api/webhooks/uazapi?token=[redacted]");
  });
});
