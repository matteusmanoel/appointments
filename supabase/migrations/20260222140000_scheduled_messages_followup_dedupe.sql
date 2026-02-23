-- Prevent re-enqueueing followup_30d for same client/month (any status).
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_messages_followup_dedupe
  ON public.scheduled_messages (dedupe_key)
  WHERE type = 'followup_30d' AND dedupe_key IS NOT NULL;
