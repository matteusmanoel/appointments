-- Fidelidade: pontos por serviço e resgates por serviço

-- 1) Serviços: pontos ao ganhar e pontos para resgatar
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS points_to_earn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_to_redeem INTEGER;

COMMENT ON COLUMN public.services.points_to_earn IS 'Pontos que o cliente ganha ao realizar o serviço';
COMMENT ON COLUMN public.services.points_to_redeem IS 'Pontos necessários para resgatar o serviço; NULL = não participa';

-- 2) Resgates por serviço (cliente trocou pontos por um serviço)
CREATE TABLE IF NOT EXISTS public.service_redemptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  points_spent INTEGER NOT NULL,
  redeemed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_redemptions_client ON public.service_redemptions(client_id);
CREATE INDEX IF NOT EXISTS idx_service_redemptions_service ON public.service_redemptions(service_id);
CREATE INDEX IF NOT EXISTS idx_service_redemptions_redeemed_at ON public.service_redemptions(redeemed_at);

-- RLS: usuário só vê resgates de clientes da seu estabelecimento
ALTER TABLE public.service_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see redemptions from their barbershop clients"
  ON public.service_redemptions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id AND c.barbershop_id = public.get_user_barbershop_id()
  ));

CREATE POLICY "Users insert redemptions for their barbershop clients"
  ON public.service_redemptions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id AND c.barbershop_id = public.get_user_barbershop_id()
  ));

-- 3) Trigger: ao concluir atendimento, somar points_to_earn dos serviços do agendamento
CREATE OR REPLACE FUNCTION public.update_client_stats_on_appointment()
RETURNS TRIGGER AS $$
DECLARE
  points_to_add INTEGER;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    SELECT COALESCE(SUM(s.points_to_earn), 0)::INTEGER
      INTO points_to_add
      FROM public.appointment_services aps
      JOIN public.services s ON s.id = aps.service_id
      WHERE aps.appointment_id = NEW.id;

    UPDATE public.clients
    SET
      total_visits = total_visits + 1,
      total_spent = total_spent + NEW.price,
      loyalty_points = loyalty_points + COALESCE(points_to_add, 0)
    WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
