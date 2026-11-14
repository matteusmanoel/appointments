import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import request from "supertest";
import {
  LEGACY_API_KEY_SCAN_LIMIT,
  apiKeyLookupHash,
  authenticateToolsKey,
  issueApiKey,
  lookupHashesEqual,
  parseApiKeyPrefix,
} from "../lib/api-keys.js";
import { requireToolsKey } from "../middleware/auth.js";

describe("API key: prefixo e hash de lookup (puros)", () => {
  it("extrai o prefixo público de bfk_<id>_… e rejeita formato antigo/inválido", () => {
    const prefix = "11111111-2222-4333-8333-444444444444";
    expect(parseApiKeyPrefix(`bfk_${prefix}_deadbeef`)).toBe(prefix);
    expect(parseApiKeyPrefix("  bfk_abcd1234_secret  ")).toBe("abcd1234");
    expect(parseApiKeyPrefix("tk_nope")).toBeNull();
    expect(parseApiKeyPrefix("")).toBeNull();
  });

  it("SHA-256 é determinístico; timingSafeEqual aceita iguais e rejeita diferentes/tamanho errado", () => {
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
    expect(spy.mock.calls.length).toBeLessThanOrEqual(Math.min(pending, LEGACY_API_KEY_SCAN_LIMIT));
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
});
