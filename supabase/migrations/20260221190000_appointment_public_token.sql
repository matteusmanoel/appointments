-- Token for public reschedule/cancel links (no auth).
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS public_token uuid UNIQUE DEFAULT gen_random_uuid();

UPDATE public.appointments SET public_token = gen_random_uuid() WHERE public_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_public_token
  ON public.appointments (public_token) WHERE public_token IS NOT NULL;

COMMENT ON COLUMN public.appointments.public_token IS 'Secure token for public reschedule/cancel links.';
