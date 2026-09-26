-- Waitlist is a clock (date+time+service). Agenda activity can record PIX received.

ALTER TABLE public.appointment_waitlist
  ADD COLUMN IF NOT EXISTS desired_time time;

CREATE INDEX IF NOT EXISTS appointment_waitlist_clock_idx
  ON public.appointment_waitlist (barbershop_id, desired_date, desired_time, status);

ALTER TABLE public.agenda_activity DROP CONSTRAINT IF EXISTS agenda_activity_type_check;
ALTER TABLE public.agenda_activity ADD CONSTRAINT agenda_activity_type_check
  CHECK (type IN (
    'appointment_created',
    'rescheduled',
    'cancelled',
    'confirmed',
    'reminder_sent',
    'no_show',
    'payment_recognized'
  ));
