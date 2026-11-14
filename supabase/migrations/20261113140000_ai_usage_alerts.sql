-- Dedupe do aviso de uso da IA ao dono: 1 por barbearia, por mês (yyyy-mm) e por limiar.
CREATE TABLE IF NOT EXISTS public.ai_usage_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  period text NOT NULL,
  threshold_pct integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (barbershop_id, period, threshold_pct)
);
