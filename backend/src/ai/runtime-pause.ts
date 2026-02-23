import { pool } from "../db.js";

const PAUSE_HOURS_AUTO = 4;

function isUndefinedTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "42P01";
}

/**
 * Set IA paused for handoff (manual or auto). pausedBy: 'manual' | 'auto'.
 */
export async function setAiPaused(
  barbershopId: string,
  opts: { pausedBy: "manual" | "auto"; reason?: string; hours?: number }
): Promise<void> {
  const hours = opts.hours ?? (opts.pausedBy === "auto" ? PAUSE_HOURS_AUTO : 4);
  const until = new Date(Date.now() + hours * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO public.barbershop_ai_runtime (barbershop_id, paused_until, paused_reason, paused_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (barbershop_id) DO UPDATE SET paused_until = $2, paused_reason = $3, paused_by = $4, updated_at = now()`,
    [barbershopId, until, opts.reason ?? null, opts.pausedBy]
  );
}

/**
 * Clear IA pause (resume).
 */
export async function clearAiPause(barbershopId: string): Promise<void> {
  await pool.query(
    `UPDATE public.barbershop_ai_runtime SET paused_until = NULL, paused_reason = NULL, paused_by = NULL, updated_at = now() WHERE barbershop_id = $1`,
    [barbershopId]
  );
}

/**
 * Returns true if IA is currently paused for this barbershop (paused_until > now()).
 */
export async function isAiPaused(barbershopId: string): Promise<boolean> {
  try {
    const r = await pool.query<{ paused_until: Date | null }>(
      `SELECT paused_until FROM public.barbershop_ai_runtime WHERE barbershop_id = $1`,
      [barbershopId]
    );
    const until = r.rows[0]?.paused_until;
    return until != null && until.getTime() > Date.now();
  } catch (e) {
    if (isUndefinedTable(e)) return false;
    throw e;
  }
}

/**
 * Get current pause state for display (paused_until, paused_by). Returns null if not paused or expired.
 */
export async function getAiPauseState(barbershopId: string): Promise<{
  paused_until: Date;
  paused_by: string | null;
  paused_reason: string | null;
} | null> {
  try {
    const r = await pool.query<{ paused_until: Date; paused_by: string | null; paused_reason: string | null }>(
      `SELECT paused_until, paused_by, paused_reason FROM public.barbershop_ai_runtime WHERE barbershop_id = $1 AND paused_until > now()`,
      [barbershopId]
    );
    return r.rows[0] ?? null;
  } catch (e) {
    if (isUndefinedTable(e)) return null;
    throw e;
  }
}
