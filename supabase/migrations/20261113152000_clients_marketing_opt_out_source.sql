-- Origem e data do opt-out de marketing (para o dono saber quem pediu para sair, e quando, e poder reverter).
-- Idempotente; colunas anuláveis (linhas antigas ficam NULL). Reversão: ALTER TABLE ... DROP COLUMN IF EXISTS ...
SET lock_timeout = '5s';
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_source text;
COMMENT ON COLUMN public.clients.marketing_opt_out_source IS 'whatsapp_keyword = cliente respondeu PARAR/SAIR; manual = dono pelo painel.';
