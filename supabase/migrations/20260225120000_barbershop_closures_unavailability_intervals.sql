-- Optional unavailability intervals within a closure day (e.g. lunch break on open_partial days)
ALTER TABLE public.barbershop_closures
  ADD COLUMN IF NOT EXISTS unavailability_intervals jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN public.barbershop_closures.unavailability_intervals IS 'Array of { start: "HH:mm", end: "HH:mm", reason?: string } blocking slots within the day';
