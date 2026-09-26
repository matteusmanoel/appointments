import { pool } from "../../db.js";
import { setConversationPaused } from "../../ai/runtime-pause.js";
import { canonicalizeBrPhoneDigits, brPhoneMatchKeys } from "../../lib/phone-match.js";
import { matchBotEcho, markEchoDelivered } from "./bot-pending.js";
import type { CanonicalInbound } from "./parse-evolution.js";
import type { WhatsAppProviderName } from "./types.js";
import { looksLikeTestWipeCommand } from "../../ai/conversation-intents.js";
import { wipeWhatsAppTestContext } from "../../ai/wipe-test-context.js";
import { AUDIO_FAIL_REPLY, transcribeInboundAudio } from "../../ai/transcribe-inbound-audio.js";
import { readReceiptFromMedia } from "../../ai/read-receipt-media.js";
import { decideReceiptAcceptance, RECEIPT_FAIL_REPLY, RECEIPT_OK_REPLY } from "../../ai/parse-receipt.js";
import { recordAgendaChange, type AgendaChangeEvent } from "../../agenda/record-agenda-change.js";
import { addDaysIso } from "../../ai/date-calendar.js";
import { getWhatsAppOrNull } from "./index.js";
import { scheduleClientPhotoSync } from "../../clients/sync-contact-photo.js";
import { config } from "../../config.js";
import { clampInboundQuietSeconds } from "./inbound-turn.js";

async function getHandoffPauseHours(barbershopId: string): Promise<number> {
  try {
    const r = await pool.query<{ pause_hours: number }>(
      `SELECT pause_hours FROM public.barbershop_ai_handoff_settings WHERE barbershop_id = $1`,
      [barbershopId],
    );
    const hours = r.rows[0]?.pause_hours;
    if (typeof hours === "number" && Number.isFinite(hours) && hours > 0 && hours <= 168) {
      return Math.floor(hours);
    }
    return 4;
  } catch {
    return 4;
  }
}

export async function resolveBarbershopByInstance(
  provider: WhatsAppProviderName,
  instanceKey: string,
): Promise<string | null> {
  if (!instanceKey) return null;
  if (provider === "evolution") {
    try {
      const r = await pool.query<{ barbershop_id: string }>(
        `SELECT barbershop_id FROM public.barbershop_whatsapp_connections
         WHERE provider = 'evolution' AND evolution_instance_name = $1 LIMIT 1`,
        [instanceKey],
      );
      return r.rows[0]?.barbershop_id ?? null;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "42703") throw e;
      return null;
    }
  }
  const r = await pool.query<{ barbershop_id: string }>(
    `SELECT barbershop_id FROM public.barbershop_whatsapp_connections
     WHERE provider = 'uazapi' AND (uazapi_instance_name = $1 OR uazapi_instance_id = $1) LIMIT 1`,
    [instanceKey],
  );
  return r.rows[0]?.barbershop_id ?? null;
}

async function findConversation(barbershopId: string, phone: string): Promise<string | null> {
  const canonicalPhone = canonicalizeBrPhoneDigits(phone) ?? phone;
  const matchKeys = brPhoneMatchKeys(canonicalPhone);
  const conv = await pool.query<{ id: string }>(
    `SELECT id FROM public.ai_conversations
     WHERE barbershop_id = $1 AND channel = 'whatsapp'
       AND (external_thread_id = $2 OR regexp_replace(external_thread_id, '[^0-9]', '', 'g') = ANY($3::text[]))
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [barbershopId, canonicalPhone, matchKeys],
  );
  return conv.rows[0]?.id ?? null;
}

export async function handleFromMeHandoff(params: {
  provider: WhatsAppProviderName;
  parsed: CanonicalInbound;
  logPrefix: string;
}): Promise<{ handled: boolean }> {
  const { provider, parsed, logPrefix } = params;
  if (!parsed.fromMe || !parsed.handoffCandidate || !parsed.instanceKey) {
    return { handled: false };
  }
  const barbershopId = await resolveBarbershopByInstance(provider, parsed.instanceKey);
  if (!barbershopId) return { handled: true };
  if (!parsed.fromPhone) {
    console.info("[%s] fromMe ignored (no phone) barbershopId=%s", logPrefix, barbershopId);
    return { handled: true };
  }
  const conversationId = await findConversation(barbershopId, parsed.fromPhone);
  if (!conversationId) {
    console.info("[%s] fromMe ignored (no conversation found) barbershopId=%s", logPrefix, barbershopId);
    return { handled: true };
  }

  const echo = await matchBotEcho({
    conversationId,
    providerEventId: parsed.providerEventId,
  });
  if (echo) {
    await markEchoDelivered({ messageId: echo.id, providerEventId: parsed.providerEventId }).catch(() => {});
    console.info(
      "[%s] fromMe ignored as assistant echo conversationId=%s barbershopId=%s",
      logPrefix,
      conversationId,
      barbershopId,
    );
    return { handled: true };
  }

  if (provider === "uazapi" && parsed.text) {
    const textEcho = await pool.query<{ id: string }>(
      `SELECT id FROM public.ai_messages
       WHERE conversation_id = $1 AND role = 'assistant' AND created_at >= now() - interval '15 minutes'
         AND lower(regexp_replace(coalesce(content,''), '\\s+', ' ', 'g')) = lower(regexp_replace($2, '\\s+', ' ', 'g'))
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId, parsed.text],
    );
    if (textEcho.rows[0]) {
      await markEchoDelivered({
        messageId: textEcho.rows[0].id,
        providerEventId: parsed.providerEventId,
      }).catch(() => {});
      console.info(
        "[%s] fromMe ignored as assistant echo (text) conversationId=%s barbershopId=%s",
        logPrefix,
        conversationId,
        barbershopId,
      );
      return { handled: true };
    }
  }

  const pauseHours = await getHandoffPauseHours(barbershopId);
  await setConversationPaused(conversationId, {
    pausedBy: "auto",
    reason: "Mensagem do próprio número (handoff detectado)",
    hours: pauseHours,
  });
  await pool.query(
    `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
     VALUES ($1, $2, 'paused', 'auto', $3)`,
    [barbershopId, conversationId, "Mensagem do próprio número (handoff detectado)"],
  );
  console.info("[%s] handoff conversation paused conversationId=%s barbershopId=%s", logPrefix, conversationId, barbershopId);
  return { handled: true };
}

async function rememberWhatsAppContactName(
  barbershopId: string,
  phone: string,
  pushName: string | null | undefined,
): Promise<void> {
  const label = (pushName ?? "").trim().slice(0, 120);
  if (!label || !phone) return;
  await pool.query(
    `UPDATE public.clients
     SET whatsapp_contact_name = $3, updated_at = now()
     WHERE barbershop_id = $1
       AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
    [barbershopId, phone.replace(/\D/g, ""), label],
  );
}

export async function enqueueInboundMessage(params: {
  provider: WhatsAppProviderName;
  barbershopId: string;
  fromPhone: string;
  text: string;
  providerEventId: string;
  payload: unknown;
  eventLabel?: string;
  logPrefix: string;
  pushName?: string | null;
}): Promise<void> {
  const { provider, barbershopId, text, providerEventId, payload, logPrefix } = params;
  const canonicalPhone = canonicalizeBrPhoneDigits(params.fromPhone) ?? params.fromPhone;
  if (canonicalPhone && params.pushName) {
    try {
      await rememberWhatsAppContactName(barbershopId, canonicalPhone, params.pushName);
    } catch (e) {
      console.warn("[%s] pushName persist failed:", logPrefix, e instanceof Error ? e.message : e);
    }
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO public.whatsapp_inbound_events (barbershop_id, provider, provider_event_id, from_phone, payload, received_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (provider, provider_event_id) WHERE provider_event_id IS NOT NULL AND provider_event_id <> ''
     DO NOTHING RETURNING id`,
    [barbershopId, provider, providerEventId, canonicalPhone, JSON.stringify(payload ?? {})],
  );
  if (inserted.rows.length === 0) {
    console.info("[%s] duplicate providerEventId=%s skipped", logPrefix, providerEventId);
    return;
  }

  const optOutMatchKeys = brPhoneMatchKeys(canonicalPhone);
  const optOutPattern =
    /^(parar|n[aã]o\s*quero\s*receber|cancelar\s*inscri[cç][aã]o|opt\s*out|remover|n[aã]o\s*receber\s*mais|sair\s*da\s*lista)$/i;
  const trimmed = (text || "").trim().toLowerCase();
  if (optOutPattern.test(trimmed) || (trimmed.includes("parar") && trimmed.length < 50)) {
    if (canonicalPhone) {
      const updated = await pool.query(
        `UPDATE public.clients SET marketing_opt_out = true, updated_at = now()
         WHERE barbershop_id = $1 AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])`,
        [barbershopId, optOutMatchKeys],
      );
      if (updated.rowCount === 0) {
        await pool.query(
          `INSERT INTO public.clients (barbershop_id, name, phone, marketing_opt_out, whatsapp_contact_name, name_confirmed, updated_at)
           VALUES ($1, 'Cliente', $2, true, $3, false, now())
           ON CONFLICT (barbershop_id, phone) DO UPDATE SET
             marketing_opt_out = true,
             whatsapp_contact_name = COALESCE(EXCLUDED.whatsapp_contact_name, clients.whatsapp_contact_name),
             updated_at = now()`,
          [barbershopId, canonicalPhone, (params.pushName ?? "").trim().slice(0, 120) || null],
        );
        scheduleClientPhotoSync(barbershopId, canonicalPhone);
      }
    }
  }

  const conv = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_conversations (barbershop_id, channel, external_thread_id, last_message_at, updated_at)
     VALUES ($1, 'whatsapp', $2, now(), now())
     ON CONFLICT (barbershop_id, channel, external_thread_id)
     DO UPDATE SET last_message_at = now(), updated_at = now()
     RETURNING id`,
    [barbershopId, canonicalPhone],
  );
  const conversationId = conv.rows[0]?.id;
  if (!conversationId) return;

  if (looksLikeTestWipeCommand(text)) {
    const wiped = await wipeWhatsAppTestContext({ barbershopId, phone: canonicalPhone });
    const ack =
      "Pronto — limpei o contexto deste teste (conversa, agendamentos e cadastro deste WhatsApp). Pode começar do zero.";
    const session = await getWhatsAppOrNull(barbershopId);
    if (session) {
      try {
        await session.sendText(canonicalPhone, ack);
      } catch (e) {
        console.warn("[%s] /deletar send failed:", logPrefix, e instanceof Error ? e.message : e);
      }
    }
    console.info(
      "[%s] wiped test context barbershopId=%s clients=%s appointments=%s conversations=%s",
      logPrefix,
      barbershopId,
      wiped.clients,
      wiped.appointments,
      wiped.conversations,
    );
    return;
  }

  // Detect first ever inbound message → emit conversation_started activity
  try {
    const priorMsgCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM public.ai_messages
       WHERE conversation_id = $1 AND role = 'user'`,
      [conversationId],
    );
    if (Number(priorMsgCount.rows[0]?.count) === 0) {
      await recordAgendaChange({
        barbershopId,
        appointmentId: null,
        conversationId,
        type: "conversation_started",
        actor: "ai",
        clientName: (params.pushName ?? "").trim() || null,
        clientPhone: canonicalPhone,
        summary: text.slice(0, 500),
      });
    }
  } catch (e) {
    console.warn("[%s] conversation_started record failed:", logPrefix, e instanceof Error ? e.message : e);
  }

  await pool.query(
    `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id)
     VALUES ($1, 'user', $2, $3)`,
    [conversationId, text.slice(0, 64 * 1024), providerEventId],
  );

  await bumpOrEnqueueJob({
    barbershopId,
    conversationId,
    fromPhone: canonicalPhone,
    text,
    providerEventId,
    eventLabel: params.eventLabel,
    logPrefix,
  });
}

async function bumpOrEnqueueJob(params: {
  barbershopId: string;
  conversationId: string;
  fromPhone: string;
  text: string;
  providerEventId?: string;
  eventLabel?: string;
  logPrefix: string;
}): Promise<void> {
  const quietSecs = clampInboundQuietSeconds(config.aiInboundQuietSeconds);
  const payloadJson = {
    fromPhone: params.fromPhone,
    text: params.text,
    providerEventId: params.providerEventId,
    event: params.eventLabel,
  };
  const bumped = await pool.query<{ id: string }>(
    `UPDATE public.ai_jobs
     SET run_after = now() + make_interval(secs => $2::int), updated_at = now(), payload_json = $3
     WHERE conversation_id = $1 AND status = 'queued'
     RETURNING id`,
    [params.conversationId, quietSecs, JSON.stringify(payloadJson)],
  );
  if ((bumped.rowCount ?? 0) > 0) {
    console.info(
      "[%s] debounced jobId=%s conversationId=%s barbershopId=%s quietSecs=%s",
      params.logPrefix,
      bumped.rows[0]?.id,
      params.conversationId,
      params.barbershopId,
      quietSecs,
    );
    return;
  }
  const jobInsert = await pool.query<{ id: string }>(
    `INSERT INTO public.ai_jobs (barbershop_id, conversation_id, type, payload_json, status, run_after)
     SELECT $1, $2, 'process_inbound_message', $3, 'queued', now() + make_interval(secs => $4::int)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.ai_jobs
       WHERE conversation_id = $2 AND status = 'queued'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.ai_jobs
       WHERE conversation_id = $2 AND status = 'processing'
         AND locked_at > now() - interval '2 minutes'
     )
     RETURNING id`,
    [params.barbershopId, params.conversationId, JSON.stringify(payloadJson), quietSecs],
  );
  if (jobInsert.rows[0]?.id) {
    console.info(
      "[%s] enqueued jobId=%s conversationId=%s barbershopId=%s quietSecs=%s",
      params.logPrefix,
      jobInsert.rows[0].id,
      params.conversationId,
      params.barbershopId,
      quietSecs,
    );
    return;
  }
  console.info(
    "[%s] inbound absorbed into in-flight turn conversationId=%s barbershopId=%s",
    params.logPrefix,
    params.conversationId,
    params.barbershopId,
  );
}

export { bumpOrEnqueueJob };

export async function applyEditedInboundMessage(params: {
  provider: WhatsAppProviderName;
  barbershopId: string;
  fromPhone: string;
  text: string;
  originalProviderEventId: string;
  providerEventId?: string;
  payload: unknown;
  logPrefix: string;
}): Promise<void> {
  const canonicalPhone = canonicalizeBrPhoneDigits(params.fromPhone) ?? params.fromPhone;
  const conversationId = await findConversation(params.barbershopId, canonicalPhone);
  if (!conversationId) {
    await enqueueInboundMessage({
      provider: params.provider,
      barbershopId: params.barbershopId,
      fromPhone: canonicalPhone,
      text: params.text,
      providerEventId: params.providerEventId || params.originalProviderEventId,
      payload: params.payload,
      eventLabel: "edited",
      logPrefix: params.logPrefix,
    });
    return;
  }
  const updated = await pool.query<{ id: string }>(
    `UPDATE public.ai_messages
     SET content = $1
     WHERE conversation_id = $2 AND role = 'user' AND provider_message_id = $3
     RETURNING id`,
    [params.text.slice(0, 64 * 1024), conversationId, params.originalProviderEventId],
  );
  if ((updated.rowCount ?? 0) === 0) {
    await pool.query(
      `INSERT INTO public.ai_messages (conversation_id, role, content, provider_message_id)
       VALUES ($1, 'user', $2, $3)`,
      [conversationId, params.text.slice(0, 64 * 1024), params.providerEventId || params.originalProviderEventId],
    );
  }
  await bumpOrEnqueueJob({
    barbershopId: params.barbershopId,
    conversationId,
    fromPhone: canonicalPhone,
    text: params.text,
    providerEventId: params.providerEventId,
    eventLabel: "edited",
    logPrefix: params.logPrefix,
  });
}

export async function handleInboundAudio(params: {
  barbershopId: string;
  instanceKey: string;
  fromPhone: string;
  providerEventId: string;
  payload: unknown;
  logPrefix: string;
}): Promise<void> {
  const transcribed = await transcribeInboundAudio({
    instanceName: params.instanceKey,
    providerEventId: params.providerEventId,
  });
  if (!transcribed.ok) {
    console.warn("[%s] audio transcription failed: %s", params.logPrefix, transcribed.error);
    const session = await getWhatsAppOrNull(params.barbershopId);
    if (session) {
      try {
        await session.sendText(params.fromPhone, AUDIO_FAIL_REPLY);
      } catch (e) {
        console.warn("[%s] audio fail reply send failed:", params.logPrefix, e instanceof Error ? e.message : e);
      }
    }
    return;
  }
  await enqueueInboundMessage({
    provider: "evolution",
    barbershopId: params.barbershopId,
    fromPhone: params.fromPhone,
    text: transcribed.text,
    providerEventId: params.providerEventId,
    payload: params.payload,
    eventLabel: "audio_transcript",
    logPrefix: params.logPrefix,
  });
}

export async function handleInboundReceipt(params: {
  barbershopId: string;
  instanceKey: string;
  fromPhone: string;
  providerEventId: string;
  logPrefix: string;
}): Promise<void> {
  const shop = await pool.query<{ name: string; pix_key: string | null }>(
    `SELECT name, pix_key FROM public.barbershops WHERE id = $1`,
    [params.barbershopId],
  );
  const tzRow = await pool.query<{ today_str: string; now_mins: number }>(
    `SELECT
       (NOW() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::date::text AS today_str,
       (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::time) / 60)::int AS now_mins
     FROM (SELECT $1::uuid AS barbershop_id) x
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = x.barbershop_id`,
    [params.barbershopId],
  );
  const todayIso = tzRow.rows[0]?.today_str ?? new Date().toISOString().slice(0, 10);
  const nowMins = Number(tzRow.rows[0]?.now_mins ?? 0);
  const facts = await readReceiptFromMedia({
    instanceName: params.instanceKey,
    providerEventId: params.providerEventId,
  });
  const decision = decideReceiptAcceptance({
    facts,
    shopName: shop.rows[0]?.name ?? "",
    pixKey: shop.rows[0]?.pix_key ?? "",
    todayIso,
    yesterdayIso: addDaysIso(todayIso, -1),
    nowMins: Number.isFinite(nowMins) ? nowMins : 0,
  });
  const session = await getWhatsAppOrNull(params.barbershopId);
  if (!decision.ok) {
    console.warn("[%s] receipt not accepted: %s", params.logPrefix, decision.reason);
    if (session) {
      try {
        await session.sendText(params.fromPhone, RECEIPT_FAIL_REPLY);
      } catch (e) {
        console.warn("[%s] receipt fail reply:", params.logPrefix, e instanceof Error ? e.message : e);
      }
    }
    return;
  }
  const amountBit =
    decision.amount != null && Number.isFinite(decision.amount)
      ? `PIX recebido, R$ ${decision.amount.toFixed(2).replace(".", ",")}`
      : "PIX recebido";
  await recordAgendaChange({
    barbershopId: params.barbershopId,
    appointmentId: null,
    type: "payment_recognized",
    actor: "ai",
    clientPhone: params.fromPhone,
    summary: `${amountBit} (${decision.transferDate})`,
  });
  if (session) {
    try {
      await session.sendText(params.fromPhone, RECEIPT_OK_REPLY);
    } catch (e) {
      console.warn("[%s] receipt ok reply:", params.logPrefix, e instanceof Error ? e.message : e);
    }
  }
}
