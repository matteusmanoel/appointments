-- ============================================================
-- Client AI Memory
-- ============================================================
-- Stores structured, confidence-tagged preferences and context
-- per client, enabling the agent to personalize interactions
-- without relying solely on conversation history.
--
-- Design principles:
-- 1. Confidence: every field has a companion confidence field (0.0–1.0)
--    - 1.0 = explicitly confirmed by client
--    - 0.7 = strongly inferred from multiple appointments
--    - 0.5 = weakly inferred from one data point
--    - 0.0 = unknown / expired
-- 2. Expiration: confidence decays if no visit in 180 days.
--    The agent should check `confidence < 0.5` and treat as unknown.
-- 3. Write discipline: only write confirmed or high-confidence data.
--    Do not store guesses as facts.
-- 4. Privacy: no sensitive data beyond what is operationally needed.
--    `notes_safe` is for agent-usable observations (e.g. "prefers morning").

CREATE TABLE IF NOT EXISTS public.client_ai_memory (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  barbershop_id               uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,

  -- Service preferences
  -- Array of service IDs or names the client has requested most often
  preferred_services          jsonb DEFAULT '[]'::jsonb,
  preferred_services_conf     numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (preferred_services_conf BETWEEN 0 AND 1),

  -- Barber preference (NULL = no preference or unknown)
  preferred_barber_id         uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
  preferred_barber_conf       numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (preferred_barber_conf BETWEEN 0 AND 1),

  -- Day-of-week preferences (0=Sunday … 6=Saturday)
  preferred_days              integer[] DEFAULT '{}',
  preferred_days_conf         numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (preferred_days_conf BETWEEN 0 AND 1),

  -- Time-of-day preference range (local time strings: "09:00", "12:00")
  preferred_time_start        time without time zone,
  preferred_time_end          time without time zone,
  preferred_time_conf         numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (preferred_time_conf BETWEEN 0 AND 1),

  -- Last completed appointment context (for "o de sempre" feature)
  last_completed_services     jsonb DEFAULT NULL,
  last_completed_at           timestamptz DEFAULT NULL,

  -- Communication style inferred from conversation
  -- Values: 'formal', 'informal', 'direct', 'chatty', 'unknown'
  communication_style         text NOT NULL DEFAULT 'unknown'
    CHECK (communication_style IN ('formal', 'informal', 'direct', 'chatty', 'unknown')),
  communication_style_conf    numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (communication_style_conf BETWEEN 0 AND 1),

  -- Reactivation state — for clients who haven't visited in a while
  -- Values: 'active', 'at_risk', 'churned', 'returning', 'unknown'
  reactivation_status         text NOT NULL DEFAULT 'unknown'
    CHECK (reactivation_status IN ('active', 'at_risk', 'churned', 'returning', 'unknown')),

  -- Financial context
  payment_pending             boolean NOT NULL DEFAULT false,
  payment_pending_amount      numeric(10,2),

  -- No-show tracking
  last_no_show_at             timestamptz DEFAULT NULL,
  no_show_count               integer NOT NULL DEFAULT 0,

  -- Agent-usable notes (safe to include in context prompt)
  -- Keep short (<200 chars), no sensitive data
  notes_safe                  text DEFAULT NULL CHECK (char_length(notes_safe) <= 200),

  -- Overall confidence in this memory record (composite)
  -- Should be recomputed when any field updates
  overall_confidence          numeric(3,2) NOT NULL DEFAULT 0.0 CHECK (overall_confidence BETWEEN 0 AND 1),

  -- Timestamps
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- One record per (client, barbershop)
  CONSTRAINT client_ai_memory_unique UNIQUE (client_id, barbershop_id)
);

-- Index for fast lookup by barbershop (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_client_ai_memory_barbershop
  ON public.client_ai_memory (barbershop_id);

-- Index for lookup by client
CREATE INDEX IF NOT EXISTS idx_client_ai_memory_client
  ON public.client_ai_memory (client_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'client_ai_memory_updated_at'
  ) THEN
    CREATE TRIGGER client_ai_memory_updated_at
      BEFORE UPDATE ON public.client_ai_memory
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$$;

-- ============================================================
-- Confidence decay function
-- ============================================================
-- Call this periodically (e.g. daily) to decay confidence for
-- clients who haven't visited in 180+ days.

CREATE OR REPLACE FUNCTION public.decay_client_ai_memory_confidence()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.client_ai_memory m
  SET
    preferred_services_conf  = GREATEST(0, preferred_services_conf * 0.5),
    preferred_barber_conf    = GREATEST(0, preferred_barber_conf * 0.5),
    preferred_days_conf      = GREATEST(0, preferred_days_conf * 0.5),
    preferred_time_conf      = GREATEST(0, preferred_time_conf * 0.5),
    communication_style_conf = GREATEST(0, communication_style_conf * 0.5),
    overall_confidence       = GREATEST(0, overall_confidence * 0.5),
    updated_at               = now()
  WHERE
    m.last_completed_at < now() - interval '180 days'
    AND m.overall_confidence > 0.1;
END;
$$;

-- ============================================================
-- Helper view: clients with high-confidence memory
-- ============================================================

CREATE OR REPLACE VIEW public.v_client_ai_memory_confident AS
SELECT
  m.*,
  c.name     AS client_name,
  c.phone    AS client_phone,
  b.name     AS barber_name
FROM public.client_ai_memory m
JOIN public.clients c ON c.id = m.client_id
LEFT JOIN public.barbers b ON b.id = m.preferred_barber_id
WHERE m.overall_confidence >= 0.5;

COMMENT ON TABLE public.client_ai_memory IS
  'Structured per-client AI memory. Confidence values indicate reliability. '
  'Decay function should be called daily. Agent should only use memory with confidence >= 0.5.';

COMMENT ON COLUMN public.client_ai_memory.notes_safe IS
  'Agent-readable notes (no sensitive data). Max 200 chars. Example: "prefers mornings", "brings kids".';

COMMENT ON COLUMN public.client_ai_memory.overall_confidence IS
  'Composite confidence 0.0-1.0. Below 0.5 = treat as unknown. Decays after 180 days of inactivity.';
