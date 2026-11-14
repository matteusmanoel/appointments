-- Lookup indexado de API keys (B4).
-- key_prefix: parte pública da chave (bfk_<prefix>_…), única entre linhas com prefixo.
-- key_lookup_hash: SHA-256 hex da chave completa, único; permite 1 SELECT + comparação em tempo constante.
-- Chaves já existentes não podem ser preenchidas sem o texto puro: o backend grava os dois
-- campos na primeira autenticação bem-sucedida (migração preguiçosa). Remoção do caminho
-- legado (varredura bcrypt limitada): quando
--   SELECT count(*) FROM public.barbershop_api_keys
--   WHERE revoked_at IS NULL AND key_lookup_hash IS NULL
-- retornar 0, ou após rotacionar as chaves que nunca foram usadas. Ver backend/src/lib/api-keys.ts.

ALTER TABLE public.barbershop_api_keys
  ADD COLUMN IF NOT EXISTS key_prefix text,
  ADD COLUMN IF NOT EXISTS key_lookup_hash text;

COMMENT ON COLUMN public.barbershop_api_keys.key_prefix IS
  'Identificador público da chave (segmento após bfk_). NÃO é segredo. Preenchido na emissão ou na primeira validação legada.';

COMMENT ON COLUMN public.barbershop_api_keys.key_lookup_hash IS
  'SHA-256 (hex minúsculo) da chave completa. Usado no lookup indexado. Nunca logar este valor junto da chave em texto.';

CREATE UNIQUE INDEX IF NOT EXISTS barbershop_api_keys_lookup_hash_uidx
  ON public.barbershop_api_keys (key_lookup_hash)
  WHERE key_lookup_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS barbershop_api_keys_prefix_uidx
  ON public.barbershop_api_keys (key_prefix)
  WHERE key_prefix IS NOT NULL;
