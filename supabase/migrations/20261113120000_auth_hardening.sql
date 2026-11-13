-- Endurecimento de autenticação/cobrança: reset de senha por token de uso único,
-- idempotência de eventos do Stripe e troca única de session_id por JWT.
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_profile ON public.password_reset_tokens(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.checkout_session_exchanges (
  stripe_session_id text PRIMARY KEY,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
