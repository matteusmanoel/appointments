-- Contexto do agente que atravessa conversas (rascunho, card, última intenção).
-- Uma linha por cliente e barbearia, na memória que já é a fonte de preferências.
-- Timeouts curtos: a tabela passa a ser escrita a cada turno e um ALTER não pode
-- segurar a fila atrás de uma transação longa.

SET lock_timeout = '2s';
SET statement_timeout = '5s';

ALTER TABLE public.client_ai_memory
  ADD COLUMN IF NOT EXISTS session_context jsonb;

COMMENT ON COLUMN public.client_ai_memory.session_context IS
  'Rascunho, card pendente, intenções pendentes e última intenção. Reidratado na conversa seguinte do mesmo cliente.';

RESET statement_timeout;
RESET lock_timeout;
