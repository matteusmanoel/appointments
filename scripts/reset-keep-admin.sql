-- =============================================================================
-- Reset: mantém apenas o usuário admin@navalhia.com.br e sua barbershop/conta.
-- Remove todos os outros dados e todo o "conteúdo" da barbershop do admin
-- para permitir rodar o seed completo em seguida.
--
-- Uso: psql ... -f scripts/reset-keep-admin.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Colunas de login em profiles (idempotente)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email) WHERE email IS NOT NULL;

DO $$
DECLARE
  admin_id UUID;
  B0 UUID;
  A0 UUID;
BEGIN
  -- 1) Garantir que existem barbershop + account + perfil admin (senha: admin123)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'admin@navalhia.com.br') THEN
    INSERT INTO public.barbershops (id, name, slug, phone, email, address)
    VALUES (gen_random_uuid(), 'Minha NavalhIA', 'minha-navalhia', NULL, NULL, NULL);
    UPDATE public.barbershops SET billing_plan = 'premium' WHERE slug = 'minha-navalhia' AND (billing_plan IS NULL OR billing_plan = 'pro');
    INSERT INTO public.accounts (id, name) VALUES (gen_random_uuid(), 'Minha NavalhIA');
    UPDATE public.barbershops b SET account_id = a.id FROM public.accounts a WHERE b.slug = 'minha-navalhia' AND b.account_id IS NULL;
    INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
    SELECT gen_random_uuid(), b.id, 'Admin', 'admin@navalhia.com.br', crypt('admin123', gen_salt('bf', 10)), 'admin'
    FROM public.barbershops b WHERE b.slug = 'minha-navalhia' LIMIT 1;
    INSERT INTO public.account_memberships (profile_id, account_id, role)
    SELECT p.id, b.account_id, 'owner' FROM public.profiles p
    JOIN public.barbershops b ON b.id = p.barbershop_id
    WHERE p.email = 'admin@navalhia.com.br' AND b.account_id IS NOT NULL
    ON CONFLICT (profile_id, account_id) DO NOTHING;
  END IF;

  SELECT p.id, p.barbershop_id, b.account_id INTO admin_id, B0, A0
  FROM public.profiles p
  JOIN public.barbershops b ON b.id = p.barbershop_id
  WHERE p.email = 'admin@navalhia.com.br'
  LIMIT 1;

  IF admin_id IS NULL OR B0 IS NULL THEN
    RAISE EXCEPTION 'Admin profile or barbershop not found after ensure step';
  END IF;

  -- 2) Remover conteúdo de todas as barbershops (ordem respeitando FKs)
  DELETE FROM public.reward_redemptions WHERE client_id IN (SELECT id FROM public.clients);
  DELETE FROM public.service_redemptions WHERE client_id IN (SELECT id FROM public.clients);
  DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments);
  DELETE FROM public.appointments;
  DELETE FROM public.scheduled_messages;
  DELETE FROM public.ai_messages WHERE conversation_id IN (SELECT id FROM public.ai_conversations);
  DELETE FROM public.ai_jobs;
  DELETE FROM public.ai_conversations;
  DELETE FROM public.ai_handoff_events;
  DELETE FROM public.ai_quality_metrics;
  DELETE FROM public.barbershop_ai_knowledge_chunks;
  DELETE FROM public.barbershop_ai_knowledge_jobs;
  DELETE FROM public.barbershop_ai_knowledge_documents;
  DELETE FROM public.barbershop_ai_knowledge_sources;
  DELETE FROM public.barbershop_ai_runtime;
  DELETE FROM public.barbershop_ai_handoff_settings;
  DELETE FROM public.barbershop_ai_prompt_versions;
  DELETE FROM public.barbershop_ai_settings;
  DELETE FROM public.outbound_events;
  DELETE FROM public.whatsapp_inbound_events;
  DELETE FROM public.barbershop_whatsapp_connections;
  DELETE FROM public.message_campaigns;
  DELETE FROM public.message_templates;
  DELETE FROM public.barbershop_message_credits;
  DELETE FROM public.credit_purchases;
  DELETE FROM public.barbershop_closures;
  DELETE FROM public.loyalty_rewards;
  DELETE FROM public.barber_services;
  DELETE FROM public.barbers;
  DELETE FROM public.services;
  DELETE FROM public.clients;

  -- 3) Remover outras barbershops, contas, memberships e perfis
  DELETE FROM public.barbershops WHERE id != B0;
  DELETE FROM public.accounts WHERE id != A0;
  DELETE FROM public.account_memberships WHERE account_id != A0;
  DELETE FROM public.profiles WHERE id != admin_id;

  RAISE NOTICE 'Reset concluído: mantido admin@navalhia.com.br e barbershop %', B0;
END $$;
