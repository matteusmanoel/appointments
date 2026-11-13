-- Backfill das assinaturas que já existiam antes de o estado do Stripe ser aplicado + log de avisos (dedupe).
-- Regra idêntica a planBackfill() em backend/src/billing-access.ts (BILLING_GRACE_DAYS padrão = 7).

-- past_due/incomplete/unpaid sem data de referência: a tolerância começa AGORA (sem isso ela deslizaria para sempre).
UPDATE public.barbershops
SET subscription_status_changed_at = now()
WHERE stripe_subscription_id IS NOT NULL
  AND subscription_status IN ('past_due', 'incomplete', 'unpaid')
  AND subscription_status_changed_at IS NULL;

-- canceled/incomplete_expired/outros sem fim de período: período de despedida de 7 dias (sem corte de surpresa).
UPDATE public.barbershops
SET subscription_current_period_end = now() + interval '7 days'
WHERE stripe_subscription_id IS NOT NULL
  AND subscription_status IS NOT NULL
  AND subscription_status NOT IN ('active', 'trialing', 'past_due', 'incomplete', 'unpaid')
  AND subscription_current_period_end IS NULL;

CREATE TABLE IF NOT EXISTS public.billing_notice_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (barbershop_id, kind, ref)
);
