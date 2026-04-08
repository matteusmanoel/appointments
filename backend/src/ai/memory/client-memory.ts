/**
 * Client AI Memory layer.
 *
 * This module owns all read and write access to the `client_ai_memory` table.
 * It is the ONLY place that issues SQL against that table — no other file
 * should query it directly.
 *
 * Design decisions:
 * - All DB operations are wrapped in try/catch with graceful fallback.
 *   The table may not exist in all environments.
 * - Memory is read once per runAgent call and passed around as a plain object.
 * - Updates are fire-and-forget (non-blocking) when called from inside runAgent.
 * - Confidence threshold for prompt injection is configurable.
 * - The conversation always takes priority over stored memory.
 *   The prompt block includes explicit instructions for the model to follow.
 */

import { pool } from "../../db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientMemoryRow {
  id: string;
  client_id: string;
  barbershop_id: string;

  preferred_services: string[];       // array of service names
  preferred_services_conf: number;    // 0.0–1.0

  preferred_barber_id: string | null;
  preferred_barber_name: string | null; // joined from barbers table
  preferred_barber_conf: number;

  preferred_days: number[];           // 0=Sun … 6=Sat
  preferred_days_conf: number;

  preferred_time_start: string | null; // "HH:MM" local time
  preferred_time_end: string | null;
  preferred_time_conf: number;

  last_completed_services: string[] | null; // service names from last appointment
  last_completed_at: Date | null;

  communication_style: "formal" | "informal" | "direct" | "chatty" | "unknown";
  communication_style_conf: number;

  reactivation_status: "active" | "at_risk" | "churned" | "returning" | "unknown";

  payment_pending: boolean;
  payment_pending_amount: number | null;

  last_no_show_at: Date | null;
  no_show_count: number;

  notes_safe: string | null;
  overall_confidence: number;
  updated_at: Date;
}

export interface MemoryPatch {
  preferred_services?: string[];
  preferred_services_conf?: number;
  preferred_barber_id?: string | null;
  preferred_barber_conf?: number;
  preferred_days?: number[];
  preferred_days_conf?: number;
  preferred_time_start?: string;
  preferred_time_end?: string;
  preferred_time_conf?: number;
  last_completed_services?: string[];
  last_completed_at?: Date;
  communication_style?: ClientMemoryRow["communication_style"];
  communication_style_conf?: number;
  reactivation_status?: ClientMemoryRow["reactivation_status"];
  payment_pending?: boolean;
  payment_pending_amount?: number | null;
  last_no_show_at?: Date;
  no_show_count?: number;
  notes_safe?: string;
}

export type AppointmentEventType =
  | "appointment_created"
  | "appointment_completed"
  | "appointment_cancelled"
  | "appointment_no_show"
  | "appointment_rescheduled";

export interface AppointmentEventData {
  eventType: AppointmentEventType;
  barbershopId: string;
  /** Provide either clientPhone OR clientId (clientId preferred when available to skip a lookup) */
  clientPhone?: string;
  clientId?: string;
  serviceIds?: string[];
  serviceNames?: string[];
  barberId?: string;
  date?: string;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Load client memory for a given phone number.
 * Returns null if the table doesn't exist or if no record is found.
 */
export async function getClientMemory(
  barbershopId: string,
  clientPhone: string
): Promise<ClientMemoryRow | null> {
  if (!clientPhone || !barbershopId) return null;
  try {
    const digits = clientPhone.replace(/\D/g, "");
    const r = await pool.query<ClientMemoryRow & { preferred_barber_name: string | null }>(
      `SELECT m.*,
              b.name AS preferred_barber_name
       FROM public.client_ai_memory m
       JOIN public.clients c ON c.id = m.client_id
       LEFT JOIN public.barbers b ON b.id = m.preferred_barber_id
       WHERE m.barbershop_id = $1
         AND regexp_replace(c.phone, '[^0-9]', '', 'g') = ANY(ARRAY[$2, $3]::text[])
       ORDER BY m.updated_at DESC
       LIMIT 1`,
      [barbershopId, digits, digits.length === 10 ? `55${digits}` : digits.slice(-10)]
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    // Normalize arrays from DB (may come as postgres arrays or JSON)
    return {
      ...row,
      preferred_services: parseStringArray(row.preferred_services),
      preferred_days: parseIntArray(row.preferred_days),
      last_completed_services: row.last_completed_services
        ? parseStringArray(row.last_completed_services as unknown as string[])
        : null,
    };
  } catch {
    // Table may not exist or query failed — fail silently
    return null;
  }
}

/**
 * Get or create a memory record for a client.
 * Returns the upserted row.
 */
async function ensureClientMemory(
  barbershopId: string,
  clientId: string
): Promise<string | null> {
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO public.client_ai_memory (client_id, barbershop_id)
       VALUES ($1, $2)
       ON CONFLICT (client_id, barbershop_id) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [clientId, barbershopId]
    );
    return r.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up client ID by phone.
 */
async function getClientIdByPhone(
  barbershopId: string,
  clientPhone: string
): Promise<string | null> {
  try {
    const digits = clientPhone.replace(/\D/g, "");
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM public.clients
       WHERE barbershop_id = $1
         AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY(ARRAY[$2, $3]::text[])
       LIMIT 1`,
      [barbershopId, digits, digits.length === 10 ? `55${digits}` : digits.slice(-10)]
    );
    return r.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt block generation
// ---------------------------------------------------------------------------

export interface MemoryPromptOptions {
  /** Minimum overall_confidence to include memory in prompt */
  minConfidence?: number;
  /** Minimum per-field confidence to include that field */
  minFieldConfidence?: number;
}

const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_MIN_FIELD_CONFIDENCE = 0.5;

/**
 * Builds a concise, model-safe memory block for injection into the system prompt.
 *
 * Rules:
 * - Only includes fields with confidence >= threshold
 * - Never dumps raw JSON
 * - Keeps it short (max ~15 lines)
 * - Includes explicit instructions telling the model how to use the memory
 * - Marks inferred data as "costuma" (habitually), not "sempre" (always)
 */
export function buildClientMemoryPromptBlock(
  memory: ClientMemoryRow | null,
  opts: MemoryPromptOptions = {}
): string {
  if (!memory) return "";

  const minConf = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const minField = opts.minFieldConfidence ?? DEFAULT_MIN_FIELD_CONFIDENCE;

  if (memory.overall_confidence < minConf) return "";

  const lines: string[] = [];

  // Services
  if (
    memory.preferred_services_conf >= minField &&
    memory.preferred_services.length > 0
  ) {
    const label =
      memory.preferred_services_conf >= 0.8 ? "costuma fazer" : "parece preferir";
    lines.push(`• Serviço: ${label} *${memory.preferred_services.join(" + ")}*`);
  }

  // Last completed (for "o de sempre" suggestions)
  if (
    memory.last_completed_services &&
    memory.last_completed_services.length > 0 &&
    memory.last_completed_at
  ) {
    const daysAgo = Math.floor(
      (Date.now() - new Date(memory.last_completed_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysAgo <= 180) {
      lines.push(
        `• Último atendimento: *${memory.last_completed_services.join(" + ")}* (há ${daysAgo} dias)`
      );
    }
  }

  // Barber preference
  if (
    memory.preferred_barber_conf >= minField &&
    memory.preferred_barber_name
  ) {
    const label =
      memory.preferred_barber_conf >= 0.8 ? "costuma preferir" : "já agendou com";
    lines.push(`• Barbeiro: ${label} *${memory.preferred_barber_name}*`);
  }

  // Time preference
  if (
    memory.preferred_time_conf >= minField &&
    memory.preferred_time_start
  ) {
    // Normalize Postgres time strings (e.g. "13:00:00" → "13:00")
    const normalizeTime = (t: string) => t.slice(0, 5);
    const start = normalizeTime(memory.preferred_time_start);
    const startH = parseInt(start.split(":")[0], 10);
    const period =
      startH < 12 ? "manhã" : startH < 18 ? "tarde" : "noite";
    lines.push(`• Horário: costuma preferir *${period}* (${start})`);
  }

  // Day preference
  if (
    memory.preferred_days_conf >= minField &&
    memory.preferred_days.length > 0
  ) {
    const dayNames = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const days = memory.preferred_days
      .map((d) => dayNames[d] ?? "")
      .filter(Boolean)
      .join(", ");
    lines.push(`• Dias: costuma preferir *${days}*`);
  }

  // Communication style
  if (
    memory.communication_style_conf >= minField &&
    memory.communication_style !== "unknown"
  ) {
    const styleMap: Record<string, string> = {
      formal: "formal/reservado",
      informal: "descontraído",
      direct: "direto/objetivo",
      chatty: "comunicativo/cordial",
    };
    const styleDesc = styleMap[memory.communication_style] ?? memory.communication_style;
    lines.push(`• Comunicação: estilo *${styleDesc}*`);
  }

  // Pending payment warning (always show if true)
  if (memory.payment_pending) {
    lines.push(`• Pagamento pendente: sim${memory.payment_pending_amount ? ` (R$ ${memory.payment_pending_amount.toFixed(2)})` : ""}`);
  }

  // No-show note (only if recent enough to be actionable)
  if (memory.no_show_count > 0 && memory.last_no_show_at) {
    const noShowDaysAgo = Math.floor(
      (Date.now() - new Date(memory.last_no_show_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (noShowDaysAgo >= 1 && noShowDaysAgo <= 90) {
      lines.push(`• Nota: não compareceu há ${noShowDaysAgo} dias`);
    } else if (noShowDaysAgo < 1) {
      lines.push(`• Nota: faltou no último agendamento`);
    }
  }

  // Safe notes
  if (memory.notes_safe && memory.notes_safe.trim()) {
    lines.push(`• Obs: ${memory.notes_safe.trim()}`);
  }

  if (lines.length === 0) return "";

  return [
    "--- Contexto do cliente (memória histórica) ---",
    ...lines,
    "[USO]: memória auxiliar apenas. A conversa atual tem prioridade absoluta.",
    "Use para reduzir perguntas e oferecer conveniência. Se o cliente indicar preferência diferente, siga o cliente.",
    "Não afirme preferências com certeza — use 'costuma' ou 'costumava'.",
    "--- fim da memória ---",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Write — appointment events
// ---------------------------------------------------------------------------

/**
 * Update client memory from an operational appointment event.
 * This is the most reliable source of truth — use high confidence.
 *
 * Accepts either clientPhone or clientId (clientId is preferred to avoid an extra DB lookup).
 * Call this fire-and-forget (no await needed from the caller).
 */
export async function updateClientMemoryFromAppointmentEvent(
  data: AppointmentEventData
): Promise<void> {
  const { eventType, barbershopId } = data;
  if (!barbershopId) return;
  if (!data.clientId && !data.clientPhone) return;

  try {
    // Resolve clientId — prefer direct value, fall back to phone lookup
    const clientId =
      data.clientId ??
      (data.clientPhone ? await getClientIdByPhone(barbershopId, data.clientPhone) : null);
    if (!clientId) return;

    await ensureClientMemory(barbershopId, clientId);

    if (eventType === "appointment_no_show") {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET no_show_count      = no_show_count + 1,
             last_no_show_at    = now(),
             reactivation_status = CASE
               WHEN no_show_count + 1 >= 2 THEN 'at_risk'
               ELSE reactivation_status
             END,
             overall_confidence = GREATEST(0, overall_confidence - 0.1),
             updated_at         = now()
         WHERE client_id = $1 AND barbershop_id = $2`,
        [clientId, barbershopId]
      );
      console.info("[client-memory] no_show recorded client=%s barbershop=%s", clientId, barbershopId);
      return;
    }

    if (eventType === "appointment_cancelled") {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET reactivation_status = CASE
               WHEN reactivation_status NOT IN ('churned') THEN 'at_risk'
               ELSE reactivation_status
             END,
             updated_at = now()
         WHERE client_id = $1 AND barbershop_id = $2`,
        [clientId, barbershopId]
      );
      return;
    }

    // appointment_created → moderate confidence (single data point)
    // appointment_completed → higher confidence (confirmed fact)
    const isCompleted = eventType === "appointment_completed";
    const serviceConf = isCompleted ? 0.7 : 0.6;
    const barberConf = isCompleted ? 0.7 : 0.5;

    if (data.serviceNames?.length) {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET preferred_services      = $1::jsonb,
             preferred_services_conf = GREATEST(preferred_services_conf, $2),
             updated_at              = now()
         WHERE client_id = $3 AND barbershop_id = $4`,
        [JSON.stringify(data.serviceNames), serviceConf, clientId, barbershopId]
      );
    }

    if (data.barberId) {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET preferred_barber_id   = $1,
             preferred_barber_conf = GREATEST(preferred_barber_conf, $2),
             updated_at            = now()
         WHERE client_id = $3 AND barbershop_id = $4`,
        [data.barberId, barberConf, clientId, barbershopId]
      );
    }

    if (isCompleted) {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET last_completed_services = $1::jsonb,
             last_completed_at       = now(),
             reactivation_status     = 'active',
             updated_at              = now()
         WHERE client_id = $2 AND barbershop_id = $3`,
        [JSON.stringify(data.serviceNames ?? []), clientId, barbershopId]
      );

      // Derive time preference from the completed appointment's scheduled_time
      if (data.date) {
        const timeRange = scheduledTimeToTimeRange(data.date);
        if (timeRange) {
          await pool.query(
            `UPDATE public.client_ai_memory
             SET preferred_time_start = $1,
                 preferred_time_end   = $2,
                 preferred_time_conf  = GREATEST(preferred_time_conf, $3),
                 updated_at           = now()
             WHERE client_id = $4 AND barbershop_id = $5`,
            [timeRange.start, timeRange.end, 0.5, clientId, barbershopId]
          );
        }
      }

      // After a completed event, run the full history-based reinforcement
      // This is the most impactful call — builds confidence from multiple appointments
      reinforceMemoryFromHistory(barbershopId, clientId).catch(() => {});
    }

    await recomputeOverallConfidence(clientId, barbershopId);
    console.info(
      "[client-memory] %s recorded client=%s barbershop=%s services=%j barber=%s",
      eventType, clientId, barbershopId, data.serviceNames, data.barberId
    );
  } catch (e) {
    // Silent failure — memory update must never break production flow
    console.warn("[client-memory] updateFromAppointmentEvent failed:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Write — conversation signals
// ---------------------------------------------------------------------------

export interface ConversationSignals {
  /** The full conversation (user + assistant messages) */
  messages: Array<{ role: string; content: string }>;
  /** The final state of the agent turn */
  finalState?: string;
  /** Barber ID chosen this turn (if resolved) */
  resolvedBarberId?: string;
  /** Service names resolved this turn */
  resolvedServiceNames?: string[];
}

/**
 * Extract and persist memory signals from a completed conversation.
 *
 * Conservative by design:
 * - Only extracts explicit, unambiguous signals
 * - Uses low/medium confidence for inferences
 * - Never overwrites higher-confidence existing data with lower-confidence new data
 *
 * Call fire-and-forget.
 */
export async function updateClientMemoryFromConversation(
  barbershopId: string,
  clientPhone: string,
  signals: ConversationSignals
): Promise<void> {
  if (!clientPhone || !barbershopId) return;

  try {
    const clientId = await getClientIdByPhone(barbershopId, clientPhone);
    if (!clientId) return;

    await ensureClientMemory(barbershopId, clientId);

    const userText = signals.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join(" ")
      .toLowerCase();

    // Communication style inference
    const commStyle = inferCommunicationStyle(userText);
    if (commStyle && commStyle !== "unknown") {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET communication_style = $1,
             communication_style_conf = GREATEST(communication_style_conf, $2),
             updated_at = now()
         WHERE client_id = $3 AND barbershop_id = $4
           AND (communication_style = 'unknown' OR communication_style_conf < $2)`,
        [commStyle, 0.5, clientId, barbershopId]
      );
    }

    // Time preference (if client explicitly mentions a time range preference)
    const timeRange = extractTimePreference(userText);
    if (timeRange) {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET preferred_time_start = $1,
             preferred_time_end = $2,
             preferred_time_conf = GREATEST(preferred_time_conf, $3),
             updated_at = now()
         WHERE client_id = $4 AND barbershop_id = $5`,
        [timeRange.start, timeRange.end, 0.5, clientId, barbershopId]
      );
    }

    // Reactivation status update
    if (signals.finalState === "appointment_created") {
      await pool.query(
        `UPDATE public.client_ai_memory
         SET reactivation_status = 'active',
             updated_at = now()
         WHERE client_id = $1 AND barbershop_id = $2`,
        [clientId, barbershopId]
      );
    }

    await recomputeOverallConfidence(clientId, barbershopId);
  } catch (e) {
    console.warn("[client-memory] updateFromConversation failed:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Payment pending (can be set from billing events)
// ---------------------------------------------------------------------------

export async function setPaymentPending(
  barbershopId: string,
  clientPhone: string,
  pending: boolean,
  amount?: number | null
): Promise<void> {
  try {
    const clientId = await getClientIdByPhone(barbershopId, clientPhone);
    if (!clientId) return;
    await ensureClientMemory(barbershopId, clientId);
    await pool.query(
      `UPDATE public.client_ai_memory
       SET payment_pending = $1,
           payment_pending_amount = $2,
           updated_at = now()
       WHERE client_id = $3 AND barbershop_id = $4`,
      [pending, amount ?? null, clientId, barbershopId]
    );
  } catch (e) {
    console.warn("[client-memory] setPaymentPending failed:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// History-based reinforcement
// ---------------------------------------------------------------------------

/**
 * Thresholds for converting appointment frequency to confidence.
 *
 * These are deliberately conservative to avoid false positives.
 * A "consistent" signal means the same value appeared in ≥ threshold/total ratio.
 */
const HISTORY_THRESHOLDS = {
  barber: { count2: 0.55, count3: 0.70, count5: 0.85 },
  services: { count2: 0.55, count3: 0.70, count5: 0.85 },
  days: { count2: 0.45, count3: 0.60, count5: 0.75 },
  time: { count2: 0.50, count3: 0.65, count5: 0.80 },
  /** Minimum ratio of appearances to total to count as "consistent" */
  minRatio: 0.5,
  /** Minimum absolute count for any inference */
  minAbsoluteCount: 2,
  /** Max appointments to consider for pattern analysis */
  lookbackLimit: 12,
};

/**
 * Derives confidence level from occurrence count using the threshold table.
 */
function countToConf(count: number, thresholds: { count2: number; count3: number; count5: number }): number {
  if (count >= 5) return thresholds.count5;
  if (count >= 3) return thresholds.count3;
  if (count >= 2) return thresholds.count2;
  return 0; // single occurrence → no confidence gain
}

/**
 * Analyze real appointment history and reinforce client memory preferences.
 *
 * Rules:
 * - Minimum 2 occurrences of same value to infer preference
 * - Only reinforce if new confidence ≥ existing confidence (never reduces)
 * - Majority rule: value must appear in ≥ 50% of analyzed appointments to qualify
 * - Looks at last HISTORY_THRESHOLDS.lookbackLimit completed appointments
 *
 * Call fire-and-forget.
 */
export async function reinforceMemoryFromHistory(
  barbershopId: string,
  clientId: string
): Promise<void> {
  if (!barbershopId || !clientId) return;
  try {
    // Query last N completed appointments for this client
    const historyResult = await pool.query<{
      barber_id: string;
      service_names: string[];
      day_of_week: number;  // 0=Sunday…6=Saturday (pg EXTRACT DOW)
      hour_of_day: number;  // 0-23
    }>(
      `SELECT
         a.barber_id,
         EXTRACT(DOW FROM a.scheduled_date)::int AS day_of_week,
         EXTRACT(HOUR FROM a.scheduled_time)::int AS hour_of_day,
         COALESCE(
           (SELECT array_agg(COALESCE(aps.service_name, s.name) ORDER BY aps.position)
            FROM public.appointment_services aps
            LEFT JOIN public.services s ON s.id = aps.service_id
            WHERE aps.appointment_id = a.id
              AND (aps.service_name IS NOT NULL OR s.name IS NOT NULL)
           ),
           ARRAY[]::text[]
         ) AS service_names
       FROM public.appointments a
       WHERE a.barbershop_id = $1
         AND a.client_id = $2
         AND a.status = 'completed'
       ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
       LIMIT $3`,
      [barbershopId, clientId, HISTORY_THRESHOLDS.lookbackLimit]
    );

    const rows = historyResult.rows;
    const total = rows.length;
    if (total < HISTORY_THRESHOLDS.minAbsoluteCount) return; // not enough data

    await ensureClientMemory(barbershopId, clientId);

    // --- Barber preference ---
    const barberCounts = new Map<string, number>();
    for (const r of rows) {
      if (r.barber_id) barberCounts.set(r.barber_id, (barberCounts.get(r.barber_id) ?? 0) + 1);
    }
    let topBarber: { id: string; count: number } | null = null;
    for (const [id, count] of barberCounts) {
      if (!topBarber || count > topBarber.count) topBarber = { id, count };
    }
    if (
      topBarber &&
      topBarber.count >= HISTORY_THRESHOLDS.minAbsoluteCount &&
      topBarber.count / total >= HISTORY_THRESHOLDS.minRatio
    ) {
      const conf = countToConf(topBarber.count, HISTORY_THRESHOLDS.barber);
      if (conf > 0) {
        await pool.query(
          `UPDATE public.client_ai_memory
           SET preferred_barber_id   = $1,
               preferred_barber_conf = GREATEST(preferred_barber_conf, $2),
               updated_at            = now()
           WHERE client_id = $3 AND barbershop_id = $4`,
          [topBarber.id, conf, clientId, barbershopId]
        );
      }
    }

    // --- Service preference ---
    // Flatten all service names from all appointments, then find the dominant combination
    // Use a normalized combo string (sorted service names joined) as the key
    const serviceComboCounts = new Map<string, { names: string[]; count: number }>();
    for (const r of rows) {
      const names = (r.service_names ?? []).filter(Boolean).sort();
      if (!names.length) continue;
      const key = names.join("|");
      const existing = serviceComboCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        serviceComboCounts.set(key, { names, count: 1 });
      }
    }
    let topServices: { names: string[]; count: number } | null = null;
    for (const v of serviceComboCounts.values()) {
      if (!topServices || v.count > topServices.count) topServices = v;
    }
    if (
      topServices &&
      topServices.count >= HISTORY_THRESHOLDS.minAbsoluteCount &&
      topServices.count / total >= HISTORY_THRESHOLDS.minRatio
    ) {
      const conf = countToConf(topServices.count, HISTORY_THRESHOLDS.services);
      if (conf > 0) {
        await pool.query(
          `UPDATE public.client_ai_memory
           SET preferred_services      = $1::jsonb,
               preferred_services_conf = GREATEST(preferred_services_conf, $2),
               updated_at              = now()
           WHERE client_id = $3 AND barbershop_id = $4`,
          [JSON.stringify(topServices.names), conf, clientId, barbershopId]
        );
      }
    }

    // --- Day-of-week preference ---
    const dayCounts = new Map<number, number>();
    for (const r of rows) {
      const d = r.day_of_week;
      dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    }
    // Collect days that appear consistently (minRatio of total)
    const preferredDays: number[] = [];
    let totalDayCount = 0;
    for (const [, count] of dayCounts) {
      if (count >= HISTORY_THRESHOLDS.minAbsoluteCount && count / total >= HISTORY_THRESHOLDS.minRatio) {
        totalDayCount += count;
      }
    }
    for (const [day, count] of dayCounts) {
      if (count >= HISTORY_THRESHOLDS.minAbsoluteCount && count / total >= HISTORY_THRESHOLDS.minRatio) {
        preferredDays.push(day);
      }
    }
    if (preferredDays.length > 0 && totalDayCount >= HISTORY_THRESHOLDS.minAbsoluteCount) {
      const maxDayCount = Math.max(...preferredDays.map((d) => dayCounts.get(d) ?? 0));
      const conf = countToConf(maxDayCount, HISTORY_THRESHOLDS.days);
      if (conf > 0) {
        await pool.query(
          `UPDATE public.client_ai_memory
           SET preferred_days      = $1::int[],
               preferred_days_conf = GREATEST(preferred_days_conf, $2),
               updated_at          = now()
           WHERE client_id = $3 AND barbershop_id = $4`,
          [preferredDays, conf, clientId, barbershopId]
        );
      }
    }

    // --- Time-of-day preference ---
    // Classify each appointment into morning/afternoon/evening period
    const periodCounts = new Map<string, { start: string; end: string; count: number }>();
    for (const r of rows) {
      const h = r.hour_of_day;
      const period =
        h < 12 ? { key: "morning", start: "08:00", end: "12:00" } :
        h < 18 ? { key: "afternoon", start: "13:00", end: "18:00" } :
                 { key: "evening", start: "18:00", end: "21:00" };
      const existing = periodCounts.get(period.key);
      if (existing) {
        existing.count++;
      } else {
        periodCounts.set(period.key, { start: period.start, end: period.end, count: 1 });
      }
    }
    let topPeriod: { start: string; end: string; count: number } | null = null;
    for (const v of periodCounts.values()) {
      if (!topPeriod || v.count > topPeriod.count) topPeriod = v;
    }
    if (
      topPeriod &&
      topPeriod.count >= HISTORY_THRESHOLDS.minAbsoluteCount &&
      topPeriod.count / total >= HISTORY_THRESHOLDS.minRatio
    ) {
      const conf = countToConf(topPeriod.count, HISTORY_THRESHOLDS.time);
      if (conf > 0) {
        await pool.query(
          `UPDATE public.client_ai_memory
           SET preferred_time_start = $1,
               preferred_time_end   = $2,
               preferred_time_conf  = GREATEST(preferred_time_conf, $3),
               updated_at           = now()
           WHERE client_id = $4 AND barbershop_id = $5`,
          [topPeriod.start, topPeriod.end, conf, clientId, barbershopId]
        );
      }
    }

    await recomputeOverallConfidence(clientId, barbershopId);
    console.info(
      "[client-memory] history reinforcement done client=%s total_appts=%d barber=%s services=%j days=%j period=%j",
      clientId, total, topBarber?.id ?? "none",
      topServices?.names ?? [],
      preferredDays,
      topPeriod ? `${topPeriod.start}-${topPeriod.end}` : "none"
    );
  } catch (e) {
    console.warn("[client-memory] reinforceMemoryFromHistory failed:", (e as Error).message);
  }
}

/**
 * Convert a scheduled time (HH:MM) to a time-of-day range bucket.
 * Returns null if time is unparseable.
 */
function scheduledTimeToTimeRange(time: string): { start: string; end: string } | null {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  if (h < 12) return { start: "08:00", end: "12:00" };
  if (h < 18) return { start: "13:00", end: "18:00" };
  return { start: "18:00", end: "21:00" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function recomputeOverallConfidence(
  clientId: string,
  barbershopId: string
): Promise<void> {
  // Compute as weighted average of non-zero confidence fields
  await pool.query(
    `UPDATE public.client_ai_memory
     SET overall_confidence = ROUND(
       (COALESCE(preferred_services_conf, 0) * 2 +
        COALESCE(preferred_barber_conf, 0) * 1.5 +
        COALESCE(preferred_days_conf, 0) * 0.5 +
        COALESCE(preferred_time_conf, 0) * 0.5 +
        COALESCE(communication_style_conf, 0) * 0.5) /
       NULLIF(
         (CASE WHEN preferred_services_conf > 0 THEN 2 ELSE 0 END) +
         (CASE WHEN preferred_barber_conf > 0 THEN 1.5 ELSE 0 END) +
         (CASE WHEN preferred_days_conf > 0 THEN 0.5 ELSE 0 END) +
         (CASE WHEN preferred_time_conf > 0 THEN 0.5 ELSE 0 END) +
         (CASE WHEN communication_style_conf > 0 THEN 0.5 ELSE 0 END),
         0
       ),
       2
     ),
     updated_at = now()
     WHERE client_id = $1 AND barbershop_id = $2`,
    [clientId, barbershopId]
  );
}

function inferCommunicationStyle(
  text: string
): ClientMemoryRow["communication_style"] {
  // Formal: long sentences, formal pronouns
  if (/\b(senhor|senhora|gostaria de|poderia|por favor|obrigado|prezad)/i.test(text)) {
    return "formal";
  }
  // Chatty: many exclamation marks or laughter expressions
  const exclamationCount = (text.match(/!/g) ?? []).length;
  const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (exclamationCount + emojiCount > 3 || /\b(hahaha|kkk|rs+)\b/i.test(text)) {
    return "chatty";
  }
  // Direct: very short messages, single-word replies
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 20 && !/\b(oi|olá|bom dia|boa tarde)\b/i.test(text)) {
    return "direct";
  }
  // Informal: common Brazilian informal speech
  if (/\b(mano|cara|véi|parceiro|irmão|brother|opa|valeu|vlw)\b/i.test(text)) {
    return "informal";
  }
  return "unknown";
}

interface TimeRange {
  start: string;
  end: string;
}

function extractTimePreference(text: string): TimeRange | null {
  // Explicit "prefiro manhã / tarde / noite"
  if (/\b(manhã|de manhã|pela manhã|prefiro.*manhã|gosto.*manhã)\b/i.test(text)) {
    return { start: "08:00", end: "12:00" };
  }
  if (/\b(tarde|de tarde|pela tarde|prefiro.*tarde|gosto.*tarde)\b/i.test(text)) {
    return { start: "13:00", end: "18:00" };
  }
  if (/\b(noite|de noite|pela noite|prefiro.*noite|gosto.*noite)\b/i.test(text)) {
    return { start: "18:00", end: "21:00" };
  }
  // Explicit range like "entre 9 e 11"
  const rangeMatch = text.match(/entre\s+(\d{1,2})[h:]?(\d{2})?\s+e\s+(\d{1,2})[h:]?(\d{2})?/i);
  if (rangeMatch) {
    const sh = parseInt(rangeMatch[1], 10);
    const sm = parseInt(rangeMatch[2] ?? "0", 10);
    const eh = parseInt(rangeMatch[3], 10);
    const em = parseInt(rangeMatch[4] ?? "0", 10);
    if (!isNaN(sh) && !isNaN(eh)) {
      return {
        start: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`,
        end: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
      };
    }
  }
  return null;
}

function parseStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    // Postgres array format: {a,b,c}
    if (val.startsWith("{")) {
      return val.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    }
  }
  return [];
}

function parseIntArray(val: unknown): number[] {
  if (Array.isArray(val)) return val.map(Number).filter((n) => !isNaN(n));
  if (typeof val === "string") {
    if (val.startsWith("{")) {
      return val
        .slice(1, -1)
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Table existence check (cached)
// ---------------------------------------------------------------------------

let _tableExists: boolean | null = null;

export async function clientMemoryTableExists(): Promise<boolean> {
  if (_tableExists !== null) return _tableExists;
  try {
    const r = await pool.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'client_ai_memory'
       ) AS ok`
    );
    _tableExists = r.rows[0]?.ok === true;
  } catch {
    _tableExists = false;
  }
  return _tableExists;
}
