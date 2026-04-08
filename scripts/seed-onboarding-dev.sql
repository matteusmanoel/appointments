-- =============================================================================
-- Simula o provisionamento de um NOVO TENANT em desenvolvimento.
-- NÃO chame este arquivo diretamente — use simulate-onboarding.sh
-- (ele injeta as variáveis via GUCs antes de executar este arquivo).
--
-- GUCs esperadas (definidas pelo script):
--   navalhia.dev_email  TEXT
--   navalhia.dev_senha  TEXT
--   navalhia.dev_nome   TEXT
--   navalhia.dev_plano  TEXT
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$
DECLARE
  v_email        TEXT := current_setting('navalhia.dev_email', false);
  v_senha        TEXT := current_setting('navalhia.dev_senha', false);
  v_nome         TEXT := current_setting('navalhia.dev_nome',  false);
  v_plano        TEXT := current_setting('navalhia.dev_plano', false);

  v_slug         TEXT;
  v_slug_base    TEXT;
  v_suffix       INT := 0;
  v_account_id   UUID;
  v_shop_id      UUID;
  v_profile_id   UUID;
  v_pw_hash      TEXT;
  v_fake_cust_id TEXT;
BEGIN
  v_email := LOWER(TRIM(v_email));

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email "%" já existe. Use outro email ou delete o perfil existente.', v_email;
  END IF;

  -- Gera slug único a partir do nome (LOWER primeiro, depois regex remove não-alfanuméricos)
  v_slug_base := REGEXP_REPLACE(LOWER(unaccent(v_nome)), '[^a-z0-9]+', '-', 'g');
  v_slug_base := REGEXP_REPLACE(v_slug_base, '-+', '-', 'g');
  v_slug_base := TRIM(BOTH '-' FROM v_slug_base);
  v_slug := v_slug_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.barbershops WHERE slug = v_slug);
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix;
  END LOOP;

  v_fake_cust_id := 'cus_dev_' || LEFT(MD5(v_email || now()::text), 16);
  v_pw_hash := crypt(v_senha, gen_salt('bf', 10));

  -- 1. Account
  INSERT INTO public.accounts (name)
  VALUES (v_nome)
  RETURNING id INTO v_account_id;

  -- 2. Barbershop
  INSERT INTO public.barbershops
    (account_id, name, slug, email, billing_plan, stripe_customer_id, subscription_status)
  VALUES
    (v_account_id, v_nome, v_slug, v_email, v_plano, v_fake_cust_id, 'active')
  RETURNING id INTO v_shop_id;

  -- 3. Perfil admin (must_change_password replicando o webhook de produção)
  INSERT INTO public.profiles
    (user_id, barbershop_id, full_name, email, password_hash, role, must_change_password)
  VALUES
    (gen_random_uuid(), v_shop_id, v_nome, v_email, v_pw_hash, 'admin', true)
  RETURNING id INTO v_profile_id;

  -- 4. Account membership (owner)
  INSERT INTO public.account_memberships (profile_id, account_id, role)
  VALUES (v_profile_id, v_account_id, 'owner');

  -- 5. Serviços padrão
  INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, category)
  VALUES
    (v_shop_id, 'Corte masculino', 'Corte com máquina e tesoura', 35.0, 30, 'corte'),
    (v_shop_id, 'Barba completa',  'Barba com toalha quente',     25.0, 25, 'barba'),
    (v_shop_id, 'Corte + Barba',   'Combo completo',              55.0, 50, 'combo');

  RAISE NOTICE '=== Tenant provisionado ===';
  RAISE NOTICE 'Barbearia : % (id: %)', v_nome, v_shop_id;
  RAISE NOTICE 'Slug      : %', v_slug;
  RAISE NOTICE 'Email     : %', v_email;
  RAISE NOTICE 'Plano     : %', v_plano;
END $$;

-- Exibe resumo capturável pelo script
SELECT
  p.email,
  b.name           AS barbershop_name,
  b.slug,
  b.billing_plan,
  b.id::text       AS barbershop_id,
  p.id::text       AS profile_id,
  p.must_change_password
FROM public.profiles p
JOIN public.barbershops b ON b.id = p.barbershop_id
WHERE p.email = LOWER(TRIM(current_setting('navalhia.dev_email', false)))
ORDER BY p.created_at DESC
LIMIT 1;
