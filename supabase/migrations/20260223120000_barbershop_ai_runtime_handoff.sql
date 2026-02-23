-- Handoff humano: pausar IA quando atendente assume (auto-detect ou manual).
CREATE TABLE IF NOT EXISTS public.barbershop_ai_runtime (
  barbershop_id uuid PRIMARY KEY REFERENCES public.barbershops(id) ON DELETE CASCADE,
  paused_until timestamptz,
  paused_reason text,
  paused_by text CHECK (paused_by IS NULL OR paused_by IN ('auto', 'manual')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.barbershop_ai_runtime IS 'Estado de runtime da IA por barbershop: pausado até quando (handoff humano).';
COMMENT ON COLUMN public.barbershop_ai_runtime.paused_by IS 'auto = detectado mensagem do próprio número; manual = admin clicou Assumir.';
