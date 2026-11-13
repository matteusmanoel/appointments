-- Operational failure/observability events in the agenda activity feed
ALTER TABLE public.agenda_activity DROP CONSTRAINT IF EXISTS agenda_activity_type_check;
ALTER TABLE public.agenda_activity ADD CONSTRAINT agenda_activity_type_check
  CHECK (type IN (
    'appointment_created',
    'rescheduled',
    'cancelled',
    'confirmed',
    'reminder_sent',
    'waitlist_offered',
    'no_show',
    'payment_recognized',
    'conversation_started',
    'send_failure',
    'agent_silenced',
    'agent_stuck',
    'tool_error_escalated',
    'payment_sent',
    'payment_failed'
  ));
