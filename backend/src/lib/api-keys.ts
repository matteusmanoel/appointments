import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { getApiKeyLookupPepper } from "./api-key-pepper.js";

/** Bytes aleatórios do segredo de uma chave nova (128 bits). Hex => 32 caracteres. */
export const API_KEY_SECRET_BYTES = 16;
/** Entropia mínima (bits) para uma chave não ser marcada para rotação. */
export const API_KEY_MIN_SECRET_BITS = 128;

/**
 * Varredura bcrypt de chaves legadas (sem key_lookup_hash). As chaves legadas não guardam o
 * prefixo, então não dá para filtrá-las por ele; o custo é limitado assim:
 *  - só chaves no formato legado (sufixo curto) entram na varredura (as novas nunca);
 *  - no máximo LEGACY_API_KEY_SCAN_MAX_ROWS linhas por varredura, em ordem aleatória quando há mais
 *    pendentes que isso (todas as chaves têm chance nas tentativas seguintes; antes eram só as
 *    50 mais antigas, e as demais nunca autenticavam);
 *  - no máximo LEGACY_SCAN_MAX_PER_WINDOW varreduras por processo a cada LEGACY_SCAN_WINDOW_MS;
 *  - chave inválida já varrida fica em cache negativo (só o HMAC dela) por LEGACY_NEGATIVE_CACHE_MS.
 * Remova o caminho legado quando não houver pendentes.
 */
export const LEGACY_API_KEY_SCAN_MAX_ROWS = 250;
export const LEGACY_SCAN_MAX_PER_WINDOW = 20;
export const LEGACY_SCAN_WINDOW_MS = 60_000;
export const LEGACY_NEGATIVE_CACHE_MS = 60_000;
const LEGACY_NEGATIVE_CACHE_MAX_ENTRIES = 1000;
/** Chaves legadas têm sufixo de até 8 caracteres (Math.random base36); as de 32 bits do PR #30 têm 8 hex. */
const LEGACY_MAX_SUFFIX_LENGTH = 16;

const BCRYPT_COST = 10;
const PREFIX_RE = /^bfk_([A-Za-z0-9-]{8,64})_/;

export function parseApiKeyPrefix(key: string): string | null {
  const m = key.trim().match(PREFIX_RE);
  return m?.[1] ?? null;
}

/** Sufixo secreto (parte após bfk_<prefixo>_) ou null se o formato não bate. */
export function parseApiKeySuffix(key: string): string | null {
  const m = key.trim().match(/^bfk_[A-Za-z0-9-]{8,64}_([A-Za-z0-9_-]+)$/);
  return m?.[1] ?? null;
}

/** Estimativa conservadora (piso) dos bits de entropia do sufixo, pelo alfabeto observado. */
export function apiKeySecretBits(key: string): number {
  const suffix = parseApiKeySuffix(key);
  if (!suffix) return 0;
  if (/^[0-9a-f]+$/.test(suffix)) return suffix.length * 4;
  if (/^[0-9a-z]+$/.test(suffix)) return suffix.length * 5;
  return suffix.length * 6;
}

/** HMAC-SHA256 hex minúsculo da chave completa com um pepper explícito (função pura). */
export function computeApiKeyLookupHash(key: string, pepper: string): string {
  return crypto.createHmac("sha256", pepper).update(key, "utf8").digest("hex");
}

/**
 * Hash de lookup determinístico e indexado: HMAC-SHA256(pepper do servidor, chave completa).
 * Sem o pepper, um dump do banco não permite testar palpites de chave. Lança ApiKeyPepperError
 * quando API_KEY_LOOKUP_PEPPER falta (fail closed).
 */
export function apiKeyLookupHash(key: string): string {
  return computeApiKeyLookupHash(key, getApiKeyLookupPepper());
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
  /** Bits de entropia do sufixo; gravar em key_secret_bits. */
  secretBits: number;
};

/** Emite uma chave bfk_<uuid>_<32 hex> (128 bits), com bcrypt (coluna legada) e HMAC de lookup. */
export async function issueApiKey(): Promise<IssuedApiKey> {
  const prefix = crypto.randomUUID();
  const plaintext = `bfk_${prefix}_${crypto.randomBytes(API_KEY_SECRET_BYTES).toString("hex")}`;
  const lookupHash = apiKeyLookupHash(plaintext); // falha antes do bcrypt se faltar o pepper
  const keyHash = await bcrypt.hash(plaintext, BCRYPT_COST);
  return { plaintext, prefix, keyHash, lookupHash, secretBits: apiKeySecretBits(plaintext) };
}

export type ApiKeyRotationCandidate = {
  id: string;
  barbershop_id: string;
  name: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  key_secret_bits: number | null;
};

/**
 * Chaves ativas que devem ser rotacionadas: entropia desconhecida (NULL = emitida antes do
 * formato novo e ainda não vista) ou abaixo de API_KEY_MIN_SECRET_BITS. Somente leitura, sem segredos.
 */
export async function listApiKeysNeedingRotation(): Promise<ApiKeyRotationCandidate[]> {
  const r = await pool.query<ApiKeyRotationCandidate>(
    `SELECT id, barbershop_id, name, created_at, last_used_at, key_secret_bits
       FROM public.barbershop_api_keys
      WHERE revoked_at IS NULL
        AND (key_secret_bits IS NULL OR key_secret_bits < $1)
      ORDER BY barbershop_id, created_at`,
    [API_KEY_MIN_SECRET_BITS],
  );
  return r.rows;
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
              key_secret_bits = COALESCE(key_secret_bits, $4),
              last_used_at = now()
        WHERE id = $1
          AND key_lookup_hash IS NULL`,
      [row.id, lookupHash, prefix, apiKeySecretBits(key)],
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
 * Caminho novo: 1 SELECT pelo HMAC-SHA256 com pepper (índice único) + timingSafeEqual. Sem bcrypt.
 * Caminho legado: só linhas com key_lookup_hash IS NULL e só para chaves de formato legado, com
 * os limites de LEGACY_API_KEY_SCAN_MAX_ROWS e do throttle; na primeira validação grava o hash
 * de lookup, o prefixo e key_secret_bits.
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

  return legacyScan(key, computed);
}

const legacyScanTimes: number[] = [];
const legacyNegativeCache = new Map<string, number>();

/** Só para testes: zera o throttle e o cache negativo da varredura legada. */
export function __resetLegacyScanGuards(): void {
  legacyScanTimes.length = 0;
  legacyNegativeCache.clear();
}

function legacyScanAllowed(now: number): boolean {
  while (legacyScanTimes.length && now - legacyScanTimes[0]! >= LEGACY_SCAN_WINDOW_MS) legacyScanTimes.shift();
  if (legacyScanTimes.length >= LEGACY_SCAN_MAX_PER_WINDOW) return false;
  legacyScanTimes.push(now);
  return true;
}

function rememberLegacyMiss(lookupHash: string, now: number): void {
  if (legacyNegativeCache.size >= LEGACY_NEGATIVE_CACHE_MAX_ENTRIES) {
    const oldest = legacyNegativeCache.keys().next().value;
    if (oldest !== undefined) legacyNegativeCache.delete(oldest);
  }
  legacyNegativeCache.set(lookupHash, now + LEGACY_NEGATIVE_CACHE_MS);
}

async function legacyScan(key: string, lookupHash: string): Promise<ToolsKeyAuthResult> {
  // Chaves novas (sufixo longo) sempre têm linha com lookup/prefixo; nunca são legadas.
  const suffix = parseApiKeySuffix(key);
  if (!suffix || suffix.length > LEGACY_MAX_SUFFIX_LENGTH) return { ok: false, reason: "invalid" };

  const now = Date.now();
  const until = legacyNegativeCache.get(lookupHash);
  if (until !== undefined) {
    if (until > now) return { ok: false, reason: "invalid" };
    legacyNegativeCache.delete(lookupHash);
  }
  if (!legacyScanAllowed(now)) {
    console.warn("[api-key-auth] varredura legada recusada pelo throttle (limite=%s/%ss)", LEGACY_SCAN_MAX_PER_WINDOW, LEGACY_SCAN_WINDOW_MS / 1000);
    return { ok: false, reason: "invalid" };
  }

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
      ORDER BY random()
      LIMIT $1`,
    [LEGACY_API_KEY_SCAN_MAX_ROWS],
  );

  if (pendingCount > LEGACY_API_KEY_SCAN_MAX_ROWS) {
    console.warn(
      "[api-key-auth] varredura legada parcial (ordem aleatória): pendentes=%s limite=%s — rotacione as chaves legadas; remova o caminho legado quando pendentes=0",
      pendingCount,
      LEGACY_API_KEY_SCAN_MAX_ROWS,
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
        LEGACY_API_KEY_SCAN_MAX_ROWS,
      );
      return { ok: true, barbershopId: row.barbershop_id, keyId: row.id, via: "legacy" };
    }
  }

  // Cache negativo só quando a varredura foi completa: numa parcial a chave pode estar fora da amostra.
  if (pendingCount <= LEGACY_API_KEY_SCAN_MAX_ROWS) rememberLegacyMiss(lookupHash, now);
  if (compared > 0) {
    console.info(
      "[api-key-auth] varredura legada: comparacoes=%s pendentes=%s limite=%s encontrada=false",
      compared,
      pendingCount,
      LEGACY_API_KEY_SCAN_MAX_ROWS,
    );
  }
  return { ok: false, reason: "invalid" };
}
