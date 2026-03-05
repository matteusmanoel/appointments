-- Manual messages and campaigns: extend scheduled_messages, add templates and campaigns.

-- 1) Extend scheduled_messages type and optional campaign/template refs
ALTER TABLE public.scheduled_messages
  DROP CONSTRAINT IF EXISTS scheduled_messages_type_check;

ALTER TABLE public.scheduled_messages
  ADD CONSTRAINT scheduled_messages_type_check
  CHECK (type IN ('reminder_24h', 'reminder_2h', 'followup_30d', 'manual', 'campaign'));

ALTER TABLE public.scheduled_messages
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS template_id uuid;

COMMENT ON COLUMN public.scheduled_messages.campaign_id IS 'When type = campaign, reference to message_campaigns';
COMMENT ON COLUMN public.scheduled_messages.template_id IS 'Optional template used for body';

-- 2) Message templates (reusable body text)
CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_templates_barbershop_idx
  ON public.message_templates (barbershop_id);

COMMENT ON TABLE public.message_templates IS 'Reusable message bodies for manual/campaign sends';

-- 3) Campaigns (audience + schedule; materialized into scheduled_messages)
CREATE TABLE IF NOT EXISTS public.message_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'done', 'cancelled')),
  audience_query jsonb,
  body text,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  run_after timestamptz,
  send_window_start int,
  send_window_end int,
  rate_limit_per_min int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_campaigns_barbershop_status_idx
  ON public.message_campaigns (barbershop_id, status);

COMMENT ON TABLE public.message_campaigns IS 'Campaign definition; recipients materialized into scheduled_messages with type=campaign';

-- FK from scheduled_messages to campaigns (add after table exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scheduled_messages_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_messages
      ADD CONSTRAINT scheduled_messages_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.message_campaigns(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scheduled_messages_template_id_fkey'
  ) THEN
    ALTER TABLE public.scheduled_messages
      ADD CONSTRAINT scheduled_messages_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.message_templates(id) ON DELETE SET NULL;
  END IF;
END $$;
