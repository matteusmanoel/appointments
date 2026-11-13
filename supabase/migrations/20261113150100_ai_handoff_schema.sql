-- ai_handoff_events.triggered_by: a migration original só aceitava (auto, manual, rule, keyword, agent_failure),
-- mas o código grava também 'delivery_failure' e 'job_failure' (ai-worker, reaper) e só o ensure-schema em runtime
-- ampliava o CHECK. Quem roda apenas `migrate:all` ficava com INSERT rejeitado (e o reaper engolia o erro).
-- Aqui o CHECK passa a ser o superconjunto, de forma idempotente. Só amplia (nenhuma linha existente viola).
-- Também garante `ai_conversations.needs_human_followup` (o reaper e o ai-worker gravam; antes só o ensure-schema em
-- runtime criava a coluna, e quem rodava só `migrate:all` ficava sem ela). Idempotente.
-- Reversão: recriar o CHECK com a lista antiga (só se não houver linhas com os valores novos).
SET lock_timeout = '5s';
ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS needs_human_followup boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_handoff_events DROP CONSTRAINT IF EXISTS ai_handoff_events_triggered_by_check;
ALTER TABLE public.ai_handoff_events
  ADD CONSTRAINT ai_handoff_events_triggered_by_check
  CHECK (triggered_by IN ('auto', 'manual', 'rule', 'keyword', 'agent_failure', 'delivery_failure', 'job_failure'))
  NOT VALID;
ALTER TABLE public.ai_handoff_events VALIDATE CONSTRAINT ai_handoff_events_triggered_by_check;
