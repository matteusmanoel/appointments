-- clean-tenant.sql
-- Limpa dados de demo do tenant (barbershop) preservando contas/admin/settings.
-- Execute: psql $DATABASE_URL -f scripts/clean-tenant.sql
-- Identifica a barbershop principal (mais antiga) e remove todos os dados transacionais.

DO $$
DECLARE
  v_barbershop_id uuid;
BEGIN
  SELECT id INTO v_barbershop_id
  FROM public.barbershops
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_barbershop_id IS NULL THEN
    RAISE NOTICE 'Nenhuma barbershop encontrada. Nada removido.';
    RETURN;
  END IF;

  RAISE NOTICE 'Limpando dados do tenant barbershop_id=%', v_barbershop_id;

  -- Remover jobs e mensagens de IA
  DELETE FROM public.ai_jobs
    WHERE conversation_id IN (
      SELECT id FROM public.ai_conversations WHERE barbershop_id = v_barbershop_id
    );
  DELETE FROM public.ai_messages
    WHERE conversation_id IN (
      SELECT id FROM public.ai_conversations WHERE barbershop_id = v_barbershop_id
    );
  DELETE FROM public.ai_conversations WHERE barbershop_id = v_barbershop_id;

  -- Remover mensagens agendadas
  DELETE FROM public.scheduled_messages WHERE barbershop_id = v_barbershop_id;

  -- Remover agendamentos e serviços snapshot
  DELETE FROM public.appointment_services
    WHERE appointment_id IN (
      SELECT id FROM public.appointments WHERE barbershop_id = v_barbershop_id
    );
  DELETE FROM public.appointments WHERE barbershop_id = v_barbershop_id;

  -- Remover clientes
  DELETE FROM public.clients WHERE barbershop_id = v_barbershop_id;

  -- Remover vínculos barbeiro-serviço
  DELETE FROM public.barber_services
    WHERE barber_id IN (
      SELECT id FROM public.barbers WHERE barbershop_id = v_barbershop_id
    );

  -- Remover barbeiros
  DELETE FROM public.barbers WHERE barbershop_id = v_barbershop_id;

  -- Remover serviços
  DELETE FROM public.services WHERE barbershop_id = v_barbershop_id;

  -- Remover memória de IA de clientes (se existir)
  DELETE FROM public.client_ai_memory WHERE barbershop_id = v_barbershop_id;

  -- Remover incidents de IA (se existir)
  DELETE FROM public.ai_incidents WHERE barbershop_id = v_barbershop_id;

  RAISE NOTICE 'Limpeza concluída para barbershop_id=%', v_barbershop_id;
END;
$$;
