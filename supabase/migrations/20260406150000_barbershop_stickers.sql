-- Figurinhas da barbearia para envio pelo agente WhatsApp
CREATE TABLE IF NOT EXISTS public.barbershop_stickers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  media_url     TEXT NOT NULL,
  s3_key        TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS barbershop_stickers_barbershop_id_idx
  ON public.barbershop_stickers (barbershop_id);
