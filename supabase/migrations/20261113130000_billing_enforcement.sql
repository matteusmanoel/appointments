-- Aplicação do estado da assinatura Stripe: quando mudou, quando acaba o período e ordem dos eventos.
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS subscription_status_changed_at timestamptz;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS subscription_event_at timestamptz;
