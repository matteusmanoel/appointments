-- Migration: barbershop_whatsapp_connections + whatsapp_inbound_events (Uazapi plug-and-play)
-- Date: 2026-02-18

CREATE TABLE IF NOT EXISTS public.barbershop_whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'uazapi',
  whatsapp_phone text,
  uazapi_instance_name text,
  uazapi_instance_token_encrypted text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected')),
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(barbershop_id, provider)
);

CREATE INDEX IF NOT EXISTS barbershop_whatsapp_connections_barbershop_id_idx
  ON public.barbershop_whatsapp_connections (barbershop_id);

CREATE INDEX IF NOT EXISTS barbershop_whatsapp_connections_status_idx
  ON public.barbershop_whatsapp_connections (status);

-- Optional: audit + idempotency for inbound events
CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'uazapi',
  provider_event_id text,
  from_phone text NOT NULL,
  payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_inbound_events_barbershop_received_idx
  ON public.whatsapp_inbound_events (barbershop_id, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbound_events_provider_event_id_idx
  ON public.whatsapp_inbound_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL AND provider_event_id <> '';
