-- Credits for manual follow-up (and future paid automations).
-- Balance is debited on dispatch and credited via Stripe checkout.
CREATE TABLE IF NOT EXISTS public.barbershop_message_credits (
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  credit_type text NOT NULL DEFAULT 'followup_manual' CHECK (credit_type IN ('followup_manual')),
  balance int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (barbershop_id, credit_type)
);

COMMENT ON TABLE public.barbershop_message_credits IS 'Credit balance per barbershop for manual follow-up messages; topped up via Stripe.';
