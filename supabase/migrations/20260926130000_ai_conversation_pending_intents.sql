-- Secondary intents postponed by the orchestrator while a transactional intent is handled
-- (e.g. "remarca pra sexta e me fala dos planos" → plan waits until the reschedule closes).
ALTER TABLE public.ai_conversation_runtime
  ADD COLUMN IF NOT EXISTS pending_intents jsonb;
