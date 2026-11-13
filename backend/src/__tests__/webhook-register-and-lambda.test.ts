import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInstanceWebhookBody, setInstanceWebhook } from "../integrations/whatsapp/evolution-client.js";
import { setWebhook } from "../integrations/uazapi/client.js";

const MASTER = "chave-mestra-evolution";
const DEDICATED = "segredo-dedicado-webhook";

describe("registro do webhook: payload de setInstanceWebhook / setWebhook", () => {
  const saved = { ...process.env };
  const calls: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.EVOLUTION_API_URL = "http://evolution.test";
    process.env.EVOLUTION_API_KEY = MASTER;
    process.env.WHATSAPP_WEBHOOK_SECRET = DEDICATED;
    delete process.env.EVOLUTION_WEBHOOK_TOKEN_IN_URL;
    process.env.UAZAPI_BASE_URL = "http://uazapi.test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("Evolution: segredo dedicado no cabeçalho apikey do webhook; URL limpa; chave mestra só autentica a chamada à API", async () => {
    await setInstanceWebhook("navalhia-abc", "https://api.test/api/webhooks/evolution");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://evolution.test/webhook/set/navalhia-abc");
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(MASTER); // auth da API Evolution
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.webhook.url).toBe("https://api.test/api/webhooks/evolution");
    expect(body.webhook.headers).toEqual({ apikey: DEDICATED });
    expect(JSON.stringify(body)).not.toContain(MASTER);
    expect(body.webhook.enabled).toBe(true);
    expect(body.webhook.events).toContain("MESSAGES_UPSERT");
  });

  it("Evolution: sem WHATSAPP_WEBHOOK_SECRET não há header nem token (e a chave mestra não vira fallback)", () => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    const b = buildInstanceWebhookBody("https://api.test/w");
    expect(b.webhook.headers).toBeUndefined();
    expect(b.webhook.url).toBe("https://api.test/w");
    expect(JSON.stringify(b)).not.toContain(MASTER);
  });

  it("Evolution: EVOLUTION_WEBHOOK_TOKEN_IN_URL=true acrescenta ?token= com o segredo dedicado (nunca a chave mestra)", () => {
    process.env.EVOLUTION_WEBHOOK_TOKEN_IN_URL = "true";
    const b = buildInstanceWebhookBody("https://api.test/w");
    expect(b.webhook.url).toBe(`https://api.test/w?token=${DEDICATED}`);
    expect(b.legacy.url).toBe(`https://api.test/w?token=${DEDICATED}`);
    expect(JSON.stringify(b)).not.toContain(MASTER);
  });

  it("Evolution: formato legado (fallback) mantém header e URL limpa", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response("bad", { status: 400 });
    });
    await setInstanceWebhook("navalhia-abc", "https://api.test/w");
    expect(calls).toHaveLength(2);
    const legacy = JSON.parse(String(calls[1]!.init.body));
    expect(legacy.url).toBe("https://api.test/w");
    expect(legacy.headers).toEqual({ apikey: DEDICATED });
  });

  it("Uazapi: segredo dedicado em ?token= na URL registrada (não há cabeçalho próprio)", async () => {
    await setWebhook({ token: "inst-token", url: "https://api.test/api/webhooks/uazapi" });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.url).toBe(`https://api.test/api/webhooks/uazapi?token=${DEDICATED}`);
    expect(JSON.stringify(body)).not.toContain(MASTER);
  });
});

describe("handler Lambda: corpo em base64 (API Gateway) preserva a assinatura da Meta", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  function event(body: string, opts: { signature?: string; base64: boolean }) {
    return {
      version: "2.0",
      routeKey: "$default",
      rawPath: "/api/webhooks/whatsapp",
      rawQueryString: "",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
        ...(opts.signature ? { "x-hub-signature-256": opts.signature } : {}),
      },
      requestContext: { http: { method: "POST", path: "/api/webhooks/whatsapp", sourceIp: "10.9.0.1" } },
      isBase64Encoded: opts.base64,
      body: opts.base64 ? Buffer.from(body, "utf8").toString("base64") : body,
    };
  }
  const sig = (b: string, secret = "app-secret") => "sha256=" + crypto.createHmac("sha256", secret).update(b).digest("hex");

  it("base64 + assinatura válida → 200; base64 adulterado/outra assinatura → 401", async () => {
    const { handler } = await import("../lambda.js");
    // corpo com acentos e emoji: a assinatura cobre os BYTES originais, não uma re-serialização
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", text: "olá, açaí 🙂" }] });
    const call = (e: unknown) => (handler as unknown as (e: unknown, c: unknown) => Promise<{ statusCode: number }>)(e, {});

    expect((await call(event(body, { signature: sig(body), base64: true }))).statusCode).toBe(200);
    expect((await call(event(body, { signature: sig(body), base64: false }))).statusCode).toBe(200);
    const tampered = body.replace("açaí", "acai");
    expect((await call(event(tampered, { signature: sig(body), base64: true }))).statusCode).toBe(401);
    expect((await call(event(body, { signature: sig(body, "outro"), base64: true }))).statusCode).toBe(401);
    expect((await call(event(body, { base64: true }))).statusCode).toBe(401);
  });

  it("sem WHATSAPP_APP_SECRET → 503 mesmo com base64", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const { handler } = await import("../lambda.js");
    const body = JSON.stringify({ object: "page" });
    const r = await (handler as unknown as (e: unknown, c: unknown) => Promise<{ statusCode: number }>)(
      event(body, { signature: sig(body), base64: true }),
      {},
    );
    expect(r.statusCode).toBe(503);
  });
});
