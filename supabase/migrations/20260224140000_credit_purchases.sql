-- Record of credit purchases (Stripe checkout) for audit and idempotency.
CREATE TABLE IF NOT EXISTS public.credit_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL UNIQUE,
  credit_type text NOT NULL DEFAULT 'followup_manual',
  quantity int NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_barbershop
  ON public.credit_purchases (barbershop_id);
