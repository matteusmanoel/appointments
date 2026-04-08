-- MVP P0/P1 baseline:
-- 1) Extend scheduled_messages types
-- 2) Add clients.birth_date
-- 3) Add appointment_waitlist table

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
      'opening_summary'
    )
  );

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS birth_date date;

COMMENT ON COLUMN public.clients.birth_date IS 'Client birthday (optional) for birthday automation.';

CREATE TABLE IF NOT EXISTS public.appointment_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  client_phone text NOT NULL,
  client_name text,
  desired_date date NOT NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'notified', 'converted', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_barbershop_date_status
  ON public.appointment_waitlist (barbershop_id, desired_date, status);

CREATE INDEX IF NOT EXISTS idx_waitlist_phone
  ON public.appointment_waitlist (barbershop_id, client_phone);
