/**
 * Pending intents — secondary intents the orchestrator postponed so the transactional
 * intent of the turn is handled first. Persisted per conversation at the Turno boundary.
 * See CONTEXT.md > Intenção > Múltiplas intenções no mesmo Turno.
 */
import { pool } from "../../db.js";
import type { IntentType } from "./types.js";

export type PendingIntents = {
  intents: IntentType[];
  /** The client was already asked whether to handle them now. */
  offered: boolean;
};

const PENDABLE = new Set<IntentType>(["plan", "waitlist", "payment", "location", "hours", "consult"]);

export function emptyPendingIntents(): PendingIntents {
  return { intents: [], offered: false };
}

export function parsePendingIntents(raw: unknown): PendingIntents {
  if (!raw || typeof raw !== "object") return emptyPendingIntents();
  const obj = raw as { intents?: unknown; offered?: unknown };
  const intents = Array.isArray(obj.intents)
    ? [...new Set(obj.intents.filter((i): i is IntentType => typeof i === "string" && PENDABLE.has(i as IntentType)))]
    : [];
  return { intents, offered: obj.offered === true && intents.length > 0 };
}

export async function loadPendingIntents(conversationId: string): Promise<PendingIntents> {
  try {
    const r = await pool.query<{ pending_intents: unknown }>(
      `SELECT pending_intents FROM public.ai_conversation_runtime WHERE conversation_id = $1`,
      [conversationId],
    );
    return parsePendingIntents(r.rows[0]?.pending_intents);
  } catch {
    return emptyPendingIntents();
  }
}

export async function savePendingIntents(conversationId: string, pending: PendingIntents): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.ai_conversation_runtime (conversation_id, pending_intents, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (conversation_id) DO UPDATE SET pending_intents = $2::jsonb, updated_at = now()`,
      [conversationId, pending.intents.length ? JSON.stringify(pending) : null],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42703") return;
    console.warn("[pending-intents] save failed:", e instanceof Error ? e.message : e);
  }
}

const PENDING_LABEL: Partial<Record<IntentType, string>> = {
  plan: "os planos",
  waitlist: "a lista de espera",
  payment: "o pagamento",
  location: "a localização",
  hours: "o horário de funcionamento",
  consult: "seus horários marcados",
};

/** "Quer que eu te passe os planos agora?" — asked once the transactional intent closes. */
export function composePendingIntentOffer(intents: IntentType[]): string | null {
  const labels = intents.map((i) => PENDING_LABEL[i]).filter((l): l is string => Boolean(l));
  if (!labels.length) return null;
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
  return `Você também comentou sobre ${joined} — quer que eu te passe agora?`;
}
