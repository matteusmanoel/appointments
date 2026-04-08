-- AI incidents: persistent cases reported by the dev team from real conversations.
-- Used to feed the benchmark / refinement cycle.
CREATE TABLE IF NOT EXISTS public.ai_incidents (
  id                         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id              UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  conversation_id            UUID REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  incident_type              TEXT NOT NULL,
  severity                   TEXT NOT NULL DEFAULT 'medium'
                               CHECK (severity IN ('critical', 'medium', 'light')),
  manager_note               TEXT,
  transcript_json            JSONB NOT NULL DEFAULT '[]',
  settings_snapshot_json     JSONB,
  diagnosis_result_json      JSONB,
  benchmark_scenario_draft_json JSONB,
  status                     TEXT NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open', 'triaged', 'promoted', 'archived')),
  created_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_incidents_barbershop
  ON public.ai_incidents (barbershop_id);

CREATE INDEX IF NOT EXISTS idx_ai_incidents_status
  ON public.ai_incidents (status);

CREATE INDEX IF NOT EXISTS idx_ai_incidents_created_at
  ON public.ai_incidents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_incidents_type
  ON public.ai_incidents (incident_type);
