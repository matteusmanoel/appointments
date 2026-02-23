-- Allow webhook to resolve barbershop by instance ID (Uazapi may send instanceId instead of instance name)
ALTER TABLE public.barbershop_whatsapp_connections
  ADD COLUMN IF NOT EXISTS uazapi_instance_id text;

CREATE INDEX IF NOT EXISTS barbershop_whatsapp_connections_uazapi_instance_id_idx
  ON public.barbershop_whatsapp_connections (uazapi_instance_id)
  WHERE uazapi_instance_id IS NOT NULL;
