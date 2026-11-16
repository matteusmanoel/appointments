/**
 * Contexto do cliente que sobrevive à conversa: rascunho, card, intenções
 * pendentes e a última intenção. Isolado por barbearia e cliente.
 * A conversa nova hidrata daqui quando ainda não tem rascunho próprio.
 */
import { pool } from "../../db.js";
import { brPhoneMatchKeys, canonicalizeBrPhoneDigits, normalizeDigits } from "../../lib/phone-match.js";
import { isLiveConfirmCard } from "./confirmation-card.js";
import { emptyBookingDraft, parseBookingDraft, saveBookingDraft, type BookingDraft } from "../booking-draft.js";
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

/** Rascunho e intenções pendentes expiram 24 h depois do updatedAt. O card tem o TTL dele. */
export const SESSION_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** Horário do card no fuso da barbearia (Brasil sem horário de verão). */
function slotStartsAtMs(date: string, time: string): number {
  return Date.parse(`${date}T${time.slice(0, 5)}:00-03:00`);
}

/** Mesmas chaves do resto do agente (`brPhoneMatchKeys`), sem o recorte dos últimos 10 dígitos. */
export function sessionPhoneKeys(phone: string): string[] {
  const digits = normalizeDigits(phone);
  if (digits.length < 10) return [];
  const canonical = canonicalizeBrPhoneDigits(digits) ?? digits;
  return brPhoneMatchKeys(canonical);
}

export function sessionBodiesMatch(a: ClientSessionContext, b: ClientSessionContext): boolean {
  return (
    JSON.stringify(a.bookingDraft) === JSON.stringify(b.bookingDraft) &&
    JSON.stringify(a.pendingIntents) === JSON.stringify(b.pendingIntents) &&
    a.lastIntent === b.lastIntent
  );
}

/**
 * Dentro de 24 h, a conversa nova herda o rascunho aberto e as intenções.
 * Card ainda no TTL de 30 min vira contexto: `confirmCardReplay` impede o «sim»
 * de executar e o agente reapresenta. Slot que já passou não volta como card.
 * Rascunho fechado ou mais velho que 24 h não leva serviço: o de sempre fica
 * na memória de preferências.
 */
export function narrowSessionForHydration(
  session: ClientSessionContext,
  nowMs: number,
): { bookingDraft: BookingDraft; pendingIntents: PendingIntents; fresh: boolean } {
  const age = nowMs - Date.parse(session.updatedAt);
  const stale = !Number.isFinite(age) || age > SESSION_DRAFT_TTL_MS;
  const closed = session.bookingDraft.status === "closed";
  if (stale || closed) {
    return { bookingDraft: emptyBookingDraft(), pendingIntents: emptyPendingIntents(), fresh: false };
  }
  let bookingDraft: BookingDraft = { ...session.bookingDraft };
  const card = bookingDraft.confirmCard;
  if (card && card.kind !== "reminder") {
    const slotMs =
      bookingDraft.date && bookingDraft.time ? slotStartsAtMs(bookingDraft.date, bookingDraft.time) : NaN;
    const passed = Number.isFinite(slotMs) && slotMs <= nowMs;
    if (passed) {
      const rest = { ...bookingDraft };
      delete rest.confirmCard;
      delete rest.confirmCardReplay;
      bookingDraft = rest;
    } else if (isLiveConfirmCard(card, new Date(nowMs))) {
      bookingDraft = { ...bookingDraft, confirmCardReplay: true };
    }
  }
  return { bookingDraft, pendingIntents: session.pendingIntents, fresh: true };
}

/** Casa o telefone com o cliente do tenant. A chave de 10 dígitos não atravessa DDD. */
export async function findClientIdByPhone(barbershopId: string, clientPhone: string): Promise<string | null> {
  const keys = sessionPhoneKeys(clientPhone);
  if (!keys.length) return null;
  const canonical = canonicalizeBrPhoneDigits(normalizeDigits(clientPhone)) ?? keys[0];
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM public.clients
     WHERE barbershop_id = $1
       AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])
     ORDER BY
       CASE WHEN regexp_replace(phone, '[^0-9]', '', 'g') = $3 THEN 0 ELSE 1 END,
       length(regexp_replace(phone, '[^0-9]', '', 'g')) DESC,
       id
     LIMIT 1`,
    [barbershopId, keys, canonical],
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
    const clientId = await findClientIdByPhone(barbershopId, clientPhone);
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
  /** Início do turno. Uma execução mais antiga não cobre uma mais nova. */
  updatedAt: string;
}): Promise<void> {
  try {
    const clientId = await findClientIdByPhone(params.barbershopId, params.clientPhone);
    if (!clientId) return;
    const payload: ClientSessionContext = {
      bookingDraft: params.bookingDraft,
      pendingIntents: params.pendingIntents.intents.length ? params.pendingIntents : emptyPendingIntents(),
      lastIntent: params.lastIntent,
      updatedAt: params.updatedAt,
    };
    const current = await loadClientSessionContext(params.barbershopId, params.clientPhone);
    if (current && sessionBodiesMatch(current, payload)) return;
    await pool.query(
      `INSERT INTO public.client_ai_memory (client_id, barbershop_id, session_context)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (client_id, barbershop_id) DO UPDATE
         SET session_context = EXCLUDED.session_context, updated_at = now()
       WHERE client_ai_memory.session_context IS NULL
          OR COALESCE(client_ai_memory.session_context->>'updatedAt', '') <= EXCLUDED.session_context->>'updatedAt'`,
      [clientId, params.barbershopId, JSON.stringify(payload)],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42703") return;
    console.warn("[client-session] save failed:", e instanceof Error ? e.message : e);
  }
}

export type HydratedSession = {
  bookingDraft: BookingDraft;
  lastIntent: string | null;
  /** Verdadeiro só quando a conversa herdou um rascunho ainda aberto e recente. */
  fresh: boolean;
};

/**
 * Conversa sem rascunho próprio herda o contexto do cliente.
 * O card vencido entra se o rascunho ainda está nas 24 h; o TTL de 30 min continua valendo.
 * Card vivo entra com `confirmCardReplay`: o «sim» desta conversa não executa.
 */
export async function hydrateConversationContext(params: {
  barbershopId: string;
  clientPhone: string;
  conversationId: string;
  nowMs?: number;
}): Promise<HydratedSession> {
  const empty: HydratedSession = { bookingDraft: parseBookingDraft(null), lastIntent: null, fresh: false };
  try {
    const row = await pool.query<{ booking_draft: unknown }>(
      `SELECT booking_draft FROM public.ai_conversation_runtime
       WHERE conversation_id = $1 AND booking_draft IS NOT NULL`,
      [params.conversationId],
    );
    if (row.rows[0]) {
      return { bookingDraft: parseBookingDraft(row.rows[0].booking_draft), lastIntent: null, fresh: false };
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "42P01" && code !== "42703") {
      console.warn("[client-session] draft lookup failed:", e instanceof Error ? e.message : e);
    }
  }

  const prior = await loadClientSessionContext(params.barbershopId, params.clientPhone);
  if (!prior) return empty;
  const narrowed = narrowSessionForHydration(prior, params.nowMs ?? Date.now());
  await saveBookingDraft(params.conversationId, narrowed.bookingDraft);
  if (narrowed.pendingIntents.intents.length) {
    await savePendingIntents(params.conversationId, narrowed.pendingIntents);
  }
  return {
    bookingDraft: narrowed.bookingDraft,
    lastIntent: narrowed.fresh ? prior.lastIntent : null,
    fresh: narrowed.fresh,
  };
}
