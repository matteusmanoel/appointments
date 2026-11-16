-- Inofensivo em produção: só endurece a tabela de trace do simulador SE ela já existir.
-- Remove FKs para tabelas quentes (barbershops, ai_conversations) e cria índice de TTL.
-- Timeouts curtos para não bloquear o migrate. A escrita continua atrás da flag
-- AI_SIMULATOR_TRACE_ENABLED (default off). A criação da tabela (20261114210000)
-- é ignorada pelo migrate:all; este follow-up fica no migrate:all para ambientes
-- que já aplicaram a criação.

SET lock_timeout = '2s';
SET statement_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.ai_simulator_turn_traces') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.ai_simulator_turn_traces
    DROP CONSTRAINT IF EXISTS ai_simulator_turn_traces_barbershop_id_fkey;
  ALTER TABLE public.ai_simulator_turn_traces
    DROP CONSTRAINT IF EXISTS ai_simulator_turn_traces_conversation_id_fkey;

  CREATE INDEX IF NOT EXISTS ai_simulator_turn_traces_created_at_idx
    ON public.ai_simulator_turn_traces (created_at);

  EXECUTE $c$COMMENT ON TABLE public.ai_simulator_turn_traces IS
    'Traces do simulador CLI. Sem FKs para tabelas quentes. Escrita só com AI_SIMULATOR_TRACE_ENABLED (default off). TTL por created_at.'$c$;
END
$$;

RESET statement_timeout;
RESET lock_timeout;
