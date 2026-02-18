-- Multi-service per appointment: junction table with snapshot at booking time
CREATE TABLE public.appointment_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  price NUMERIC(10, 2) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  service_name TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(appointment_id, position)
);

CREATE INDEX idx_appointment_services_appointment ON public.appointment_services(appointment_id);
CREATE INDEX idx_appointment_services_service ON public.appointment_services(service_id);

-- Backfill: one row per existing appointment using current appointment price/duration and service name
INSERT INTO public.appointment_services (appointment_id, service_id, price, duration_minutes, service_name, position)
SELECT a.id, a.service_id, a.price, a.duration_minutes, s.name, 0
FROM public.appointments a
JOIN public.services s ON s.id = a.service_id
ON CONFLICT (appointment_id, position) DO NOTHING;
