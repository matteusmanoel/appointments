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
        event_type text NOT NULL CHECK (event_type IN ('paused', 'resumed')),
        triggered_by text NOT NULL CHECK (triggered_by IN ('auto', 'manual', 'rule', 'keyword', 'agent_failure')),
        reason text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`
    )
    .catch(() => {});

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
}

