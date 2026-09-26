-- Photo and WhatsApp contact label for the Inteligência panel.
-- name_confirmed stays true for clients already registered by the shop.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS whatsapp_contact_name text,
  ADD COLUMN IF NOT EXISTS name_confirmed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clients.photo_url IS 'Profile photo URL (WhatsApp or set by the shop).';
COMMENT ON COLUMN public.clients.whatsapp_contact_name IS 'Push name from WhatsApp. Panel display only, not the agent name.';
COMMENT ON COLUMN public.clients.name_confirmed IS 'False until the shop confirms the client name.';
