-- Scheduled messages for reminders and follow-ups (no LLM).
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('reminder_24h', 'reminder_2h', 'followup_30d')),
  to_phone text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  run_after timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_messages_dedupe
  ON public.scheduled_messages (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'queued';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_run_after
  ON public.scheduled_messages (run_after) WHERE status = 'queued';

-- Opt-out for marketing/reminders (client asks to stop).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.marketing_opt_out IS 'When true, do not send reminder/follow-up messages to this client.';
