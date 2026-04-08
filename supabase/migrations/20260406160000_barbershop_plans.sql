-- Chave PIX da barbearia para cobranças via WhatsApp
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS pix_key TEXT;

-- Planos de assinatura disponíveis na barbearia
CREATE TABLE IF NOT EXISTS public.barbershop_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  service_ids   UUID[] NOT NULL DEFAULT '{}',
  price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly'
                  CHECK (billing_cycle IN ('monthly','quarterly','yearly')),
  max_visits    INT CHECK (max_visits IS NULL OR max_visits > 0),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS barbershop_plans_barbershop_id_idx
  ON public.barbershop_plans (barbershop_id);

-- Assinaturas de clientes a planos
CREATE TABLE IF NOT EXISTS public.client_plan_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id     UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES public.barbershop_plans(id),
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','suspended','cancelled')),
  billing_day       INT NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  next_billing_date DATE NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_plan_subscriptions_barbershop_status_idx
  ON public.client_plan_subscriptions (barbershop_id, status);

CREATE INDEX IF NOT EXISTS client_plan_subscriptions_next_billing_idx
  ON public.client_plan_subscriptions (next_billing_date) WHERE status = 'active';

-- Cobranças PIX por ciclo de assinatura
CREATE TABLE IF NOT EXISTS public.plan_pix_charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.client_plan_subscriptions(id) ON DELETE CASCADE,
  barbershop_id   UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','paid','failed','skipped')),
  due_date        DATE NOT NULL,
  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plan_pix_charges_subscription_status_idx
  ON public.plan_pix_charges (subscription_id, status);

CREATE INDEX IF NOT EXISTS plan_pix_charges_barbershop_due_idx
  ON public.plan_pix_charges (barbershop_id, due_date) WHERE status = 'pending';
