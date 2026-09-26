ALTER TABLE public.ai_conversation_runtime
  ADD COLUMN IF NOT EXISTS booking_draft jsonb;
