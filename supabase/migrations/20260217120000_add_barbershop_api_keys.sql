-- Migration: add barbershop_api_keys table for per-barbershop tools API keys
-- Date: 2026-02-17

CREATE TABLE IF NOT EXISTS public.barbershop_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS barbershop_api_keys_barbershop_id_idx
  ON public.barbershop_api_keys (barbershop_id);

CREATE INDEX IF NOT EXISTS barbershop_api_keys_revoked_at_idx
  ON public.barbershop_api_keys (revoked_at)
  WHERE revoked_at IS NULL;

