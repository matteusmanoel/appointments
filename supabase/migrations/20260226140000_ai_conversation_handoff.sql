-- Handoff por conversa: pausa por conversation_id (não mais só por barbershop).
-- Permite que o humano assuma uma conversa específica sem pausar todas as outras.

-- 1) Runtime por conversa
CREATE TABLE IF NOT EXISTS public.ai_conversation_runtime (
  conversation_id uuid PRIMARY KEY REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  paused_until timestamptz,
  paused_by text CHECK (paused_by IS NULL OR paused_by IN ('auto', 'manual', 'rule')),
  paused_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_conversation_runtime_paused_until_idx
  ON public.ai_conversation_runtime (paused_until) WHERE paused_until IS NOT NULL;

COMMENT ON TABLE public.ai_conversation_runtime IS 'Pause handoff por conversa: quando humano responde (fromMe) ou assume manualmente.';

-- 2) Configurações de handoff por barbershop
CREATE TABLE IF NOT EXISTS public.barbershop_ai_handoff_settings (
  barbershop_id uuid PRIMARY KEY REFERENCES public.barbershops(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  pause_hours int NOT NULL DEFAULT 4,
  on_user_request_enabled boolean NOT NULL DEFAULT true,
  user_request_keywords text[] NOT NULL DEFAULT ARRAY['falar com humano', 'atendente', 'pessoa', 'assistência humana']::text[],
  on_agent_failure_enabled boolean NOT NULL DEFAULT false,
  handoff_message text,
  resume_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.barbershop_ai_handoff_settings IS 'Configuração de handoff: keywords, mensagens, pause_hours.';

-- 3) Auditoria de handoff
CREATE TABLE IF NOT EXISTS public.ai_handoff_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('paused', 'resumed')),
  triggered_by text NOT NULL CHECK (triggered_by IN ('auto', 'manual', 'rule', 'keyword', 'agent_failure')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_handoff_events_conversation_created_idx
  ON public.ai_handoff_events (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_handoff_events_barbershop_created_idx
  ON public.ai_handoff_events (barbershop_id, created_at DESC);

COMMENT ON TABLE public.ai_handoff_events IS 'Auditoria de pausas e retomadas de handoff.';
