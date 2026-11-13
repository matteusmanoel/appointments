-- Reativação entra na fila de scheduled_messages. O operador escolhe quem sai; nada nasce sozinho.

ALTER TABLE public.scheduled_messages
  DROP CONSTRAINT IF EXISTS scheduled_messages_type_check;

ALTER TABLE public.scheduled_messages
  ADD CONSTRAINT scheduled_messages_type_check
  CHECK (
    type IN (
      'reminder_24h',
      'reminder_2h',
      'followup_30d',
      'manual',
      'campaign',
      'payment_reminder',
      'birthday',
      'opening_summary',
      'plan_billing',
      'reactivation'
    )
  );
