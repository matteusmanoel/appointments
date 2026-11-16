/**
 * Contexto do cliente que sobrevive à conversa: rascunho, card, intenções
 * pendentes e a última intenção. Isolado por barbearia e cliente.
 * A conversa nova hidrata daqui quando ainda não tem rascunho próprio.
 */
import { pool } from "../../db.js";
import { parseBookingDraft, saveBookingDraft, type BookingDraft } from "../booking-draft.js";
import {
  emptyPendingIntents,
  parsePendingIntents,
  savePendingIntents,
  type PendingIntents,
} from "./pending-intents.js";

export type ClientSessionContext = {
  bookingDraft: BookingDraft;
  pendingIntents: PendingIntents;
  lastIntent: string | null;
  updatedAt: string;
};

function phoneKeys(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const alt = digits.length === 10 ? `55${digits}` : digits.length > 10 ? digits.slice(-10) : digits;
  return [...new Set([digits, alt])];
}

async function clientIdFor(barbershopId: string, clientPhone: string): Promise<string | null> {
  const keys = phoneKeys(clientPhone);
  if (!keys.length) return null;
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1
       AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])
     LIMIT 1`,
    [barbershopId, keys],
  );
  return r.rows[0]?.id ?? null;
}

function parseSession(raw: unknown): ClientSessionContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lastIntent = typeof r.lastIntent === "string" && r.lastIntent.trim() ? r.lastIntent.trim() : null;
  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : "";
  return {
    bookingDraft: parseBookingDraft(r.bookingDraft),
    pendingIntents: parsePendingIntents(r.pendingIntents),
    lastIntent,
    updatedAt,
  };
}

export async function loadClientSessionContext(
  barbershopId: string,
  clientPhone: string,
): Promise<ClientSessionContext | null> {
  try {
    const clientId = await clientIdFor(barbershopId, clientPhone);
    if (!clientId) return null;
    const r = await pool.query<{ session_context: unknown }>(
      `SELECT session_context FROM public.client_ai_memory
       WHERE client_id = $1 AND barbershop_id = $2`,
      [clientId, barbershopId],
    );
    return parseSession(r.rows[0]?.session_context);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42703") return null;
    console.warn("[client-session] load failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function saveClientSessionContext(params: {
  barbershopId: string;
  clientPhone: string;
  bookingDraft: BookingDraft;
  pendingIntents: PendingIntents;
  lastIntent: string | null;
}): Promise<void> {
  try {
    const clientId = await clientIdFor(params.barbershopId, params.clientPhone);
    if (!clientId) return;
    const payload: ClientSessionContext = {
      bookingDraft: params.bookingDraft,
      pendingIntents: params.pendingIntents.intents.length ? params.pendingIntents : emptyPendingIntents(),
      lastIntent: params.lastIntent,
      updatedAt: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO public.client_ai_memory (client_id, barbershop_id, session_context)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (client_id, barbershop_id) DO UPDATE
         SET session_context = $3::jsonb, updated_at = now()`,
      [clientId, params.barbershopId, JSON.stringify(payload)],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42703") return;
    console.warn("[client-session] save failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Conversa sem rascunho próprio herda o contexto do cliente (card incluso).
 * O TTL continua valendo: um card vencido entra, mas o «sim» não o executa.
 */
export async function hydrateConversationContext(params: {
  barbershopId: string;
  clientPhone: string;
  conversationId: string;
}): Promise<BookingDraft> {
  try {
    const row = await pool.query<{ booking_draft: unknown }>(
      `SELECT booking_draft FROM public.ai_conversation_runtime
       WHERE conversation_id = $1 AND booking_draft IS NOT NULL`,
      [params.conversationId],
    );
    if (row.rows[0]) return parseBookingDraft(row.rows[0].booking_draft);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "42P01" && code !== "42703") {
      console.warn("[client-session] draft lookup failed:", e instanceof Error ? e.message : e);
    }
  }

  const prior = await loadClientSessionContext(params.barbershopId, params.clientPhone);
  if (!prior) return parseBookingDraft(null);
  await saveBookingDraft(params.conversationId, prior.bookingDraft);
  if (prior.pendingIntents.intents.length) {
    await savePendingIntents(params.conversationId, prior.pendingIntents);
  }
  return prior.bookingDraft;
}
