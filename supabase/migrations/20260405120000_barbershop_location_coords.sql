-- Coordenadas para envio de localização (WhatsApp / UAZAPI) e exibição na IA
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.barbershops.latitude IS 'Latitude WGS84 para pin de localização (WhatsApp)';
COMMENT ON COLUMN public.barbershops.longitude IS 'Longitude WGS84 para pin de localização (WhatsApp)';
