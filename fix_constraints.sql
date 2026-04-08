-- Corrigir constraints de ai_handoff_events
ALTER TABLE public.ai_handoff_events 
DROP CONSTRAINT IF EXISTS ai_handoff_events_event_type_check;

ALTER TABLE public.ai_handoff_events 
ADD CONSTRAINT ai_handoff_events_event_type_check
CHECK (event_type IN ('paused', 'resumed', 'pending_review'));

ALTER TABLE public.ai_handoff_events 
DROP CONSTRAINT IF EXISTS ai_handoff_events_triggered_by_check;

ALTER TABLE public.ai_handoff_events 
ADD CONSTRAINT ai_handoff_events_triggered_by_check
CHECK (triggered_by IN ('auto', 'manual', 'rule', 'keyword', 'agent_failure', 'delivery_failure', 'job_failure'));

-- Verificar
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'public.ai_handoff_events'::regclass 
AND contype = 'c';
