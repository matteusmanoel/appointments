-- Trace por turno do simulador CLI local (feat/agente-simulador-cli).
-- Gravação desligada por padrão: só escreve quando AI_SIMULATOR_TRACE_ENABLED=true.
-- Não usar em produção.

CREATE TABLE IF NOT EXISTS public.ai_simulator_turn_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  turn_index integer NOT NULL,
  simulated_now timestamptz,
  user_message text NOT NULL,
  intent jsonb,
  draft jsonb,
  tools jsonb,
  final_reply text,
  ai_exposure jsonb,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_simulator_turn_traces_conversation_idx
  ON public.ai_simulator_turn_traces (conversation_id, turn_index, created_at);

COMMENT ON TABLE public.ai_simulator_turn_traces IS
  'Traces do simulador CLI local. Escrita controlada por AI_SIMULATOR_TRACE_ENABLED (default off).';
