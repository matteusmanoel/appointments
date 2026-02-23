-- ========================================
-- NavalhIA Database Schema
-- ========================================

-- Barbershop table (multi-tenant support)
CREATE TABLE public.barbershops (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Profiles table for authenticated users (managers/admins)
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager', 'attendant')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Barbers table
CREATE TABLE public.barbers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'break')),
  commission_percentage INTEGER DEFAULT 40,
  schedule JSONB DEFAULT '{"monday": {"start": "09:00", "end": "19:00"}, "tuesday": {"start": "09:00", "end": "19:00"}, "wednesday": {"start": "09:00", "end": "19:00"}, "thursday": {"start": "09:00", "end": "19:00"}, "friday": {"start": "09:00", "end": "19:00"}, "saturday": {"start": "09:00", "end": "18:00"}, "sunday": null}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Services table
CREATE TABLE public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  commission_percentage INTEGER DEFAULT 40,
  category TEXT NOT NULL DEFAULT 'corte' CHECK (category IN ('corte', 'barba', 'combo', 'tratamento', 'adicional')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Barber services (many-to-many)
CREATE TABLE public.barber_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  custom_commission_percentage INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(barber_id, service_id)
);

-- Clients table (no login required, phone-based)
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  total_visits INTEGER NOT NULL DEFAULT 0,
  total_spent DECIMAL(10, 2) NOT NULL DEFAULT 0,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(barbershop_id, phone)
);

-- Appointments table
CREATE TABLE public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  commission_amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Loyalty rewards configuration
CREATE TABLE public.loyalty_rewards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  points_required INTEGER NOT NULL,
  icon TEXT DEFAULT '🎁',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Reward redemptions
CREATE TABLE public.reward_redemptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reward_id UUID NOT NULL REFERENCES public.loyalty_rewards(id) ON DELETE CASCADE,
  points_spent INTEGER NOT NULL,
  redeemed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_barbers_barbershop ON public.barbers(barbershop_id);
CREATE INDEX idx_services_barbershop ON public.services(barbershop_id);
CREATE INDEX idx_clients_barbershop ON public.clients(barbershop_id);
CREATE INDEX idx_clients_phone ON public.clients(phone);
CREATE INDEX idx_appointments_barbershop ON public.appointments(barbershop_id);
CREATE INDEX idx_appointments_date ON public.appointments(scheduled_date);
CREATE INDEX idx_appointments_barber ON public.appointments(barber_id);
CREATE INDEX idx_appointments_client ON public.appointments(client_id);
CREATE INDEX idx_appointments_status ON public.appointments(status);

-- Enable Row Level Security
ALTER TABLE public.barbershops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;

-- Function to get current user's barbershop_id
CREATE OR REPLACE FUNCTION public.get_user_barbershop_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT barbershop_id FROM public.profiles WHERE user_id = auth.uid()
$$;

-- RLS Policies for barbershops
CREATE POLICY "Users can view their barbershop"
  ON public.barbershops FOR SELECT
  USING (id = public.get_user_barbershop_id());

CREATE POLICY "Users can update their barbershop"
  ON public.barbershops FOR UPDATE
  USING (id = public.get_user_barbershop_id());

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for barbers
CREATE POLICY "Users can view barbers from their barbershop"
  ON public.barbers FOR SELECT
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can insert barbers to their barbershop"
  ON public.barbers FOR INSERT
  WITH CHECK (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can update barbers from their barbershop"
  ON public.barbers FOR UPDATE
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can delete barbers from their barbershop"
  ON public.barbers FOR DELETE
  USING (barbershop_id = public.get_user_barbershop_id());

-- RLS Policies for services
CREATE POLICY "Users can view services from their barbershop"
  ON public.services FOR SELECT
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can insert services to their barbershop"
  ON public.services FOR INSERT
  WITH CHECK (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can update services from their barbershop"
  ON public.services FOR UPDATE
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can delete services from their barbershop"
  ON public.services FOR DELETE
  USING (barbershop_id = public.get_user_barbershop_id());

-- RLS Policies for barber_services
CREATE POLICY "Users can view barber_services from their barbershop"
  ON public.barber_services FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.barbers b 
    WHERE b.id = barber_id AND b.barbershop_id = public.get_user_barbershop_id()
  ));

CREATE POLICY "Users can manage barber_services from their barbershop"
  ON public.barber_services FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.barbers b 
    WHERE b.id = barber_id AND b.barbershop_id = public.get_user_barbershop_id()
  ));

-- RLS Policies for clients
CREATE POLICY "Users can view clients from their barbershop"
  ON public.clients FOR SELECT
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can insert clients to their barbershop"
  ON public.clients FOR INSERT
  WITH CHECK (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can update clients from their barbershop"
  ON public.clients FOR UPDATE
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can delete clients from their barbershop"
  ON public.clients FOR DELETE
  USING (barbershop_id = public.get_user_barbershop_id());

-- RLS Policies for appointments
CREATE POLICY "Users can view appointments from their barbershop"
  ON public.appointments FOR SELECT
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can insert appointments to their barbershop"
  ON public.appointments FOR INSERT
  WITH CHECK (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can update appointments from their barbershop"
  ON public.appointments FOR UPDATE
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can delete appointments from their barbershop"
  ON public.appointments FOR DELETE
  USING (barbershop_id = public.get_user_barbershop_id());

-- RLS Policies for loyalty_rewards
CREATE POLICY "Users can view rewards from their barbershop"
  ON public.loyalty_rewards FOR SELECT
  USING (barbershop_id = public.get_user_barbershop_id());

CREATE POLICY "Users can manage rewards from their barbershop"
  ON public.loyalty_rewards FOR ALL
  USING (barbershop_id = public.get_user_barbershop_id());

-- RLS Policies for reward_redemptions
CREATE POLICY "Users can view redemptions from their barbershop clients"
  ON public.reward_redemptions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.clients c 
    WHERE c.id = client_id AND c.barbershop_id = public.get_user_barbershop_id()
  ));

CREATE POLICY "Users can manage redemptions from their barbershop clients"
  ON public.reward_redemptions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.clients c 
    WHERE c.id = client_id AND c.barbershop_id = public.get_user_barbershop_id()
  ));

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for updated_at
CREATE TRIGGER update_barbershops_updated_at BEFORE UPDATE ON public.barbershops FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_barbers_updated_at BEFORE UPDATE ON public.barbers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_loyalty_rewards_updated_at BEFORE UPDATE ON public.loyalty_rewards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to update client stats after appointment completion
CREATE OR REPLACE FUNCTION public.update_client_stats_on_appointment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE public.clients
    SET 
      total_visits = total_visits + 1,
      total_spent = total_spent + NEW.price,
      loyalty_points = loyalty_points + FLOOR(NEW.price)::INTEGER
    WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_client_stats_trigger
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_client_stats_on_appointment();