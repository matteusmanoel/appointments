-- Cobrança de plano (ADR 0003): manual por padrão, automático por assinatura,
-- uma cobrança por vencimento e recebimento lançado pelo operador.

ALTER TABLE public.client_plan_subscriptions
  ADD COLUMN IF NOT EXISTS auto_billing boolean NOT NULL DEFAULT false;

ALTER TABLE public.plan_pix_charges
  ADD COLUMN IF NOT EXISTS paid_method text;

ALTER TABLE public.plan_pix_charges
  DROP CONSTRAINT IF EXISTS plan_pix_charges_paid_method_check;

ALTER TABLE public.plan_pix_charges
  ADD CONSTRAINT plan_pix_charges_paid_method_check
  CHECK (paid_method IS NULL OR paid_method IN ('cash', 'pix'));

-- One live charge per (subscription, due date): keep paid > sent > pending, older first; the rest become skipped.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY subscription_id, due_date
           ORDER BY CASE status WHEN 'paid' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, created_at ASC, id ASC
         ) AS rn
  FROM public.plan_pix_charges
  WHERE status IN ('pending', 'sent', 'paid')
)
UPDATE public.plan_pix_charges ch
SET status = 'skipped'
FROM ranked
WHERE ranked.id = ch.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS plan_pix_charges_subscription_due_live_uniq
  ON public.plan_pix_charges (subscription_id, due_date)
  WHERE status IN ('pending', 'sent', 'paid');

ALTER TABLE public.scheduled_messages
  DROP CONSTRAINT IF EXISTS scheduled_messages_type_check;

ALTER TABLE public.scheduled_messages
  ADD CONSTRAINT scheduled_messages_type_check
  CHECK (
    type IN (
      'reminder_24h',
      'reminder_2h',
      'followup_30d',
      'manual',
      'campaign',
      'payment_reminder',
      'birthday',
      'opening_summary',
      'plan_billing'
    )
  );
