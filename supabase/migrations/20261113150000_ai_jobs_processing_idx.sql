-- Apoia o reaper de ai_jobs presos: varredura só nos jobs em `processing`, por idade da referência
-- COALESCE(locked_at, updated_at) (a MESMA expressão da consulta do reaper; o índice anterior em
-- (locked_at) não era usado por ela). Renomeada de 20261113130000 (prefixo duplicado com billing_enforcement).
-- Reversão: DROP INDEX IF EXISTS public.ai_jobs_processing_since_idx;
SET lock_timeout = '5s';
DROP INDEX IF EXISTS public.ai_jobs_processing_locked_idx;
CREATE INDEX IF NOT EXISTS ai_jobs_processing_since_idx
  ON public.ai_jobs ((COALESCE(locked_at, updated_at)))
  WHERE status = 'processing';
