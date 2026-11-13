-- Ficha sanitizada de cada turno do agente. Serve a avaliação, não o prompt.
-- Sem system prompt, sem argumento de tool e sem telefone completo.

CREATE TABLE IF NOT EXISTS public.ai_turn_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  job_id uuid NOT NULL UNIQUE,
  provider_event_id text,
  at timestamptz NOT NULL DEFAULT now(),
  inbound_preview text,
  reply_preview text,
  phone_mask text,
  decision_owner text,
  canonical_state text,
  conversation_state text,
  intent jsonb,
  routing jsonb,
  tools_requested jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools_executed jsonb NOT NULL DEFAULT '[]'::jsonb,
  silenced_by text,
  outbound jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_turn_sheets_barbershop_at_idx
  ON public.ai_turn_sheets (barbershop_id, at DESC);

CREATE INDEX IF NOT EXISTS ai_turn_sheets_conversation_at_idx
  ON public.ai_turn_sheets (conversation_id, at);
