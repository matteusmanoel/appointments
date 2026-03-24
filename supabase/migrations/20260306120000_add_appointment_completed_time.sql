-- Add completed_time (real end time on appointment day) and completed_at (audit) for occupancy/availability.
-- When status = 'completed', occupancy ends at completed_time if set, else at scheduled_time + duration_minutes.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS completed_time TIME NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.appointments.completed_time IS 'Actual end time on scheduled_date (HH:mm). Used for availability: occupied until this time when status=completed.';
COMMENT ON COLUMN public.appointments.completed_at IS 'When the appointment was marked completed (audit).';
