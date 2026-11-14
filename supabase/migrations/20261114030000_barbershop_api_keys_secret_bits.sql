-- Endurecimento do lookup de API keys (revisão de segurança do PR #30).
--
-- 1) key_lookup_hash passa a ser HMAC-SHA256 com pepper de servidor (API_KEY_LOOKUP_PEPPER),
--    não mais SHA-256 puro. Os valores SHA-256 já gravados permitiam força bruta offline da chave
--    a partir de um dump (o sufixo era de só 32 bits), então são apagados na primeira aplicação.
--    As chaves continuam autenticando: o backend as valida por bcrypt (key_hash) e grava de novo o
--    lookup, agora com HMAC, na primeira requisição.
-- 2) key_secret_bits: bits de entropia do sufixo da chave. NULL = emitida antes deste formato e ainda
--    não vista (presume-se curta). Chaves novas gravam 128. Base da lista de rotação:
--      SELECT id, barbershop_id, name, created_at, last_used_at, key_secret_bits
--        FROM public.barbershop_api_keys
--       WHERE revoked_at IS NULL AND (key_secret_bits IS NULL OR key_secret_bits < 128);
--    Nada é rotacionado automaticamente; a rotação (criar nova chave, trocar no n8n, revogar a antiga)
--    é manual. Ver docs/RUNBOOK.md, seção "API keys de tools".
--
-- O bloco só roda uma vez: a coluna key_secret_bits marca que a migração já foi aplicada.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'barbershop_api_keys' AND column_name = 'key_secret_bits'
  ) THEN
    ALTER TABLE public.barbershop_api_keys ADD COLUMN key_secret_bits integer;
    UPDATE public.barbershop_api_keys SET key_lookup_hash = NULL WHERE key_lookup_hash IS NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.barbershop_api_keys.key_lookup_hash IS
  'HMAC-SHA256 (hex minúsculo) da chave completa com o pepper de servidor API_KEY_LOOKUP_PEPPER. Usado no lookup indexado. Nunca logar este valor junto da chave em texto.';

COMMENT ON COLUMN public.barbershop_api_keys.key_secret_bits IS
  'Bits de entropia do sufixo da chave (128 nas emitidas pelo formato atual). NULL ou < 128 = rotacionar.';
