-- Indexes for scheduled_messages to speed up list and metrics queries
-- (barbershop_id, created_at) for list ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_barbershop_created
  ON public.scheduled_messages (barbershop_id, created_at DESC);

-- (barbershop_id, type, created_at) for filtered list and monthly metrics
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_barbershop_type_created
  ON public.scheduled_messages (barbershop_id, type, created_at DESC);

-- (barbershop_id, type, status) for GROUP BY status in summary/mvp-metrics
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_barbershop_type_status
  ON public.scheduled_messages (barbershop_id, type, status);
