-- Migration: AI conversations, messages, jobs queue, barbershop AI settings, outbound events (n8n)
-- Date: 2026-02-19

-- Conversations and memory
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  external_thread_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'handoff')),
  summary text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(barbershop_id, channel, external_thread_id)
);

CREATE INDEX IF NOT EXISTS ai_conversations_barbershop_status_idx
  ON public.ai_conversations (barbershop_id, status);
CREATE INDEX IF NOT EXISTS ai_conversations_last_message_at_idx
  ON public.ai_conversations (last_message_at DESC NULLS LAST);

-- Messages (user, assistant, tool)
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text,
  tool_name text,
  tool_payload jsonb,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
  ON public.ai_messages (conversation_id, created_at);

-- Job queue (DB-based)
CREATE TABLE IF NOT EXISTS public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'process_inbound_message',
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_jobs_status_run_after_idx
  ON public.ai_jobs (status, run_after)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ai_jobs_barbershop_status_idx
  ON public.ai_jobs (barbershop_id, status);

-- Config per tenant
CREATE TABLE IF NOT EXISTS public.barbershop_ai_settings (
  barbershop_id uuid PRIMARY KEY REFERENCES public.barbershops(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  model text NOT NULL DEFAULT 'gpt-4o-mini',
  temperature real NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
  system_prompt_override text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Outbound events for n8n (follow-up, reminders, reports)
CREATE TABLE IF NOT EXISTS public.outbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_events_status_next_run_idx
  ON public.outbound_events (status, next_run_at)
  WHERE status = 'pending';
