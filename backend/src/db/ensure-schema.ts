import { pool } from "../db.js";

function isUndefinedTableOrColumn(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "42P01" || code === "42703";
}

/**
 * Ensures critical tables/columns exist in local/docker DBs.
 * This repo uses SQL migrations (supabase/), but docker volumes may start without them applied.
 * Keep this idempotent and conservative.
 */
export async function ensureCriticalSchema(): Promise<void> {
  // Conversation runtime: pause handoff + optional account-wide selected barbershop.
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS public.ai_conversation_runtime (
        conversation_id uuid PRIMARY KEY REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
        paused_until timestamptz,
        paused_by text CHECK (paused_by IS NULL OR paused_by IN ('auto', 'manual', 'rule')),
        paused_reason text,
        selected_barbershop_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`
    )
    .catch(() => {});

  // Make sure columns exist even if table was created by older schema.
  await pool
    .query(`ALTER TABLE public.ai_conversation_runtime ADD COLUMN IF NOT EXISTS paused_until timestamptz`)
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE public.ai_conversation_runtime
       ADD COLUMN IF NOT EXISTS paused_by text`
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE public.ai_conversation_runtime
       ADD COLUMN IF NOT EXISTS paused_reason text`
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE public.ai_conversation_runtime
       ADD COLUMN IF NOT EXISTS selected_barbershop_id uuid`
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE public.ai_conversation_runtime
       ADD COLUMN IF NOT EXISTS booking_draft jsonb`
    )
    .catch(() => {});

  await pool
    .query(
      `CREATE INDEX IF NOT EXISTS ai_conversation_runtime_paused_until_idx
       ON public.ai_conversation_runtime (paused_until) WHERE paused_until IS NOT NULL`
    )
    .catch(() => {});

  // Handoff settings + audit.
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS public.barbershop_ai_handoff_settings (
        barbershop_id uuid PRIMARY KEY REFERENCES public.barbershops(id) ON DELETE CASCADE,
        enabled boolean NOT NULL DEFAULT true,
        pause_hours int NOT NULL DEFAULT 4,
        on_user_request_enabled boolean NOT NULL DEFAULT true,
        user_request_keywords text[] NOT NULL DEFAULT ARRAY['falar com humano', 'atendente', 'pessoa', 'assistência humana']::text[],
        on_agent_failure_enabled boolean NOT NULL DEFAULT false,
        handoff_message text,
        resume_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`
    )
    .catch(() => {});

  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS public.ai_handoff_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
        conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
        event_type text NOT NULL CHECK (event_type IN ('paused', 'resumed', 'pending_review')),
        triggered_by text NOT NULL CHECK (triggered_by IN ('auto', 'manual', 'rule', 'keyword', 'agent_failure', 'delivery_failure', 'job_failure')),
        reason text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`
    )
    .catch(() => {});

  // Widen check constraints to include worker-generated event types added after initial schema.
  await pool.query(`ALTER TABLE public.ai_handoff_events DROP CONSTRAINT IF EXISTS ai_handoff_events_event_type_check`).catch(() => {});
  await pool.query(
    `ALTER TABLE public.ai_handoff_events ADD CONSTRAINT ai_handoff_events_event_type_check
     CHECK (event_type IN ('paused', 'resumed', 'pending_review'))`
  ).catch(() => {});
  await pool.query(`ALTER TABLE public.ai_handoff_events DROP CONSTRAINT IF EXISTS ai_handoff_events_triggered_by_check`).catch(() => {});
  await pool.query(
    `ALTER TABLE public.ai_handoff_events ADD CONSTRAINT ai_handoff_events_triggered_by_check
     CHECK (triggered_by IN ('auto', 'manual', 'rule', 'keyword', 'agent_failure', 'delivery_failure', 'job_failure'))`
  ).catch(() => {});

  // Track conversations that need human follow-up (populated by the AI worker on job failure/delivery failure).
  await pool.query(
    `ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS needs_human_followup boolean NOT NULL DEFAULT false`
  ).catch((e) => {
    if (!isUndefinedTableOrColumn(e)) throw e;
  });

  // Message delivery (UI check / double-check).
  await pool
    .query(`ALTER TABLE public.ai_messages ADD COLUMN IF NOT EXISTS delivery_status text`)
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });
  await pool
    .query(`ALTER TABLE public.ai_messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz`)
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  // Prevent duplicate messages per conversation when syncing from provider (e.g. provider_message_id).
  await pool
    .query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_messages_conversation_provider_message_id_key
       ON public.ai_messages (conversation_id, provider_message_id) WHERE provider_message_id IS NOT NULL`
    )
    .catch(() => {});

  // Booking buffer (minutes between appointments) per barbershop; 0–30.
  await pool
    .query(
      `ALTER TABLE public.barbershop_ai_settings
       ADD COLUMN IF NOT EXISTS booking_buffer_minutes int NOT NULL DEFAULT 0`
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });
  await pool
    .query(
      `ALTER TABLE public.barbershop_ai_settings
       DROP CONSTRAINT IF EXISTS barbershop_ai_settings_booking_buffer_minutes_check`
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE public.barbershop_ai_settings
       ADD CONSTRAINT barbershop_ai_settings_booking_buffer_minutes_check
       CHECK (booking_buffer_minutes >= 0 AND booking_buffer_minutes <= 30)`
    )
    .catch(() => {});

  // Barbershop geo (WhatsApp location pin)
  await pool
    .query(
      `ALTER TABLE public.barbershops
       ADD COLUMN IF NOT EXISTS latitude double precision,
       ADD COLUMN IF NOT EXISTS longitude double precision,
       ADD COLUMN IF NOT EXISTS pix_key text,
       ADD COLUMN IF NOT EXISTS pix_holder_name text,
       ADD COLUMN IF NOT EXISTS pix_key_type text`,
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  await pool
    .query(
      `ALTER TABLE public.barbershop_ai_settings
       ADD COLUMN IF NOT EXISTS n8n_chat_webhook_url text`
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  await pool
    .query(
      `ALTER TABLE public.barbershop_whatsapp_connections
       ADD COLUMN IF NOT EXISTS evolution_instance_name text`
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS public.agenda_activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
        appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
        conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
        type text NOT NULL,
        actor text NOT NULL,
        client_name text,
        client_phone text,
        scheduled_date date,
        scheduled_time time,
        summary text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`
    )
    .catch(() => {});

  await pool
    .query(
      `CREATE INDEX IF NOT EXISTS agenda_activity_barbershop_created_idx
       ON public.agenda_activity (barbershop_id, created_at DESC)`
    )
    .catch(() => {});

  await pool
    .query(`ALTER TABLE public.appointment_waitlist ADD COLUMN IF NOT EXISTS desired_time time`)
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  await pool
    .query(
      `CREATE INDEX IF NOT EXISTS appointment_waitlist_clock_idx
       ON public.appointment_waitlist (barbershop_id, desired_date, desired_time, status)`,
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  await pool
    .query(`ALTER TABLE public.agenda_activity DROP CONSTRAINT IF EXISTS agenda_activity_type_check`)
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });

  await pool
    .query(
      `ALTER TABLE public.agenda_activity ADD CONSTRAINT agenda_activity_type_check
       CHECK (type IN (
         'appointment_created',
         'rescheduled',
         'cancelled',
         'confirmed',
         'reminder_sent',
         'waitlist_offered',
         'no_show',
         'payment_recognized',
         'conversation_started'
       ))`,
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e) && (e as { code?: string }).code !== "42710") throw e;
    });

  await pool
    .query(
      `ALTER TABLE public.clients
       ADD COLUMN IF NOT EXISTS photo_url text,
       ADD COLUMN IF NOT EXISTS whatsapp_contact_name text,
       ADD COLUMN IF NOT EXISTS name_confirmed boolean NOT NULL DEFAULT true`,
    )
    .catch((e) => {
      if (!isUndefinedTableOrColumn(e)) throw e;
    });
}

