import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";
import {
  API_KEY_MIN_SECRET_BITS,
  LEGACY_API_KEY_SCAN_MAX_ROWS,
  LEGACY_SCAN_MAX_PER_WINDOW,
  __resetLegacyScanGuards,
  apiKeyLookupHash,
  apiKeySecretBits,
  authenticateToolsKey,
  computeApiKeyLookupHash,
  issueApiKey,
  listApiKeysNeedingRotation,
  lookupHashesEqual,
  parseApiKeyPrefix,
  parseApiKeySuffix,
} from "../lib/api-keys.js";
import { ApiKeyPepperError, assertApiKeyLookupPepperConfigured, getApiKeyLookupPepper } from "../lib/api-key-pepper.js";
import { requireToolsKey } from "../middleware/auth.js";

// issueApiKey usa bcrypt com custo 10 (~70 ms cada); com várias suítes rodando juntas o padrão de 5 s estourava.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe("API key: prefixo e hash de lookup (puros)", () => {
  it("extrai o prefixo público de bfk_<id>_… e rejeita formato antigo/inválido", () => {
    const prefix = "11111111-2222-4333-8333-444444444444";
    expect(parseApiKeyPrefix(`bfk_${prefix}_deadbeef`)).toBe(prefix);
    expect(parseApiKeyPrefix("  bfk_abcd1234_secret  ")).toBe("abcd1234");
    expect(parseApiKeyPrefix("tk_nope")).toBeNull();
    expect(parseApiKeyPrefix("")).toBeNull();
  });

  it("HMAC é determinístico; timingSafeEqual aceita iguais e rejeita diferentes/tamanho errado", () => {
    const a = apiKeyLookupHash("bfk_abc_secret");
    const b = apiKeyLookupHash("bfk_abc_secret");
    const c = apiKeyLookupHash("bfk_abc_other");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(lookupHashesEqual(a, b)).toBe(true);
    expect(lookupHashesEqual(a, c)).toBe(false);
    expect(lookupHashesEqual("zz", a)).toBe(false);
  });
});

describe("API key: entropia do sufixo", () => {
  it("chave nova tem sufixo de 128 bits (32 hex), único e com secretBits=128", async () => {
    const keys = await Promise.all(Array.from({ length: 10 }, () => issueApiKey()));
    const suffixes = new Set<string>();
    for (const k of keys) {
      const suffix = parseApiKeySuffix(k.plaintext);
      expect(suffix).toMatch(/^[0-9a-f]{32}$/);
      expect(Buffer.from(suffix!, "hex").length).toBeGreaterThanOrEqual(16);
      expect(k.plaintext).toBe(`bfk_${k.prefix}_${suffix}`);
      expect(k.secretBits).toBe(128);
      expect(apiKeySecretBits(k.plaintext)).toBeGreaterThanOrEqual(API_KEY_MIN_SECRET_BITS);
      expect(k.lookupHash).toMatch(/^[0-9a-f]{64}$/);
      suffixes.add(suffix!);
    }
    expect(suffixes.size).toBe(keys.length);
  });

  it("estima bits e reconhece o formato curto (8 hex = 32 bits) e o legado base36", () => {
    expect(apiKeySecretBits("bfk_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_deadbeef")).toBe(32);
    expect(apiKeySecretBits("bfk_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_k3j9x0pq")).toBe(40);
    expect(apiKeySecretBits("not-a-key")).toBe(0);
    expect(parseApiKeySuffix("not-a-key")).toBeNull();
  });
});

describe("API key: HMAC com pepper", () => {
  const key = "bfk_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_00112233445566778899aabbccddeeff";
  const pepperA = "a".repeat(40);
  const pepperB = "b".repeat(40);

  it("é HMAC-SHA256 hex do pepper sobre a chave, não SHA-256 puro", () => {
    const h = computeApiKeyLookupHash(key, pepperA);
    expect(h).toBe(crypto.createHmac("sha256", pepperA).update(key, "utf8").digest("hex"));
    expect(h).not.toBe(crypto.createHash("sha256").update(key, "utf8").digest("hex"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pepper diferente gera hash diferente; mesmo pepper é determinístico", () => {
    expect(computeApiKeyLookupHash(key, pepperA)).toBe(computeApiKeyLookupHash(key, pepperA));
    expect(computeApiKeyLookupHash(key, pepperA)).not.toBe(computeApiKeyLookupHash(key, pepperB));
  });

  it("apiKeyLookupHash usa o pepper do ambiente (trocar a env muda o hash)", () => {
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", pepperA);
    const hA = apiKeyLookupHash(key);
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", pepperB);
    const hB = apiKeyLookupHash(key);
    vi.unstubAllEnvs();
    expect(hA).toBe(computeApiKeyLookupHash(key, pepperA));
    expect(hB).toBe(computeApiKeyLookupHash(key, pepperB));
    expect(hA).not.toBe(hB);
  });
});

describe("API key: pepper ausente falha fechado", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("em produção sem API_KEY_LOOKUP_PEPPER: erro claro no boot e em apiKeyLookupHash", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", "");
    expect(() => assertApiKeyLookupPepperConfigured()).toThrow(ApiKeyPepperError);
    expect(() => assertApiKeyLookupPepperConfigured()).toThrow(/API_KEY_LOOKUP_PEPPER/);
    expect(() => apiKeyLookupHash("bfk_aaaaaaaa_x")).toThrow(/Missing env: API_KEY_LOOKUP_PEPPER/);
  });

  it("em produção o valor padrão de teste nunca é usado, mesmo sob vitest", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", "");
    expect(() => getApiKeyLookupPepper()).toThrow(ApiKeyPepperError);
  });

  it("fora de teste e produção (ex.: development) também exige a variável", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", "");
    expect(() => getApiKeyLookupPepper()).toThrow(ApiKeyPepperError);
    expect(() => assertApiKeyLookupPepperConfigured()).not.toThrow();
  });

  it("pepper curto (< 32) é recusado; pepper válido em produção passa", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", "curto");
    expect(() => assertApiKeyLookupPepperConfigured()).toThrow(/pelo menos 32/);
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", "x".repeat(32));
    expect(() => assertApiKeyLookupPepperConfigured()).not.toThrow();
  });

  it("emitir chave ou autenticar sem pepper em produção lança, e requireToolsKey responde 500 sem vazar a chave", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY_LOOKUP_PEPPER", "");
    await expect(issueApiKey()).rejects.toBeInstanceOf(ApiKeyPepperError);
    await expect(authenticateToolsKey("bfk_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_00112233")).rejects.toBeInstanceOf(
      ApiKeyPepperError,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.get("/t", requireToolsKey, (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/t").set("x-api-key", "bfk_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_00112233");
    errSpy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("bfk_");
  });
});

describe("API key: lookup indexado e migração preguiçosa", () => {
  let ok = false;
  let pool: typeof import("../db.js").pool;
  const stamp = Date.now();
  const shops: string[] = [];
  const cleanupIds: string[] = [];

  async function mkShop(): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershops (name, phone, billing_plan, slug, business_hours)
       VALUES ('Teste API key', '5511999990000', 'pro', $1, '{}'::jsonb) RETURNING id`,
      [`test-ak-${stamp}-${shops.length}-${Math.random().toString(36).slice(2, 8)}`],
    );
    shops.push(r.rows[0]!.id);
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    ({ pool } = await import("../db.js"));
    try {
      await pool.query("SELECT key_prefix, key_lookup_hash FROM public.barbershop_api_keys LIMIT 1");
      ok = true;
    } catch {
      ok = false;
    }
    expect(ok, "migration barbershop_api_keys_lookup não aplicada no banco de teste").toBe(true);
  });

  beforeEach(() => {
    __resetLegacyScanGuards();
  });

  // Os testes de volume deixam centenas de linhas legadas pendentes; limpa a cada teste para um não afetar o outro.
  afterEach(async () => {
    if (ok && shops.length) {
      await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = ANY($1::uuid[])", [shops]);
    }
  });

  afterAll(async () => {
    if (!ok) return;
    if (cleanupIds.length) {
      await pool.query("DELETE FROM public.barbershop_api_keys WHERE id = ANY($1::uuid[])", [cleanupIds]);
    }
    if (shops.length) {
      await pool.query("DELETE FROM public.barbershop_api_keys WHERE barbershop_id = ANY($1::uuid[])", [shops]);
      await pool.query("DELETE FROM public.barbershops WHERE id = ANY($1::uuid[])", [shops]);
    }
  });

  it("chave nova autentica por lookup (1 SELECT), sem nenhum bcrypt.compare", async () => {
    const shopId = await mkShop();
    const issued = await issueApiKey();
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash)
       VALUES ($1, 'nova', $2, $3, $4) RETURNING id`,
      [shopId, issued.keyHash, issued.prefix, issued.lookupHash],
    );
    cleanupIds.push(ins.rows[0]!.id);

    const spy = vi.spyOn(bcrypt, "compare");
    const result = await authenticateToolsKey(issued.plaintext);
    expect(result).toEqual({ ok: true, barbershopId: shopId, keyId: ins.rows[0]!.id, via: "lookup" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("chave legada autentica 1x com bcrypt, grava o hash e na segunda vez não compara bcrypt", async () => {
    const shopId = await mkShop();
    const plaintext = `bfk_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_${stamp.toString(16).slice(-8)}`;
    const keyHash = await bcrypt.hash(plaintext, 4);
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash)
       VALUES ($1, 'legado', $2) RETURNING id`,
      [shopId, keyHash],
    );
    cleanupIds.push(ins.rows[0]!.id);

    const firstSpy = vi.spyOn(bcrypt, "compare");
    const first = await authenticateToolsKey(plaintext);
    expect(first).toMatchObject({ ok: true, barbershopId: shopId, keyId: ins.rows[0]!.id, via: "legacy" });
    expect(firstSpy).toHaveBeenCalled();
    firstSpy.mockRestore();

    const row = await pool.query<{ key_prefix: string | null; key_lookup_hash: string | null }>(
      `SELECT key_prefix, key_lookup_hash FROM public.barbershop_api_keys WHERE id = $1`,
      [ins.rows[0]!.id],
    );
    expect(row.rows[0]!.key_lookup_hash).toBe(apiKeyLookupHash(plaintext));
    expect(row.rows[0]!.key_prefix).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");

    const secondSpy = vi.spyOn(bcrypt, "compare");
    const second = await authenticateToolsKey(plaintext);
    expect(second).toMatchObject({ ok: true, via: "lookup", keyId: ins.rows[0]!.id });
    expect(secondSpy).not.toHaveBeenCalled();
    secondSpy.mockRestore();
  });

  it("chave errada não autentica; chaves já migradas não entram no loop bcrypt", async () => {
    const shopId = await mkShop();
    const issued = await issueApiKey();
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash)
       VALUES ($1, 'migrada', $2, $3, $4) RETURNING id`,
      [shopId, issued.keyHash, issued.prefix, issued.lookupHash],
    );
    cleanupIds.push(ins.rows[0]!.id);

    const pendingBefore = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.barbershop_api_keys WHERE revoked_at IS NULL AND key_lookup_hash IS NULL`,
    );
    const pending = Number(pendingBefore.rows[0]!.n);
    const spy = vi.spyOn(bcrypt, "compare");
    const result = await authenticateToolsKey("bfk_this-is-not-a-real-key_ffffffff");
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(Math.min(pending, LEGACY_API_KEY_SCAN_MAX_ROWS));
    // A chave migrada deste teste não pode ter sido comparada via bcrypt
    expect(spy.mock.calls.length).toBeLessThanOrEqual(pending);
    spy.mockRestore();
  });

  it("chave revogada (nova ou legada) é recusada e a legada não é migrada", async () => {
    const shopId = await mkShop();
    const issued = await issueApiKey();
    const insNew = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash, revoked_at)
       VALUES ($1, 'revogada-nova', $2, $3, $4, now()) RETURNING id`,
      [shopId, issued.keyHash, issued.prefix, issued.lookupHash],
    );
    cleanupIds.push(insNew.rows[0]!.id);
    expect(await authenticateToolsKey(issued.plaintext)).toEqual({ ok: false, reason: "revoked" });

    const legacyPlain = `bfk_99999999-8888-4777-8666-555555555555_${stamp.toString(16).slice(0, 8)}`;
    const insLeg = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, revoked_at)
       VALUES ($1, 'revogada-legado', $2, now()) RETURNING id`,
      [shopId, await bcrypt.hash(legacyPlain, 4)],
    );
    cleanupIds.push(insLeg.rows[0]!.id);
    expect(await authenticateToolsKey(legacyPlain)).toEqual({ ok: false, reason: "invalid" });
    const still = await pool.query<{ key_lookup_hash: string | null }>(
      `SELECT key_lookup_hash FROM public.barbershop_api_keys WHERE id = $1`,
      [insLeg.rows[0]!.id],
    );
    expect(still.rows[0]!.key_lookup_hash).toBeNull();
  });

  it("requireToolsKey: chave nova passa; ausente, errada e revogada retornam 401; o corpo não vaza a chave", async () => {
    const shopId = await mkShop();
    const issued = await issueApiKey();
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash)
       VALUES ($1, 'http', $2, $3, $4) RETURNING id`,
      [shopId, issued.keyHash, issued.prefix, issued.lookupHash],
    );
    cleanupIds.push(ins.rows[0]!.id);

    const app = express();
    app.get("/t", requireToolsKey, (req, res) => res.json({ barbershopId: req.barbershopId }));

    const okRes = await request(app).get("/t").set("x-api-key", issued.plaintext);
    expect(okRes.status).toBe(200);
    expect(okRes.body.barbershopId).toBe(shopId);

    const missing = await request(app).get("/t");
    expect(missing.status).toBe(401);
    expect(JSON.stringify(missing.body)).not.toMatch(/bfk_/);

    const wrong = await request(app).get("/t").set("x-api-key", "bfk_nope_nope");
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain("bfk_nope_nope");

    await pool.query("UPDATE public.barbershop_api_keys SET revoked_at = now() WHERE id = $1", [ins.rows[0]!.id]);
    const revoked = await request(app).get("/t").set("x-api-key", issued.plaintext);
    expect(revoked.status).toBe(401);
  });
  it("gravar chave nova guarda key_secret_bits=128; a migração preguiçosa registra os bits da chave curta e ela entra na lista de rotação", async () => {
    const shopId = await mkShop();
    const issued = await issueApiKey();
    const insNew = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash, key_secret_bits)
       VALUES ($1, 'nova-128', $2, $3, $4, $5) RETURNING id`,
      [shopId, issued.keyHash, issued.prefix, issued.lookupHash, issued.secretBits],
    );
    cleanupIds.push(insNew.rows[0]!.id);

    const shortPlain = `bfk_cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee_${crypto.randomBytes(4).toString("hex")}`;
    const insShort = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash) VALUES ($1, 'curta', $2) RETURNING id`,
      [shopId, await bcrypt.hash(shortPlain, 4)],
    );
    cleanupIds.push(insShort.rows[0]!.id);

    // Antes de ser vista: entropia desconhecida (NULL) => na lista de rotação. A chave nova não.
    let ids = (await listApiKeysNeedingRotation()).map((r) => r.id);
    expect(ids).toContain(insShort.rows[0]!.id);
    expect(ids).not.toContain(insNew.rows[0]!.id);

    expect(await authenticateToolsKey(shortPlain)).toMatchObject({ ok: true, via: "legacy" });
    const bits = await pool.query<{ key_secret_bits: number }>(
      `SELECT key_secret_bits FROM public.barbershop_api_keys WHERE id = $1`,
      [insShort.rows[0]!.id],
    );
    expect(bits.rows[0]!.key_secret_bits).toBe(32);
    // Continua autenticando e continua na lista (32 < 128), sem ter sido reemitida.
    expect(await authenticateToolsKey(shortPlain)).toMatchObject({ ok: true, via: "lookup" });
    ids = (await listApiKeysNeedingRotation()).map((r) => r.id);
    expect(ids).toContain(insShort.rows[0]!.id);
    expect(ids).not.toContain(insNew.rows[0]!.id);
  });

  it("linha com lookup SHA-256 antigo (pré-pepper) e prefixo não autentica por lookup; sem lookup autentica pelo bcrypt e regrava com HMAC", async () => {
    const shopId = await mkShop();
    const prefix = crypto.randomUUID();
    const plain = `bfk_${prefix}_${crypto.randomBytes(4).toString("hex")}`;
    const oldSha = crypto.createHash("sha256").update(plain, "utf8").digest("hex");
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, key_prefix, key_lookup_hash)
       VALUES ($1, 'sha-antigo', $2, $3, $4) RETURNING id`,
      [shopId, await bcrypt.hash(plain, 4), prefix, oldSha],
    );
    cleanupIds.push(ins.rows[0]!.id);
    expect(await authenticateToolsKey(plain)).toEqual({ ok: false, reason: "invalid" });
    // O que a migração 20261114030000 faz com os SHA-256 gravados:
    await pool.query(`UPDATE public.barbershop_api_keys SET key_lookup_hash = NULL WHERE id = $1`, [ins.rows[0]!.id]);
    expect(await authenticateToolsKey(plain)).toMatchObject({ ok: true, via: "legacy", keyId: ins.rows[0]!.id });
    const row = await pool.query<{ key_lookup_hash: string }>(
      `SELECT key_lookup_hash FROM public.barbershop_api_keys WHERE id = $1`,
      [ins.rows[0]!.id],
    );
    expect(row.rows[0]!.key_lookup_hash).toBe(apiKeyLookupHash(plain));
    expect(row.rows[0]!.key_lookup_hash).not.toBe(oldSha);
  });

  it("chave legada além das 50 primeiras continua autenticando (sem limite global de 50 por created_at)", async () => {
    const shopId = await mkShop();
    const dummyHash = await bcrypt.hash("outra-chave-qualquer", 4);
    const base = Date.now() - 3_600_000;
    const ids: string[] = [];
    // 59 linhas antigas (criadas antes) + a chave válida como a 60ª: ficaria fora do LIMIT 50 antigo.
    for (let i = 0; i < 59; i++) {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, created_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [shopId, `legado-${i}`, dummyHash, new Date(base + i * 1000)],
      );
      ids.push(r.rows[0]!.id);
    }
    const plain = `bfk_dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee_${crypto.randomBytes(4).toString("hex")}`;
    const target = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash, created_at)
       VALUES ($1, 'legado-alvo', $2, $3) RETURNING id`,
      [shopId, await bcrypt.hash(plain, 4), new Date(base + 59 * 1000)],
    );
    cleanupIds.push(target.rows[0]!.id, ...ids);
    const older = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.barbershop_api_keys
        WHERE revoked_at IS NULL AND key_lookup_hash IS NULL AND created_at < (SELECT created_at FROM public.barbershop_api_keys WHERE id = $1)`,
      [target.rows[0]!.id],
    );
    expect(Number(older.rows[0]!.n)).toBeGreaterThanOrEqual(50);

    const result = await authenticateToolsKey(plain);
    expect(result).toMatchObject({ ok: true, barbershopId: shopId, keyId: target.rows[0]!.id, via: "legacy" });
    expect(await authenticateToolsKey(plain)).toMatchObject({ ok: true, via: "lookup" });
  });

  it("custo de chave inválida é limitado: formato novo sem linha = 0 bcrypt; legado inválido <= teto de linhas", async () => {
    const shopId = await mkShop();
    const dummyHash = await bcrypt.hash("x", 4);
    const rows = LEGACY_API_KEY_SCAN_MAX_ROWS + 40;
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash)
       SELECT $1, 'legado-bulk-' || g, $2 FROM generate_series(1, $3) g RETURNING id`,
      [shopId, dummyHash, rows],
    );
    cleanupIds.push(...ins.rows.map((r) => r.id));

    const spy = vi.spyOn(bcrypt, "compare");
    const fresh = await issueApiKey(); // formato novo (128 bits), nunca gravada
    expect(await authenticateToolsKey(fresh.plaintext)).toEqual({ ok: false, reason: "invalid" });
    expect(spy).not.toHaveBeenCalled();

    const legacyShaped = `bfk_eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee_${crypto.randomBytes(4).toString("hex")}`;
    expect(await authenticateToolsKey(legacyShaped)).toEqual({ ok: false, reason: "invalid" });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(LEGACY_API_KEY_SCAN_MAX_ROWS);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("varredura legada: cache negativo evita repetir bcrypt e o throttle limita varreduras por janela", async () => {
    const shopId = await mkShop();
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash) VALUES ($1, 'legado-throttle', $2) RETURNING id`,
      [shopId, await bcrypt.hash("y", 4)],
    );
    cleanupIds.push(ins.rows[0]!.id);
    const pendingRes = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.barbershop_api_keys WHERE revoked_at IS NULL AND key_lookup_hash IS NULL`,
    );
    expect(Number(pendingRes.rows[0]!.n)).toBeLessThanOrEqual(LEGACY_API_KEY_SCAN_MAX_ROWS);

    const spy = vi.spyOn(bcrypt, "compare");
    const k = `bfk_ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee_${crypto.randomBytes(4).toString("hex")}`;
    await authenticateToolsKey(k);
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await authenticateToolsKey(k); // cache negativo
    expect(spy.mock.calls.length).toBe(afterFirst);

    __resetLegacyScanGuards();
    spy.mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < LEGACY_SCAN_MAX_PER_WINDOW; i++) {
      await authenticateToolsKey(`bfk_ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee_${crypto.randomBytes(4).toString("hex")}`);
    }
    const afterWindow = spy.mock.calls.length;
    await authenticateToolsKey(`bfk_ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee_${crypto.randomBytes(4).toString("hex")}`);
    expect(spy.mock.calls.length).toBe(afterWindow); // 21ª varredura recusada sem bcrypt
    warn.mockRestore();
    spy.mockRestore();
  });
});
