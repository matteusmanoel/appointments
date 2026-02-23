-- Premium: optional "premium" model for escalation (long conversations or repeated errors).
ALTER TABLE public.barbershop_ai_settings
  ADD COLUMN IF NOT EXISTS model_premium text;

COMMENT ON COLUMN public.barbershop_ai_settings.model_premium IS 'Optional stronger model for escalation (Premium plan). Used when conversation is long or has repeated tool errors.';
