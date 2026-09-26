-- PIX receiver metadata: holder name and key type for richer fallback message
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS pix_holder_name text,
  ADD COLUMN IF NOT EXISTS pix_key_type text
    CHECK (pix_key_type IN ('cpf', 'cnpj', 'telefone', 'email', 'aleatoria'));
