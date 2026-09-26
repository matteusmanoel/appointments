-- Evolution instance name + owner activity feed (additive)

ALTER TABLE public.barbershop_whatsapp_connections
  ADD COLUMN IF NOT EXISTS evolution_instance_name text;

CREATE UNIQUE INDEX IF NOT EXISTS barbershop_whatsapp_connections_evolution_instance_name_idx
  ON public.barbershop_whatsapp_connections (evolution_instance_name)
  WHERE evolution_instance_name IS NOT NULL AND evolution_instance_name <> '';

CREATE TABLE IF NOT EXISTS public.agenda_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (
    type IN ('appointment_created', 'rescheduled', 'cancelled', 'confirmed', 'reminder_sent', 'no_show')
  ),
  actor text NOT NULL CHECK (actor IN ('ai', 'owner', 'client_link', 'system')),
  client_name text,
  client_phone text,
  scheduled_date date,
  scheduled_time time,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agenda_activity_barbershop_created_idx
  ON public.agenda_activity (barbershop_id, created_at DESC);
