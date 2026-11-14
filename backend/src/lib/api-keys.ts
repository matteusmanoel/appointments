import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

/** Limite da varredura bcrypt de chaves ainda sem key_lookup_hash. Remova o caminho legado quando não houver pendentes. */
export const LEGACY_API_KEY_SCAN_LIMIT = 50;

const BCRYPT_COST = 10;
const PREFIX_RE = /^bfk_([A-Za-z0-9-]{8,64})_/;

export function parseApiKeyPrefix(key: string): string | null {
  const m = key.trim().match(PREFIX_RE);
  return m?.[1] ?? null;
}

/** SHA-256 hex minúsculo da chave completa (lookup determinístico, indexado). */
export function apiKeyLookupHash(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

export function lookupHashesEqual(stored: string, computed: string): boolean {
  const a = Buffer.from(stored, "hex");
  const b = Buffer.from(computed, "hex");
  const len = 32;
  const aa = a.length === len ? a : Buffer.alloc(len);
  const bb = b.length === len ? b : Buffer.alloc(len);
  const ok = a.length === len && b.length === len && crypto.timingSafeEqual(aa, bb);
  return ok;
}

export type IssuedApiKey = {
  plaintext: string;
  prefix: string;
  keyHash: string;
  lookupHash: string;
};

/** Emite uma chave no formato bfk_<uuid>_<hex>, com bcrypt (coluna legada) e SHA-256 de lookup. */
export async function issueApiKey(): Promise<IssuedApiKey> {
  const prefix = crypto.randomUUID();
  const plaintext = `bfk_${prefix}_${crypto.randomBytes(4).toString("hex")}`;
  const [keyHash, lookupHash] = await Promise.all([
    bcrypt.hash(plaintext, BCRYPT_COST),
    Promise.resolve(apiKeyLookupHash(plaintext)),
  ]);
  return { plaintext, prefix, keyHash, lookupHash };
}

export type ToolsKeyAuthOk = {
  ok: true;
  barbershopId: string;
  keyId: string | null;
  via: "global" | "lookup" | "legacy";
};

export type ToolsKeyAuthFail = {
  ok: false;
  reason: "invalid" | "revoked";
};

export type ToolsKeyAuthResult = ToolsKeyAuthOk | ToolsKeyAuthFail;

type ApiKeyRow = {
  id: string;
  barbershop_id: string;
  key_hash: string;
  key_prefix: string | null;
  key_lookup_hash: string | null;
  revoked_at: Date | string | null;
};

async function loadByLookupHash(lookupHash: string): Promise<ApiKeyRow | null> {
  const r = await pool.query<ApiKeyRow>(
    `SELECT id, barbershop_id, key_hash, key_prefix, key_lookup_hash, revoked_at
       FROM public.barbershop_api_keys
      WHERE key_lookup_hash = $1
      LIMIT 1`,
    [lookupHash],
  );
  return r.rows[0] ?? null;
}

async function loadByPrefix(prefix: string): Promise<ApiKeyRow | null> {
  const r = await pool.query<ApiKeyRow>(
    `SELECT id, barbershop_id, key_hash, key_prefix, key_lookup_hash, revoked_at
       FROM public.barbershop_api_keys
      WHERE key_prefix = $1
      LIMIT 1`,
    [prefix],
  );
  return r.rows[0] ?? null;
}

async function markUsed(id: string): Promise<void> {
  void pool
    .query("UPDATE public.barbershop_api_keys SET last_used_at = now() WHERE id = $1", [id])
    .catch(() => {});
}

async function lazyMigrate(row: ApiKeyRow, key: string): Promise<void> {
  const lookupHash = apiKeyLookupHash(key);
  const prefix = parseApiKeyPrefix(key);
  try {
    await pool.query(
      `UPDATE public.barbershop_api_keys
          SET key_lookup_hash = $2,
              key_prefix = COALESCE(key_prefix, $3),
              last_used_at = now()
        WHERE id = $1
          AND key_lookup_hash IS NULL`,
      [row.id, lookupHash, prefix],
    );
  } catch (e) {
    // Colisão no índice único: não logar a chave nem o hash. A autenticação já foi aceita.
    console.warn(
      "[api-key-auth] falha ao gravar lookup da chave legado (id=%s): %s",
      row.id,
      e instanceof Error ? e.message : "erro",
    );
  }
}

/**
 * Autentica uma API key de tools.
 *
 * Caminho novo: 1 SELECT pelo SHA-256 (índice único) + timingSafeEqual. Sem bcrypt.
 * Caminho legado: só linhas com key_lookup_hash IS NULL, no máximo LEGACY_API_KEY_SCAN_LIMIT
 * comparações bcrypt; na primeira validação grava o hash de lookup (e o prefixo).
 *
 * Remoção planejada: quando não restar chave ativa sem key_lookup_hash (ou após rotacionar
 * as que nunca foram usadas), apague a varredura bcrypt e este comentário.
 */
export async function authenticateToolsKey(
  key: string,
  opts: { toolsApiKey?: string; fallbackBarbershopId?: string } = {},
): Promise<ToolsKeyAuthResult> {
  const globalKey = opts.toolsApiKey ?? "";
  if (globalKey && key === globalKey) {
    const id = opts.fallbackBarbershopId?.trim();
    return { ok: true, barbershopId: id || "", keyId: null, via: "global" };
  }

  const computed = apiKeyLookupHash(key);
  const byHash = await loadByLookupHash(computed);
  if (byHash) {
    if (byHash.revoked_at) return { ok: false, reason: "revoked" };
    if (!byHash.key_lookup_hash || !lookupHashesEqual(byHash.key_lookup_hash, computed)) {
      return { ok: false, reason: "invalid" };
    }
    void markUsed(byHash.id);
    return { ok: true, barbershopId: byHash.barbershop_id, keyId: byHash.id, via: "lookup" };
  }

  const prefix = parseApiKeyPrefix(key);
  if (prefix) {
    const byPrefix = await loadByPrefix(prefix);
    if (byPrefix) {
      if (byPrefix.revoked_at) return { ok: false, reason: "revoked" };
      if (byPrefix.key_lookup_hash) {
        if (!lookupHashesEqual(byPrefix.key_lookup_hash, computed)) {
          return { ok: false, reason: "invalid" };
        }
        void markUsed(byPrefix.id);
        return { ok: true, barbershopId: byPrefix.barbershop_id, keyId: byPrefix.id, via: "lookup" };
      }
      const ok = await bcrypt.compare(key, byPrefix.key_hash);
      if (!ok) return { ok: false, reason: "invalid" };
      await lazyMigrate(byPrefix, key);
      return { ok: true, barbershopId: byPrefix.barbershop_id, keyId: byPrefix.id, via: "legacy" };
    }
  }

  return legacyScan(key);
}

async function legacyScan(key: string): Promise<ToolsKeyAuthResult> {
  const pending = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM public.barbershop_api_keys
      WHERE revoked_at IS NULL
        AND key_lookup_hash IS NULL`,
  );
  const pendingCount = Number(pending.rows[0]?.n ?? 0);
  const r = await pool.query<ApiKeyRow>(
    `SELECT id, barbershop_id, key_hash, key_prefix, key_lookup_hash, revoked_at
       FROM public.barbershop_api_keys
      WHERE revoked_at IS NULL
        AND key_lookup_hash IS NULL
      ORDER BY created_at ASC
      LIMIT $1`,
    [LEGACY_API_KEY_SCAN_LIMIT],
  );

  if (pendingCount > LEGACY_API_KEY_SCAN_LIMIT) {
    console.warn(
      "[api-key-auth] varredura legada truncada: pendentes=%s limite=%s — chaves não usadas precisam ser recriadas; remova o caminho legado quando pendentes=0",
      pendingCount,
      LEGACY_API_KEY_SCAN_LIMIT,
    );
  }

  let compared = 0;
  for (const row of r.rows) {
    compared += 1;
    const ok = await bcrypt.compare(key, row.key_hash);
    if (ok) {
      await lazyMigrate(row, key);
      console.info(
        "[api-key-auth] varredura legada: comparacoes=%s pendentes=%s limite=%s encontrada=true",
        compared,
        pendingCount,
        LEGACY_API_KEY_SCAN_LIMIT,
      );
      return { ok: true, barbershopId: row.barbershop_id, keyId: row.id, via: "legacy" };
    }
  }

  if (compared > 0) {
    console.info(
      "[api-key-auth] varredura legada: comparacoes=%s pendentes=%s limite=%s encontrada=false",
      compared,
      pendingCount,
      LEGACY_API_KEY_SCAN_LIMIT,
    );
  }
  return { ok: false, reason: "invalid" };
}
