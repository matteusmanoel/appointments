-- Um cliente Stripe = uma barbearia (tenant). Garante no banco o que o provisionamento já serializa por lock
-- (webhook × fallback de /billing/session): impede dois tenants para o mesmo stripe_customer_id.
--
-- Pré-checagem: se já existirem duplicados, a migration FALHA com mensagem clara e NÃO apaga nem altera nada.
-- Resolva à mão (decida qual barbearia fica) e rode de novo.
DO $$
DECLARE
  n integer;
  amostra text;
BEGIN
  SELECT count(*), string_agg(stripe_customer_id, ', ')
    INTO n, amostra
  FROM (
    SELECT stripe_customer_id
    FROM public.barbershops
    WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''
    GROUP BY stripe_customer_id
    HAVING count(*) > 1
    LIMIT 20
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Existem barbearias duplicadas para o mesmo stripe_customer_id (ex.: %). Nenhum dado foi apagado. Liste com: SELECT stripe_customer_id, array_agg(id) FROM public.barbershops WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id <> '''' GROUP BY 1 HAVING count(*) > 1; Resolva manualmente (mesclar/limpar o stripe_customer_id da barbearia que sobra) e rode a migration de novo.', amostra;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_barbershops_stripe_customer_id
  ON public.barbershops (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id <> '';
