-- Local auth for on-prem: email + password_hash for profiles.
-- Run after the main schema (supabase/migrations). Backend uses this for login.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email) WHERE email IS NOT NULL;

COMMENT ON COLUMN public.profiles.email IS 'Login email for on-prem auth';
COMMENT ON COLUMN public.profiles.password_hash IS 'Bcrypt hash for on-prem auth';
