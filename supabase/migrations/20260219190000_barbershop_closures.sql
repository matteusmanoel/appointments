-- Exceções de funcionamento: feriados, fechamentos inesperados, abertura/fechamento parcial
CREATE TABLE IF NOT EXISTS public.barbershop_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  closure_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('closed', 'open_partial')),
  start_time time without time zone,
  end_time time without time zone,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(barbershop_id, closure_date)
);

CREATE INDEX IF NOT EXISTS idx_barbershop_closures_barbershop_date
  ON public.barbershop_closures(barbershop_id, closure_date);

COMMENT ON TABLE public.barbershop_closures IS 'Feriados, fechamentos e exceções de horário por data';
COMMENT ON COLUMN public.barbershop_closures.status IS 'closed = dia todo fechado; open_partial = abre/fecha em start_time/end_time';
