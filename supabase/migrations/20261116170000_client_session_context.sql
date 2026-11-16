-- Contexto do agente que atravessa conversas (rascunho, card, última intenção).
-- Uma linha por cliente e barbearia, na memória que já é a fonte de preferências.

ALTER TABLE public.client_ai_memory
  ADD COLUMN IF NOT EXISTS session_context jsonb;

COMMENT ON COLUMN public.client_ai_memory.session_context IS
  'Rascunho, card pendente, intenções pendentes e última intenção. Reidratado na conversa seguinte do mesmo cliente.';
