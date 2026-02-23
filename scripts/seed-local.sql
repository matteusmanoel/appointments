-- =============================================================================
-- Seed LOCAL (container / desenvolvimento): admin@navalhia.com.br com todos os
-- privilégios e dados para testar antes do deploy.
-- Idempotente: pode ser executado várias vezes.
-- Login: admin@navalhia.com.br / Senha: admin123
--
-- Aplica:
--   - Plano Premium na barbershop (criar nova filial, IA premium, etc.)
--   - Conta (account) e membership para multi-filial e seletor de unidade
--   - Serviços, barbeiros, clientes e agendamentos de teste
--
-- Como rodar no container local (após migrações aplicadas):
--   docker compose exec -T db psql -U navalhia -d navalhia < scripts/seed-local.sql
--
-- Ou a partir do host (com psql instalado):
--   PGPASSWORD=navalhia_secret psql -h localhost -p 5432 -U navalhia -d navalhia -f scripts/seed-local.sql
-- =============================================================================

-- Colunas de login em profiles (idempotente)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email) WHERE email IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Barbershop (cria "Minha NavalhIA" se não existir)
INSERT INTO public.barbershops (id, name, slug, phone, email, address)
SELECT gen_random_uuid(), 'Minha NavalhIA', 'minha-navalhia', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.barbershops LIMIT 1);

-- 2) Garantir plano Premium na primeira barbershop (testar criar filial, etc.)
UPDATE public.barbershops
SET billing_plan = 'premium'
WHERE id = (SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1);

-- 3) Conta (account) para multi-filial: criar e vincular se a barbershop não tiver
DO $$
DECLARE
  bid UUID;
  aid UUID;
  bname TEXT;
BEGIN
  SELECT id, name INTO bid, bname FROM public.barbershops ORDER BY created_at ASC LIMIT 1;
  IF bid IS NULL THEN RETURN; END IF;
  IF (SELECT account_id FROM public.barbershops WHERE id = bid) IS NULL THEN
    INSERT INTO public.accounts (name) VALUES (COALESCE(bname, 'Minha conta')) RETURNING id INTO aid;
    UPDATE public.barbershops SET account_id = aid WHERE id = bid;
  END IF;
END $$;

-- 4) Admin (senha: admin123) — só se o email ainda não existir
INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
SELECT
  gen_random_uuid(),
  (SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1),
  'Admin',
  'admin@navalhia.com.br',
  crypt('admin123', gen_salt('bf', 10)),
  'admin'
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'admin@navalhia.com.br');

-- 5) Membership: admin deve ser owner da conta da barbershop (para /me retornar barbershops e trocar unidade)
INSERT INTO public.account_memberships (profile_id, account_id, role)
SELECT p.id, b.account_id, 'owner'
FROM public.profiles p
JOIN public.barbershops b ON b.id = p.barbershop_id
WHERE p.email = 'admin@navalhia.com.br'
  AND b.account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.account_memberships am
    WHERE am.profile_id = p.id AND am.account_id = b.account_id
  );

-- 6) Serviços de teste
DO $$
DECLARE
  bid UUID;
BEGIN
  SELECT id INTO bid FROM public.barbershops ORDER BY created_at ASC LIMIT 1;
  IF bid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.services WHERE barbershop_id = bid LIMIT 1) THEN
    INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, category)
    VALUES
      (bid, 'Corte masculino', 'Corte moderno com máquina e tesoura', 35.0, 30, 'corte'),
      (bid, 'Barba completa', 'Barba com toalha quente e finalização', 25.0, 25, 'barba'),
      (bid, 'Corte + Barba', 'Combo completo', 55.0, 50, 'combo'),
      (bid, 'Sobrancelha', 'Design e correção', 15.0, 15, 'adicional');
  END IF;
END $$;

-- 7) Barbeiros de teste
DO $$
DECLARE
  bid UUID;
  barber_ids UUID[];
  sid RECORD;
  default_schedule JSONB := '{"monday":{"start":"09:00","end":"19:00"},"tuesday":{"start":"09:00","end":"19:00"},"wednesday":{"start":"09:00","end":"19:00"},"thursday":{"start":"09:00","end":"19:00"},"friday":{"start":"09:00","end":"19:00"},"saturday":{"start":"09:00","end":"18:00"},"sunday":null}'::jsonb;
BEGIN
  SELECT id INTO bid FROM public.barbershops ORDER BY created_at ASC LIMIT 1;
  IF bid IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.barbers WHERE barbershop_id = bid LIMIT 1) THEN
    INSERT INTO public.barbers (barbershop_id, name, phone, status, commission_percentage, schedule)
    VALUES
      (bid, 'João Silva', '11987654321', 'active', 40, default_schedule),
      (bid, 'Carlos Santos', '11976543210', 'active', 40, default_schedule);
    SELECT ARRAY_AGG(id) INTO barber_ids FROM public.barbers WHERE barbershop_id = bid;
    FOR sid IN SELECT id FROM public.services WHERE barbershop_id = bid
    LOOP
      INSERT INTO public.barber_services (barber_id, service_id)
      SELECT b.id, sid.id FROM public.barbers b WHERE b.barbershop_id = bid
      ON CONFLICT (barber_id, service_id) DO NOTHING;
    END LOOP;
  END IF;
END $$;

-- 8) Clientes de teste
DO $$
DECLARE
  bid UUID;
BEGIN
  SELECT id INTO bid FROM public.barbershops ORDER BY created_at ASC LIMIT 1;
  IF bid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE barbershop_id = bid LIMIT 1) THEN
    INSERT INTO public.clients (barbershop_id, name, phone)
    VALUES
      (bid, 'Pedro Oliveira', '45998022522'),
      (bid, 'Maria Souza', '11999887766'),
      (bid, 'Lucas Lima', '21988776655');
  END IF;
END $$;

-- 9) Agendamentos de teste (amanhã)
DO $$
DECLARE
  bid UUID;
  cid1 UUID; cid2 UUID;
  barber_id1 UUID; barber_id2 UUID;
  svc_id UUID;
  amanha DATE;
BEGIN
  SELECT id INTO bid FROM public.barbershops ORDER BY created_at ASC LIMIT 1;
  IF bid IS NULL THEN RETURN; END IF;
  amanha := CURRENT_DATE + 1;
  SELECT id INTO svc_id FROM public.services WHERE barbershop_id = bid LIMIT 1;
  SELECT id INTO cid1 FROM public.clients WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET 0;
  SELECT id INTO cid2 FROM public.clients WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET 1;
  SELECT id INTO barber_id1 FROM public.barbers WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET 0;
  SELECT id INTO barber_id2 FROM public.barbers WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET 1;
  IF svc_id IS NOT NULL AND cid1 IS NOT NULL AND cid2 IS NOT NULL AND barber_id1 IS NOT NULL AND barber_id2 IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.appointments WHERE barbershop_id = bid LIMIT 1) THEN
    INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
    VALUES
      (bid, cid1, barber_id1, svc_id, amanha, '10:00'::time, 30, 35.0, 14.0, 'pending'),
      (bid, cid2, barber_id2, svc_id, amanha, '14:30'::time, 30, 35.0, 14.0, 'confirmed');
  END IF;
END $$;
