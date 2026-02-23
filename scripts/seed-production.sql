-- =============================================================================
-- Seed produção: admin + dados de teste (executar no SQL Editor do Supabase)
-- Idempotente: só insere quando não existir.
-- Login: admin@navalhia.com.br / Senha: admin123
--
-- Inclui alteração de profiles (email/password_hash) se ainda não existir.
-- =============================================================================

-- Colunas de login em profiles (idempotente)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email) WHERE email IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Barbershop (usa a primeira existente ou cria "Minha NavalhIA")
INSERT INTO public.barbershops (id, name, slug, phone, email, address)
SELECT gen_random_uuid(), 'Minha NavalhIA', 'minha-navalhia', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.barbershops LIMIT 1);

-- 2) Admin (senha: admin123) — só se o email ainda não existir
INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role)
SELECT
  gen_random_uuid(),
  (SELECT id FROM public.barbershops ORDER BY created_at ASC LIMIT 1),
  'Admin',
  'admin@navalhia.com.br',
  crypt('admin123', gen_salt('bf', 10)),
  'admin'
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'admin@navalhia.com.br');

-- 3) Serviços de teste (só se ainda não houver serviços para a barbershop)
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

-- 4) Barbeiros de teste
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

-- 5) Clientes de teste
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

-- 6) Agendamentos de teste (amanhã)
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
