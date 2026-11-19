-- Motor novo do agente: comparação em sombra, escolha por barbearia e estado único por conversa.
CREATE TABLE IF NOT EXISTS public.ai_turn_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_text text NOT NULL,
  conversation_state text NOT NULL,
  rules jsonb,
  interpretation jsonb,
  agrees boolean,
  error text,
  latency_ms integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_turn_shadow_shop_created_idx
  ON public.ai_turn_shadow (barbershop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_turn_shadow_created_idx
  ON public.ai_turn_shadow (created_at);

COMMENT ON TABLE public.ai_turn_shadow IS
  'Compara regras e interpretador por LLM sem afetar o cliente. Linhas com mais de 30 dias são apagadas pela aplicação.';

ALTER TABLE public.barbershop_ai_settings
  ADD COLUMN IF NOT EXISTS agent_engine text NOT NULL DEFAULT 'legacy'
  CHECK (agent_engine IN ('legacy', 'v2'));

ALTER TABLE public.ai_conversation_runtime
  ADD COLUMN IF NOT EXISTS agent_engine text CHECK (agent_engine IN ('legacy', 'v2')),
  ADD COLUMN IF NOT EXISTS agent_state jsonb;
