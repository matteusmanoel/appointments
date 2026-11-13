-- ai_handoff_events.event_type: a migration original (20260226140000) só aceitava (paused, resumed),
-- mas o reaper e o ai-worker gravam 'pending_review' ao dead-letterar um job (handoff para humano).
-- A 20261113150100 ampliou só triggered_by (job_failure / delivery_failure); o CHECK de event_type
-- ficou para trás. Quem roda apenas `migrate:all` (sem o ensure-schema em runtime) tinha o INSERT
-- rejeitado, a transação do markDead revertia e o job permanecia em processing — inclusive com
-- tentativas esgotadas. O reaper não consulta assinatura; este gap de schema é que bloqueava o
-- dead-letter. Idempotente, só amplia (nenhuma linha existente viola).
-- Reversão: recriar o CHECK com ('paused', 'resumed') só se não houver linhas com pending_review.
SET lock_timeout = '5s';
ALTER TABLE public.ai_handoff_events DROP CONSTRAINT IF EXISTS ai_handoff_events_event_type_check;
ALTER TABLE public.ai_handoff_events
  ADD CONSTRAINT ai_handoff_events_event_type_check
  CHECK (event_type IN ('paused', 'resumed', 'pending_review'))
  NOT VALID;
ALTER TABLE public.ai_handoff_events VALIDATE CONSTRAINT ai_handoff_events_event_type_check;
