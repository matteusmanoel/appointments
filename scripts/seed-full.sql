-- =============================================================================
-- Seed completo: popula todas as telas do sistema com dados para testes de UI.
-- Deve ser executado após reset-keep-admin.sql.
-- Login: admin@navalhia.com.br / Senha: admin123
-- =============================================================================

DO $$
DECLARE
  bid UUID;
  aid UUID;
  default_schedule JSONB := '{"monday":{"start":"09:00","end":"19:00"},"tuesday":{"start":"09:00","end":"19:00"},"wednesday":{"start":"09:00","end":"19:00"},"thursday":{"start":"09:00","end":"19:00"},"friday":{"start":"09:00","end":"19:00"},"saturday":{"start":"09:00","end":"18:00"},"sunday":null}'::jsonb;
  sid UUID;
  cid UUID;
  barber_pk UUID;
  svc_corte UUID; svc_barba UUID; svc_combo UUID; svc_sobrancelha UUID; svc_coloracao UUID;
  i INT;
  d DATE;
  reward_id UUID;
BEGIN
  SELECT id, account_id INTO bid, aid FROM public.barbershops LIMIT 1;
  IF bid IS NULL THEN
    RAISE EXCEPTION 'Nenhuma barbershop encontrada. Rode reset-keep-admin.sql antes.';
  END IF;

  UPDATE public.barbershops SET billing_plan = 'premium', name = 'Minha NavalhIA', slug = 'minha-navalhia' WHERE id = bid;

  -- ---------- Serviços (telas Serviços + Agendamentos) ----------
  INSERT INTO public.services (barbershop_id, name, description, price, duration_minutes, category, points_to_earn, points_to_redeem)
  VALUES
    (bid, 'Corte masculino', 'Corte moderno com máquina e tesoura', 35.00, 30, 'corte', 10, NULL),
    (bid, 'Barba completa', 'Barba com toalha quente e finalização', 25.00, 25, 'barba', 8, NULL),
    (bid, 'Corte + Barba', 'Combo completo', 55.00, 50, 'combo', 18, 80),
    (bid, 'Sobrancelha', 'Design e correção', 15.00, 15, 'adicional', 5, NULL),
    (bid, 'Coloração', 'Coloração profissional', 80.00, 60, 'tratamento', 25, 120),
    (bid, 'Degradê', 'Corte degradê navalha', 40.00, 35, 'corte', 12, NULL),
    (bid, 'Relaxamento', 'Relaxamento capilar', 60.00, 45, 'tratamento', 18, NULL);
  SELECT id INTO svc_corte FROM public.services WHERE barbershop_id = bid AND name = 'Corte masculino' LIMIT 1;
  SELECT id INTO svc_barba FROM public.services WHERE barbershop_id = bid AND name = 'Barba completa' LIMIT 1;
  SELECT id INTO svc_combo FROM public.services WHERE barbershop_id = bid AND name = 'Corte + Barba' LIMIT 1;
  SELECT id INTO svc_sobrancelha FROM public.services WHERE barbershop_id = bid AND name = 'Sobrancelha' LIMIT 1;
  SELECT id INTO svc_coloracao FROM public.services WHERE barbershop_id = bid AND name = 'Coloração' LIMIT 1;

  -- ---------- Barbeiros (tela Barbeiros + ranking Dashboard) ----------
  INSERT INTO public.barbers (barbershop_id, name, phone, status, commission_percentage, schedule)
  VALUES
    (bid, 'João Silva', '11987654321', 'active', 40, default_schedule),
    (bid, 'Carlos Santos', '11976543210', 'active', 40, default_schedule),
    (bid, 'Miguel Oliveira', '11965432109', 'active', 35, default_schedule),
    (bid, 'Rafael Lima', '11954321098', 'active', 42, default_schedule),
    (bid, 'Bruno Costa', '11943210987', 'inactive', 40, default_schedule);
  FOR sid IN SELECT id FROM public.services WHERE barbershop_id = bid
  LOOP
    INSERT INTO public.barber_services (barber_id, service_id)
    SELECT b.id, sid FROM public.barbers b WHERE b.barbershop_id = bid
    ON CONFLICT (barber_id, service_id) DO NOTHING;
  END LOOP;

  -- ---------- Clientes (tela Clientes + agendamentos) ----------
  INSERT INTO public.clients (barbershop_id, name, phone, email, notes, total_visits, total_spent, loyalty_points, marketing_opt_out)
  VALUES
    (bid, 'Pedro Oliveira', '45998022522', 'pedro@email.com', 'Prefere João', 12, 420.00, 120, false),
    (bid, 'Maria Souza', '11999887766', 'maria@email.com', NULL, 8, 280.00, 80, false),
    (bid, 'Lucas Lima', '21988776655', 'lucas@email.com', NULL, 5, 175.00, 50, false),
    (bid, 'Ana Costa', '31977665544', 'ana@email.com', NULL, 20, 750.00, 200, false),
    (bid, 'Felipe Rocha', '41966554433', NULL, NULL, 3, 105.00, 30, false),
    (bid, 'Juliana Mendes', '51955443322', 'ju@email.com', NULL, 7, 265.00, 70, true),
    (bid, 'Roberto Alves', '61944332211', NULL, NULL, 15, 600.00, 150, false),
    (bid, 'Carla Ferreira', '71933221100', 'carla@email.com', NULL, 4, 140.00, 40, false),
    (bid, 'Daniel Martins', '81922110099', NULL, NULL, 9, 350.00, 90, false),
    (bid, 'Fernanda Gomes', '11911009988', 'fe@email.com', NULL, 6, 220.00, 60, false),
    (bid, 'André Pereira', '21900998877', NULL, NULL, 2, 70.00, 20, false),
    (bid, 'Patricia Dias', '31999887766', 'paty@email.com', NULL, 11, 410.00, 110, false),
    (bid, 'Ricardo Nunes', '41988776655', NULL, NULL, 1, 35.00, 10, false),
    (bid, 'Camila Teixeira', '51977665544', 'camila@email.com', NULL, 18, 680.00, 180, false),
    (bid, 'Marcos Pinheiro', '61966554433', NULL, NULL, 4, 150.00, 45, false);

  -- ---------- Agendamentos: passados (completed/cancelled/no_show) e futuros (pending/confirmed) ----------
  FOR i IN 0..5 LOOP
    d := CURRENT_DATE - 1 - i;
    SELECT id INTO cid FROM public.clients WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET (i % 5);
    SELECT id INTO barber_pk FROM public.barbers WHERE barbershop_id = bid AND status = 'active' ORDER BY created_at ASC LIMIT 1 OFFSET (i % 3);
    SELECT id INTO sid FROM public.services WHERE barbershop_id = bid LIMIT 1 OFFSET (i % 4);
    INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
    SELECT bid, cid, barber_pk, sid, d, ('09:00'::time + (i * 90 || ' minutes')::interval)::time, 30, 35.00, 14.00, 'completed'
    WHERE cid IS NOT NULL AND barber_pk IS NOT NULL AND sid IS NOT NULL;
  END LOOP;
  FOR i IN 0..3 LOOP
    d := CURRENT_DATE - 2 - i;
    SELECT id INTO cid FROM public.clients WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET (i + 5);
    SELECT id INTO barber_pk FROM public.barbers WHERE barbershop_id = bid AND status = 'active' ORDER BY created_at ASC LIMIT 1 OFFSET (i % 2);
    SELECT id INTO sid FROM public.services WHERE barbershop_id = bid LIMIT 1 OFFSET 1;
    INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
    SELECT bid, cid, barber_pk, sid, d, '14:00'::time, 25, 25.00, 10.00, CASE WHEN i = 0 THEN 'cancelled' WHEN i = 1 THEN 'no_show' ELSE 'completed' END
    WHERE cid IS NOT NULL AND barber_pk IS NOT NULL AND sid IS NOT NULL;
  END LOOP;
  FOR i IN 0..12 LOOP
    d := CURRENT_DATE + 1 + (i / 2);
    SELECT id INTO cid FROM public.clients WHERE barbershop_id = bid ORDER BY created_at ASC LIMIT 1 OFFSET (i % 10);
    SELECT id INTO barber_pk FROM public.barbers WHERE barbershop_id = bid AND status = 'active' ORDER BY created_at ASC LIMIT 1 OFFSET (i % 4);
    SELECT id INTO sid FROM public.services WHERE barbershop_id = bid LIMIT 1 OFFSET (i % 5);
    INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, scheduled_date, scheduled_time, duration_minutes, price, commission_amount, status)
    SELECT bid, cid, barber_pk, sid, d, ('10:00'::time + (i * 45 || ' minutes')::interval)::time, 30, 35.00, 14.00, CASE WHEN i % 3 = 0 THEN 'pending' ELSE 'confirmed' END
    WHERE cid IS NOT NULL AND barber_pk IS NOT NULL AND sid IS NOT NULL;
  END LOOP;
  INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
  SELECT a.id, a.service_id, a.price, a.duration_minutes, s.name, 0
  FROM public.appointments a
  JOIN public.services s ON s.id = a.service_id
  WHERE a.barbershop_id = bid
  ON CONFLICT (appointment_id, position) DO NOTHING;

  -- ---------- Fidelidade ----------
  INSERT INTO public.loyalty_rewards (barbershop_id, name, description, points_required, icon, is_active)
  VALUES
    (bid, 'Corte grátis', 'Resgate com 80 pontos', 80, '✂️', true),
    (bid, 'Barba grátis', 'Resgate com 50 pontos', 50, '🧔', true),
    (bid, 'Desconto 10%', 'Próximo serviço 10% off', 30, '🎫', true);
  SELECT id INTO reward_id FROM public.loyalty_rewards WHERE barbershop_id = bid AND name = 'Corte grátis' LIMIT 1;
  SELECT id INTO cid FROM public.clients WHERE barbershop_id = bid AND loyalty_points >= 80 LIMIT 1;
  IF reward_id IS NOT NULL AND cid IS NOT NULL THEN
    INSERT INTO public.reward_redemptions (client_id, reward_id, points_spent)
    VALUES (cid, reward_id, 80);
  END IF;

  -- ---------- Fechamentos ----------
  INSERT INTO public.barbershop_closures (barbershop_id, closure_date, status, reason)
  VALUES
    (bid, CURRENT_DATE + 14, 'closed', 'Feriado municipal'),
    (bid, CURRENT_DATE + 21, 'open_partial', 'Abertura tarde'),
    (bid, CURRENT_DATE + 28, 'closed', 'Recesso');
  UPDATE public.barbershop_closures SET start_time = '12:00', end_time = '18:00' WHERE barbershop_id = bid AND status = 'open_partial';

  -- ---------- IA / WhatsApp ----------
  INSERT INTO public.barbershop_ai_settings (barbershop_id, enabled, timezone, model, temperature, max_output_tokens)
  VALUES (bid, true, 'America/Sao_Paulo', 'gpt-4o-mini', 0.7, 350)
  ON CONFLICT (barbershop_id) DO UPDATE SET enabled = true, max_output_tokens = 350;

  -- ---------- Mensagens agendadas ----------
  INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, attempts)
  VALUES
    (bid, 'reminder_24h', '45998022522', '{"appointment_id":"seed"}', 'sent', NOW() - INTERVAL '1 day', 1),
    (bid, 'reminder_2h', '11999887766', '{}', 'sent', NOW() - INTERVAL '2 hours', 1),
    (bid, 'followup_30d', '21988776655', '{}', 'queued', NOW() + INTERVAL '5 days', 0);

  -- ---------- Modelos e campanhas ----------
  INSERT INTO public.message_templates (barbershop_id, name, body)
  VALUES
    (bid, 'Lembrete', 'Olá! Lembrete: seu horário é amanhã às {{time}}. Até lá!'),
    (bid, 'Pós-atendimento', 'Obrigado pela preferência! Como foi seu atendimento?');
  INSERT INTO public.message_campaigns (barbershop_id, name, status, body, run_after)
  SELECT bid, 'Campanha Verão', 'draft', 'Aproveite o verão com corte em dia!', NOW() + INTERVAL '7 days'
  WHERE NOT EXISTS (SELECT 1 FROM public.message_campaigns WHERE barbershop_id = bid LIMIT 1);

  -- ---------- Créditos ----------
  INSERT INTO public.barbershop_message_credits (barbershop_id, credit_type, balance)
  VALUES (bid, 'followup_manual', 100)
  ON CONFLICT (barbershop_id, credit_type) DO UPDATE SET balance = 100, updated_at = now();

  RAISE NOTICE 'Seed completo aplicado para barbershop %', bid;
END $$;
