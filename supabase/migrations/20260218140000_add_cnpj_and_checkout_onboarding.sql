-- Lead/checkout: CNPJ on barbershop; one-time onboarding credentials for success page
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS cnpj text;

CREATE TABLE IF NOT EXISTS public.checkout_onboarding (
  stripe_session_id text PRIMARY KEY,
  email text NOT NULL,
  barbershop_name text NOT NULL,
  temporary_password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.checkout_onboarding IS 'One-time storage for onboarding page: show temp password after checkout, then delete';
