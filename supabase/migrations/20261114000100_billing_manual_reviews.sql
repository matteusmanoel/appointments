-- Pagamentos que o provisionamento não pôde vincular sozinho (e-mail já pertence a outro tenant, assinatura viva de
-- outro cliente...). Registro durável para conferência manual: o webhook responde 200 e ninguém ganha acesso à conta alheia.
CREATE TABLE IF NOT EXISTS public.billing_manual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  stripe_customer_id text,
  stripe_session_id text NOT NULL,
  email text,
  barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_note text,
  UNIQUE (stripe_session_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_billing_manual_reviews_open ON public.billing_manual_reviews (created_at) WHERE resolved_at IS NULL;
-- Só o backend (dono da tabela) lê/escreve; sem policies, a API pública do Supabase não enxerga nada.
ALTER TABLE public.billing_manual_reviews ENABLE ROW LEVEL SECURITY;
