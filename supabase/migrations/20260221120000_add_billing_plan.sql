-- Billing plan per barbershop: essential | pro | premium (default pro for existing tenants)
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS billing_plan text NOT NULL DEFAULT 'pro';

COMMENT ON COLUMN public.barbershops.billing_plan IS 'Plan tier: essential (dashboard + link only), pro (full + IA), premium';
