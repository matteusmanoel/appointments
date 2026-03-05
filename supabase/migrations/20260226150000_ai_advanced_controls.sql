-- Controles avançados: max_output_tokens e typing_simulation
ALTER TABLE public.barbershop_ai_settings
  ADD COLUMN IF NOT EXISTS max_output_tokens int,
  ADD COLUMN IF NOT EXISTS typing_simulation jsonb;

UPDATE public.barbershop_ai_settings
SET max_output_tokens = COALESCE(max_output_tokens, 350)
WHERE max_output_tokens IS NULL;

COMMENT ON COLUMN public.barbershop_ai_settings.max_output_tokens IS 'Max tokens per reply (e.g. 350 for shorter WhatsApp messages)';
COMMENT ON COLUMN public.barbershop_ai_settings.typing_simulation IS 'Optional: { enabled, baseDelayMs, msPerChar, jitterMs } for delay before sending each message';
