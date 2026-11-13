import "../load-env.js";
import { getSubscriptionAccess } from "../billing-access.js";
import { pool } from "../db.js";
import { retryPaymentFailedNotices } from "../lib/billing-notify.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";
import { recordAgendaChange } from "../agenda/record-agenda-change.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";
import { classifySendError } from "../integrations/whatsapp/send-error-policy.js";
import { buildPlanPaymentMessage, resolveReminderSendBody } from "../outbound/templates.js";
import {
  appendReminderTranscript,
  loadReminderAppointment,
  runNoShowSweepWithLock,
} from "../outbound/scheduled-messages.js";
import {
  DAILY_CAP_REACHED_MESSAGE,
  DISPATCH_PRIORITY,
  PLAN_BILLING_OVERDUE_DAYS,
  REMINDER_2H_MIN_LEAD_MINUTES,
  isRetiredAutomaticType,
  planBillingNotVigenteReason,
  reminderNotVigenteReason,
  scheduledTypePurpose,
} from "../outbound/dispatch-policy.js";
import { checkDispatchGate, withDispatchLock } from "../outbound/dispatch-gate.js";
import { loadPlanBillingCharge, runPlanBillingCycleSweepWithLock } from "../outbound/plan-billing.js";
import { reactivationMessage } from "../outbound/reactivation.js";
import { setPaymentPendingFlag } from "../ai/memory/client-memory.js";
import { config } from "../config.js";

const POLL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = 15;
const SEND_WINDOW_START = parseInt(process.env.SCHEDULED_SEND_WINDOW_START ?? "9", 10);
const SEND_WINDOW_END = parseInt(process.env.SCHEDULED_SEND_WINDOW_END ?? "20", 10);

function getBarbershopTimezone(rows: { timezone?: string }[]): string {
  return rows[0]?.timezone ?? "America/Sao_Paulo";
}

function getHourInTimezone(tz: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch {
    return 12;
  }
}

function todayIsoInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function nextWindowStart(tz: string): Promise<Date> {
  const hour = getHourInTimezone(tz);
  const dayOffset = hour < SEND_WINDOW_START ? 0 : 1;
  const r = await pool.query<{ run_after: Date }>(
    `SELECT (
      make_timestamptz(
        EXTRACT(year FROM ((now() AT TIME ZONE $1) + ($2::int * interval '1 day')))::int,
        EXTRACT(month FROM ((now() AT TIME ZONE $1) + ($2::int * interval '1 day')))::int,
        EXTRACT(day FROM ((now() AT TIME ZONE $1) + ($2::int * interval '1 day')))::int,
        $3::int, 0, 0, $1
      )
    ) AS run_after`,
    [tz, dayOffset, SEND_WINDOW_START]
  );
  return r.rows[0]?.run_after ?? new Date(Date.now() + 60 * 60 * 1000);
}

type ScheduledJob = {
  id: string;
  barbershop_id: string;
  type: string;
  to_phone: string;
  payload_json: unknown;
  attempts: number;
  dedupe_key: string | null;
};

async function fetchNextJobs(): Promise<ScheduledJob[]> {
  const r = await pool.query<ScheduledJob>(
    `UPDATE public.scheduled_messages
     SET attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM public.scheduled_messages
       WHERE status = 'queued' AND run_after <= now()
       ORDER BY CASE
                  WHEN type IN ('reminder_24h', 'reminder_2h') THEN 0
                  WHEN type = 'plan_billing'                   THEN 1
                  WHEN type = 'reactivation'                   THEN 2
                  WHEN type = 'manual'                         THEN 3
                  WHEN type = 'campaign'                       THEN 4
                  ELSE 5
                END, run_after ASC
       LIMIT 5
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, barbershop_id, type, to_phone, payload_json, attempts, dedupe_key`
  );
  return [...r.rows].sort((a, b) => jobPriority(a.type) - jobPriority(b.type));
}

function jobPriority(type: string): number {
  const purpose = scheduledTypePurpose(type);
  return purpose ? DISPATCH_PRIORITY[purpose] : Number.MAX_SAFE_INTEGER;
}

async function markSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'sent', last_error = NULL, updated_at = now() WHERE id = $1`,
    [id]
  );
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'skipped', last_error = $1, updated_at = now() WHERE id = $2`,
    [reason.slice(0, 512), id]
  );
}

async function markFailed(id: string, errorMessage: string, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE public.scheduled_messages SET status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`,
      [errorMessage.slice(0, 1024), id]
    );
  } else {
    const runAfter = new Date(Date.now() + BACKOFF_MINUTES * 60 * 1000 * Math.pow(2, attempts - 1));
    await pool.query(
      `UPDATE public.scheduled_messages SET status = 'queued', last_error = $1, run_after = $2, updated_at = now() WHERE id = $3`,
      [errorMessage.slice(0, 1024), runAfter, id]
    );
  }
}

/** Waiting for the dispatch spacing is not a failed attempt. */
async function deferForSpacing(id: string, runAfter: Date): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages
     SET status = 'queued', run_after = $1, attempts = GREATEST(attempts - 1, 0), updated_at = now()
     WHERE id = $2`,
    [runAfter, id]
  );
}

async function postponeToWindow(id: string, runAfter: Date): Promise<void> {
  await pool.query(
    `UPDATE public.scheduled_messages SET status = 'queued', run_after = $1, last_error = NULL, updated_at = now() WHERE id = $2`,
    [runAfter, id]
  );
}

function isReminderType(type: string): boolean {
  return type === "reminder_24h" || type === "reminder_2h";
}

/** Returns true if the appointment is at least `minMinutes` in the future (barbershop timezone). */
async function hasMinLeadTime(date: string, time: string, tz: string, minMinutes: number): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(
    `SELECT (($1::date + $2::time) AT TIME ZONE $3 - now()) >= ($4 || ' minutes')::interval AS ok`,
    [date, time, tz, minMinutes],
  );
  return r.rows[0]?.ok ?? false;
}

async function isOptedOut(barbershopId: string, phone: string): Promise<boolean> {
  const normalized = phone.replace(/\D/g, "");
  if (!normalized) return false;
  const r = await pool.query(
    `SELECT 1 FROM public.clients
     WHERE barbershop_id = $1 AND marketing_opt_out = true
       AND regexp_replace(phone, '[^0-9]', '', 'g') = $2`,
    [barbershopId, normalized]
  );
  return r.rows.length > 0;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const to = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((to - from) / 86_400_000);
}

/** Cobrança de plano: open month, same gate as reminders, text + PIX, no location pin. */
async function processPlanBilling(job: {
  id: string;
  barbershopId: string;
  to_phone: string;
  payload: Record<string, unknown>;
  tz: string;
}): Promise<void> {
  const { id, barbershopId, to_phone, payload, tz } = job;
  const chargeId = typeof payload.charge_id === "string" ? payload.charge_id : null;
  const charge = chargeId ? await loadPlanBillingCharge(barbershopId, chargeId) : null;
  const notVigente = planBillingNotVigenteReason({ kind: payload.kind, charge });
  if (notVigente || !charge) {
    await markSkipped(id, notVigente ?? "Cobrança não existe mais");
    return;
  }

  const shop = await pool.query<{ pix_key: string | null; name: string; address: string | null }>(
    `SELECT pix_key, name, address FROM public.barbershops WHERE id = $1`,
    [barbershopId],
  );
  const pixKey = shop.rows[0]?.pix_key?.trim() || null;
  if (!pixKey) {
    await markSkipped(id, "Chave PIX não configurada");
    await recordOperationalActivity({
      barbershopId,
      type: "payment_failed",
      clientName: charge.clientName,
      clientPhone: to_phone,
      summary: `Cobrança do plano ${charge.planName} não enviada — chave PIX não configurada`,
      dedupeMinutes: 24 * 60,
    });
    return;
  }

  const gate = await checkDispatchGate(barbershopId, tz);
  if (gate.kind === "wait") {
    await deferForSpacing(id, gate.until);
    return;
  }
  if (gate.kind === "cap_reached") {
    await markSkipped(id, DAILY_CAP_REACHED_MESSAGE);
    await recordOperationalActivity({
      barbershopId,
      type: "send_failure",
      clientName: charge.clientName,
      clientPhone: to_phone,
      summary: `Cobrança do plano ${charge.planName} não enviada — ${DAILY_CAP_REACHED_MESSAGE}`,
      dedupeMinutes: 24 * 60,
    });
    return;
  }

  const session = await getWhatsAppOrNull(barbershopId);
  if (!session) {
    await markSkipped(id, "WhatsApp não conectado");
    await recordOperationalActivity({
      barbershopId,
      type: "payment_failed",
      clientName: charge.clientName,
      clientPhone: to_phone,
      summary: `Cobrança do plano ${charge.planName} não enviada — WhatsApp desconectado`,
      dedupeMinutes: 24 * 60,
    });
    return;
  }

  const overdueDays =
    payload.kind === "day10"
      ? PLAN_BILLING_OVERDUE_DAYS
      : Math.max(0, daysBetweenIso(charge.dueDate, todayIsoInTimezone(tz)));
  const chargeBody = buildPlanPaymentMessage({
    clientName: charge.clientName ?? undefined,
    planName: charge.planName,
    amount: charge.amount,
    dueDate: charge.dueDate,
    billingDay: charge.billingDay,
    overdueDays: overdueDays > 0 ? overdueDays : undefined,
  });
  await session.sendText(to_phone, chargeBody);
  await appendReminderTranscript({ barbershopId, phone: to_phone, body: chargeBody }).catch((err) => {
    console.warn(
      "[scheduled-messages-worker] plan charge transcript failed:",
      err instanceof Error ? err.message : err,
    );
  });
  const city = (shop.rows[0]?.address ?? "").split(",").pop()?.trim() || "Brasil";
  try {
    await session.sendPixRequest?.({
      to: to_phone,
      amount: charge.amount,
      description: `Plano ${charge.planName} — NavalhIA`,
      pixKey,
      name: shop.rows[0]?.name ?? "Barbearia",
      city,
    });
  } catch (e) {
    console.warn("[scheduled-messages-worker] plan pix card failed id=%s: %s", id, e instanceof Error ? e.message : e);
  }

  await markSent(id);
  await pool.query(
    `UPDATE public.plan_pix_charges SET status = 'sent', sent_at = now()
     WHERE id = $1 AND status IN ('pending', 'sent')`,
    [charge.id],
  );
  void setPaymentPendingFlag(barbershopId, charge.clientPhone, charge.amount).catch(() => {});
  await recordOperationalActivity({
    barbershopId,
    type: "payment_sent",
    clientName: charge.clientName,
    clientPhone: to_phone,
    summary: `Cobrança do plano ${charge.planName} enviada (R$ ${charge.amount.toFixed(2).replace(".", ",")})`,
    dedupeMinutes: 60,
  });
  console.info("[scheduled-messages-worker] sent id=%s barbershopId=%s type=plan_billing", id, barbershopId);
}

async function processReactivation(job: {
  id: string;
  barbershopId: string;
  to_phone: string;
  payload: Record<string, unknown>;
  tz: string;
}): Promise<void> {
  const { id, barbershopId, to_phone, payload, tz } = job;
  const clientId = typeof payload.client_id === "string" ? payload.client_id : null;
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const bodyOverride = typeof payload.body_override === "string" ? payload.body_override : null;
  if (!clientId) {
    await markSkipped(id, "Reativação sem cliente");
    return;
  }
  const client = await pool.query<{ name: string | null; marketing_opt_out: boolean }>(
    `SELECT name, marketing_opt_out FROM public.clients WHERE id = $1 AND barbershop_id = $2`,
    [clientId, barbershopId],
  );
  const row = client.rows[0];
  if (!row) {
    await markSkipped(id, "Reativação sem cliente");
    return;
  }
  if (row.marketing_opt_out) {
    await markSkipped(id, "Cliente opt-out");
    return;
  }

  const gate = await checkDispatchGate(barbershopId, tz);
  if (gate.kind === "wait") {
    await deferForSpacing(id, gate.until);
    return;
  }
  if (gate.kind === "cap_reached") {
    await markSkipped(id, DAILY_CAP_REACHED_MESSAGE);
    await recordOperationalActivity({
      barbershopId,
      type: "send_failure",
      clientName: row.name,
      clientPhone: to_phone,
      summary: `Reativação não enviada — ${DAILY_CAP_REACHED_MESSAGE}`,
      dedupeMinutes: 24 * 60,
    });
    return;
  }

  const session = await getWhatsAppOrNull(barbershopId);
  if (!session) {
    await markSkipped(id, "WhatsApp não conectado");
    return;
  }

  const shop = await pool.query<{ slug: string | null }>(
    `SELECT slug FROM public.barbershops WHERE id = $1`,
    [barbershopId],
  );
  const slug = shop.rows[0]?.slug?.trim();
  const base = config.appUrl.replace(/\/$/, "");
  const bookingLink = slug ? `${base}/b/${slug}` : base;
  await session.sendText(to_phone, reactivationMessage({ reason, clientName: row.name, bookingLink, bodyOverride }));
  await markSent(id);
  console.info("[scheduled-messages-worker] sent id=%s barbershopId=%s type=reactivation", id, barbershopId);
}

async function processOne(): Promise<boolean> {
  const jobs = await fetchNextJobs();
  if (jobs.length === 0) return false;

  for (const row of jobs) {
    const { id, barbershop_id: barbershopId, type, to_phone, payload_json, attempts, dedupe_key } = row;
    const payload = (payload_json ?? {}) as Record<string, unknown>;
    const body = typeof payload.body === "string" ? payload.body : "";
    let delivered = false;

    if (isRetiredAutomaticType(type)) {
      await markSkipped(id, "Disparo automático desativado — vira sugestão para o operador");
      continue;
    }

    try {
      // Assinatura inativa pausa TODO envio automático (inclui cobrança de planos e reativação, que têm gate próprio).
      const subscription = await getSubscriptionAccess(barbershopId);
      if (!subscription.allowed) {
        await markSkipped(id, "Assinatura inativa: envio automático pausado");
        continue;
      }

      const tzRows = await pool.query<{ timezone: string }>(
        `SELECT timezone FROM public.barbershop_ai_settings WHERE barbershop_id = $1`,
        [barbershopId]
      );
      const tz = getBarbershopTimezone(tzRows.rows);

      const hour = getHourInTimezone(tz);
      if (hour < SEND_WINDOW_START || hour >= SEND_WINDOW_END) {
        await postponeToWindow(id, await nextWindowStart(tz));
        continue;
      }

      // plan_billing handles its own gate check (no marketing opt-out, PIX send path).
      if (type === "plan_billing") {
        await withDispatchLock(barbershopId, () =>
          processPlanBilling({ id, barbershopId, to_phone, payload, tz }),
        );
        continue;
      }

      // reactivation handles its own opt-out check (marketing_opt_out) and gate check.
      if (type === "reactivation") {
        await withDispatchLock(barbershopId, () =>
          processReactivation({ id, barbershopId, to_phone, payload, tz }),
        );
        continue;
      }

      // --- Reminders, manual messages, campaigns ---
      const appointmentId = typeof payload.appointment_id === "string" ? payload.appointment_id : null;
      let sendBody = body;
      let reminderClientName: string | null = null;
      const appt = appointmentId ? await loadReminderAppointment(appointmentId) : null;

      if (isReminderType(type)) {
        const notVigente = reminderNotVigenteReason({
          type,
          appointmentId,
          dedupeKey: dedupe_key,
          payload,
          appointment: appt,
        });
        if (notVigente) {
          await markSkipped(id, notVigente);
          continue;
        }
      }

      if (appointmentId) {
        if (appt?.status === "cancelled") {
          await markSkipped(id, "Agendamento cancelado");
          continue;
        }
        if (appt) reminderClientName = appt.clientName ?? null;
        if (appt && (type === "reminder_24h" || type === "reminder_2h")) {
          sendBody =
            resolveReminderSendBody({
              type,
              storedBody: body,
              todayIso: todayIsoInTimezone(tz),
              appointment: {
                ...appt,
                serviceNames:
                  appt.serviceNames ??
                  (typeof payload.service_names === "string" ? payload.service_names : undefined),
              },
            }) ?? "";
        }
      }

      // Lembrete 2h whose natural time fell before the send window is postponed to window open.
      // At window open, only send if at least 20 minutes remain before the appointment.
      if (type === "reminder_2h" && appt) {
        const ok = await hasMinLeadTime(appt.date, appt.time, tz, REMINDER_2H_MIN_LEAD_MINUTES);
        if (!ok) {
          await markSkipped(
            id,
            `Lembrete 2h: menos de ${REMINDER_2H_MIN_LEAD_MINUTES} minutos para o horário, não enviado`,
          );
          continue;
        }
      }

      if (!sendBody) {
        await markSkipped(id, "Mensagem vazia");
        continue;
      }

      // Gate check (cap + spacing) + send inside per-barbershop advisory lock.
      // Only gated types reach here; unknown/future types fall through to ungated path.
      if (scheduledTypePurpose(type)) {
        const state = { sent: false };
        await withDispatchLock(barbershopId, async () => {
          const gate = await checkDispatchGate(barbershopId, tz);
          if (gate.kind === "wait") {
            await deferForSpacing(id, gate.until);
            return;
          }
          if (gate.kind === "cap_reached") {
            await markSkipped(id, DAILY_CAP_REACHED_MESSAGE);
            await recordOperationalActivity({
              barbershopId,
              type: "send_failure",
              appointmentId,
              clientPhone: to_phone,
              clientName: reminderClientName,
              summary: `Disparo não enviado — ${DAILY_CAP_REACHED_MESSAGE}`,
              dedupeMinutes: 24 * 60,
            });
            return;
          }

          const session = await getWhatsAppOrNull(barbershopId);
          if (!session) {
            await markSkipped(id, "WhatsApp não conectado");
            if (isReminderType(type)) {
              await recordOperationalActivity({
                barbershopId,
                type: "send_failure",
                appointmentId,
                clientPhone: to_phone,
                clientName: reminderClientName,
                summary: "Lembrete não entregue — WhatsApp desconectado",
                dedupeMinutes: 24 * 60,
              });
            }
            return;
          }

          await session.sendText(to_phone, sendBody);
          state.sent = true;

          if (isReminderType(type)) {
            await appendReminderTranscript({ barbershopId, phone: to_phone, body: sendBody }).catch((err) => {
              console.warn("[scheduled-messages-worker] reminder transcript failed:", err instanceof Error ? err.message : err);
            });
          }

          const locRow = await pool.query<{
            name: string;
            address: string | null;
            latitude: number | null;
            longitude: number | null;
          }>(
            `SELECT name, address, latitude, longitude FROM public.barbershops WHERE id = $1`,
            [barbershopId],
          );
          const lr = locRow.rows[0];
          if (
            isReminderType(type) &&
            lr &&
            lr.latitude != null &&
            lr.longitude != null &&
            (lr.address?.trim() || lr.name)
          ) {
            try {
              await session.sendLocation(to_phone, {
                name: (lr.name ?? "Barbearia").trim() || "Barbearia",
                address: (lr.address ?? lr.name ?? "").trim() || "Barbearia",
                lat: lr.latitude,
                lng: lr.longitude,
              });
            } catch (locErr) {
              console.warn(
                "[scheduled-messages-worker] sendLocation failed id=%s: %s",
                id,
                locErr instanceof Error ? locErr.message : String(locErr),
              );
            }
          }

          await markSent(id);
          if (isReminderType(type)) {
            await recordAgendaChange({
              barbershopId,
              appointmentId,
              type: "reminder_sent",
              actor: "system",
              clientPhone: to_phone,
              clientName: reminderClientName,
              summary: type,
            }).catch(() => {});
          }
          console.info("[scheduled-messages-worker] sent id=%s barbershopId=%s type=%s", id, barbershopId, type);
        });
        delivered = state.sent;
        continue;
      }

      // Fallthrough for future ungated types.
      const session = await getWhatsAppOrNull(barbershopId);
      if (!session) {
        await markSkipped(id, "WhatsApp não conectado");
        continue;
      }
      await session.sendText(to_phone, sendBody);
      delivered = true;
      await markSent(id);
      if (type === "reminder_24h" || type === "reminder_2h") {
        const appointmentId = typeof payload.appointment_id === "string" ? payload.appointment_id : null;
        await recordAgendaChange({
          barbershopId,
          appointmentId,
          type: "reminder_sent",
          actor: "system",
          clientPhone: to_phone,
          clientName: reminderClientName,
          summary: type,
        }).catch(() => {});
      }
      console.info("[scheduled-messages-worker] sent id=%s barbershopId=%s type=%s", id, barbershopId, type);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("[scheduled-messages-worker] error id=%s:", id, errMsg);
      const retryable = classifySendError(errMsg) === "transient";
      await markFailed(id, errMsg, retryable ? attempts : MAX_ATTEMPTS);
      if (!delivered && isReminderType(type) && (!retryable || attempts >= MAX_ATTEMPTS)) {
        await recordOperationalActivity({
          barbershopId,
          type: "send_failure",
          appointmentId: typeof payload.appointment_id === "string" ? payload.appointment_id : null,
          clientPhone: to_phone,
          summary: "Lembrete não entregue — falha no envio pelo WhatsApp",
          dedupeMinutes: 24 * 60,
        });
      }
      if (type === "plan_billing" && (!retryable || attempts >= MAX_ATTEMPTS)) {
        await recordOperationalActivity({
          barbershopId,
          type: "payment_failed",
          clientPhone: to_phone,
          summary: "Cobrança do plano não entregue — falha no envio pelo WhatsApp",
          dedupeMinutes: 24 * 60,
        });
      }
    }
  }
  return true;
}

/**
 * Only sweeps that do not message a client on their own (ADR 0003).
 * Follow-up e aniversário viram sugestão; resumo de abertura e aviso de assinatura estão fora
 * do produto por enquanto. O ciclo de cobrança só gera o mês e enfileira quem tem o automático.
 */
async function runDailySweeps(): Promise<void> {
  await Promise.all([
    // runDailyFollowUp30dSweepWithLock().catch((e) => console.error("[scheduled-messages-worker] daily followup_30d sweep:", e)),
    // runDailyFollowUpNoAppointmentSweepWithLock().catch((e) => console.error("[scheduled-messages-worker] daily followup_no_appointment sweep:", e)),
    // runBirthdaySweepWithLock().catch((e) => console.error("[scheduled-messages-worker] daily birthday sweep:", e)),
    // runDailyOpeningSummarySweepWithLock().catch((e) => console.error("[scheduled-messages-worker] daily opening_summary sweep:", e)),
    runPlanBillingCycleSweepWithLock().catch((e) => console.error("[scheduled-messages-worker] plan billing cycle sweep:", e)),
    runNoShowSweepWithLock().catch((e) => console.error("[scheduled-messages-worker] no-show sweep:", e)),
    // Reenvio do aviso de pagamento falho ao dono (só com BILLING_NOTIFY_PAYMENT_FAILED=true; no máx. 1x/15 min por processo).
    retryPaymentFailedNotices().catch((e) => console.error("[scheduled-messages-worker] payment_failed notice retry:", e)),
  ]);
}

/** Run one cycle: daily sweep once, then process batches up to maxBatches. Used by Lambda and by runLoop. */
export async function runScheduledMessagesCycle(options?: { maxBatches?: number }): Promise<{ processed: number }> {
  const maxBatches = options?.maxBatches ?? 20;
  await runDailySweeps();
  let processed = 0;
  while (processed < maxBatches) {
    try {
      const did = await processOne();
      if (!did) break;
      processed++;
    } catch (e) {
      console.error("[scheduled-messages-worker] cycle error:", e);
      break;
    }
  }
  return { processed };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runLoop(): Promise<void> {
  console.info("[scheduled-messages-worker] started");
  setTimeout(() => {
    void runDailySweeps();
  }, 60_000);
  setInterval(() => {
    void runDailySweeps();
  }, ONE_DAY_MS);
  while (true) {
    const { processed } = await runScheduledMessagesCycle({ maxBatches: 20 });
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  runLoop().catch((e) => {
    console.error("[scheduled-messages-worker] fatal:", e);
    process.exit(1);
  });
}
