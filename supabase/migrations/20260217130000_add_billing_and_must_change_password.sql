-- Billing: Stripe IDs on barbershops (MVP simple)
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text;

-- First-login: force password change for provisioned users (e.g. after Stripe provisioning)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.must_change_password IS 'When true, frontend should force user to change password on first login';
