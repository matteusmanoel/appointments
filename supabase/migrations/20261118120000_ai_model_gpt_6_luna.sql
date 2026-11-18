-- gpt-4o-mini e gpt-4o saem da API em 14/01/2027; gpt-4-turbo saiu em 23/10/2026.
ALTER TABLE public.barbershop_ai_settings
  ALTER COLUMN model SET DEFAULT 'gpt-6-luna';

UPDATE public.barbershop_ai_settings
SET model = 'gpt-6-luna', updated_at = now()
WHERE model IN (
  'gpt-4o-mini', 'gpt-4o-mini-2024-07-18',
  'gpt-4o', 'gpt-4o-2024-05-13', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20',
  'gpt-4-turbo', 'gpt-4-turbo-2024-04-09'
);

UPDATE public.barbershop_ai_settings
SET model_premium = 'gpt-6-luna', updated_at = now()
WHERE model_premium IN (
  'gpt-4o-mini', 'gpt-4o-mini-2024-07-18',
  'gpt-4o', 'gpt-4o-2024-05-13', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20',
  'gpt-4-turbo', 'gpt-4-turbo-2024-04-09'
);
