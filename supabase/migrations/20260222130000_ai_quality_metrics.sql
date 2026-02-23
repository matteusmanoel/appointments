-- Metrics per assistant message for observability (violations, emoji count)
-- Used for "Saúde do atendente" dashboard and regression alerts
CREATE TABLE IF NOT EXISTS public.ai_quality_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  violations text[] NOT NULL DEFAULT '{}',
  emoji_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_quality_metrics_barbershop_created_idx
  ON public.ai_quality_metrics (barbershop_id, created_at DESC);

COMMENT ON TABLE public.ai_quality_metrics IS 'Quality metrics per AI reply (non-sandbox) for health dashboard';
