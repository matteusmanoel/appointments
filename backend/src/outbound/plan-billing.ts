import { pool, directPool } from "../db.js";
import { setPaymentPending } from "../ai/memory/client-memory.js";
import { barbershopTimezone, checkDispatchGate } from "./dispatch-gate.js";
import {
  PLAN_BILLING_OVERDUE_DAYS,
  planBillingDedupeKey,
  type PlanBillingKind,
  type PlanBillingChargeState,
} from "./dispatch-policy.js";

/** Cobrança de plano (ADR 0003): one charge per due date, sends only through the queue. */

const PLAN_BILLING_CYCLE_SWEEP_ADVISORY_LOCK_ID = 20260406160001;
const MAX_CYCLES_PER_RUN = 24;
const SEND_HOUR_LOCAL = "09:00";

export const AUTO_BILLING_OFF_REASON = "Cobrança automática desligada";
export const CHARGE_PAID_REASON = "Cobrança já paga";
export const SUBSCRIPTION_CANCELLED_REASON = "Assinatura cancelada";

const OPEN_CHARGE_STATUSES = ["pending", "sent"] as const;

/**
 * Creates the charge of every due date reached (shop timezone) and moves next_billing_date one
 * cycle ahead. Generating a charge sends nothing; automatic sends are queued only for subscriptions
 * with auto_billing on.
 */
export async function runPlanBillingCycleSweep(): Promise<void> {
  const due = await pool.query<{ id: string }>(
    `SELECT s.id
     FROM public.client_plan_subscriptions s
     LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = s.barbershop_id
     WHERE s.status = 'active'
       AND s.next_billing_date <= (now() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::date`,
  );
  for (const row of due.rows) {
    try {
      await advanceSubscriptionCycles(row.id);
    } catch (e) {
      console.error("[plan-billing] cycle sub=%s:", row.id, e instanceof Error ? e.message : e);
    }
  }
  await ensureAutoBillingQueued().catch((e) => {
    console.error("[plan-billing] enqueue:", e instanceof Error ? e.message : e);
  });
}

async function advanceSubscriptionCycles(subscriptionId: string): Promise<void> {
  for (let i = 0; i < MAX_CYCLES_PER_RUN; i++) {
    const r = await pool.query<{ advanced: boolean }>(
      `WITH sub AS (
         SELECT s.id, s.barbershop_id, s.next_billing_date, p.price, p.billing_cycle
         FROM public.client_plan_subscriptions s
         JOIN public.barbershop_plans p ON p.id = s.plan_id
         LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = s.barbershop_id
         WHERE s.id = $1 AND s.status = 'active'
           AND s.next_billing_date <= (now() AT TIME ZONE COALESCE(ais.timezone, 'America/Sao_Paulo'))::date
       ),
       charge AS (
         INSERT INTO public.plan_pix_charges (subscription_id, barbershop_id, amount, due_date, status)
         SELECT id, barbershop_id, price, next_billing_date, 'pending' FROM sub WHERE price > 0
         ON CONFLICT (subscription_id, due_date) WHERE status IN ('pending', 'sent', 'paid') DO NOTHING
       )
       UPDATE public.client_plan_subscriptions s
       SET next_billing_date = (sub.next_billing_date + CASE sub.billing_cycle
             WHEN 'quarterly' THEN interval '3 months'
             WHEN 'yearly' THEN interval '1 year'
             ELSE interval '1 month' END)::date,
           updated_at = now()
       FROM sub
       WHERE s.id = sub.id
       RETURNING true AS advanced`,
      [subscriptionId],
    );
    if (!r.rows[0]?.advanced) return;
  }
}

/**
 * Queues the due-date and day +10 sends of open charges for subscriptions with auto_billing on.
 * Only dates from today on; a send the operator cancelled is not queued again, except one that
 * was dropped because the switch was off.
 */
export async function ensureAutoBillingQueued(subscriptionId?: string): Promise<number> {
  const r = await pool.query(
    `WITH open_charges AS (
       SELECT ch.id AS charge_id, ch.subscription_id, ch.barbershop_id, ch.due_date,
              regexp_replace(c.phone, '[^0-9]', '', 'g') AS to_phone,
              COALESCE(ais.timezone, 'America/Sao_Paulo') AS tz
       FROM public.plan_pix_charges ch
       JOIN public.client_plan_subscriptions s ON s.id = ch.subscription_id
       JOIN public.clients c ON c.id = s.client_id
       LEFT JOIN public.barbershop_ai_settings ais ON ais.barbershop_id = ch.barbershop_id
       WHERE s.status = 'active' AND s.auto_billing = true
         AND ch.status = ANY($2::text[])
         AND ($1::uuid IS NULL OR s.id = $1::uuid)
     ),
     planned AS (
       SELECT oc.*, k.kind,
              (oc.due_date + CASE k.kind WHEN 'day10' THEN $3::int ELSE 0 END) AS send_date
       FROM open_charges oc
       CROSS JOIN (VALUES ('due'), ('day10')) AS k(kind)
     )
     INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key)
     SELECT p.barbershop_id, 'plan_billing', p.to_phone,
            jsonb_build_object('charge_id', p.charge_id, 'subscription_id', p.subscription_id, 'kind', p.kind),
            'queued',
            GREATEST((p.send_date + $4::time) AT TIME ZONE p.tz, now()),
            'plan_billing:' || p.charge_id::text || ':' || p.kind
     FROM planned p
     WHERE p.send_date >= (now() AT TIME ZONE p.tz)::date
       AND p.to_phone <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.scheduled_messages m
         WHERE m.dedupe_key = 'plan_billing:' || p.charge_id::text || ':' || p.kind
           AND NOT (m.status = 'skipped' AND m.last_error IS NOT DISTINCT FROM $5)
       )
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'queued' DO NOTHING`,
    [subscriptionId ?? null, [...OPEN_CHARGE_STATUSES], PLAN_BILLING_OVERDUE_DAYS, SEND_HOUR_LOCAL, AUTO_BILLING_OFF_REASON],
  );
  return r.rowCount ?? 0;
}

export async function cancelQueuedPlanBilling(params: {
  barbershopId: string;
  chargeId?: string;
  subscriptionId?: string;
  reason: string;
  automaticOnly?: boolean;
}): Promise<number> {
  if (!params.chargeId && !params.subscriptionId) return 0;
  const r = await pool.query(
    `UPDATE public.scheduled_messages
     SET status = 'skipped', last_error = $4, updated_at = now()
     WHERE barbershop_id = $1 AND type = 'plan_billing' AND status = 'queued'
       AND ($2::text IS NULL OR payload_json->>'charge_id' = $2::text)
       AND ($3::text IS NULL OR payload_json->>'subscription_id' = $3::text)
       AND (NOT $5::boolean OR payload_json->>'kind' IN ('due', 'day10'))`,
    [params.barbershopId, params.chargeId ?? null, params.subscriptionId ?? null, params.reason, params.automaticOnly ?? false],
  );
  return r.rowCount ?? 0;
}

export type PlanBillingCharge = PlanBillingChargeState & {
  id: string;
  subscriptionId: string;
  barbershopId: string;
  amount: number;
  dueDate: string;
  clientName: string | null;
  clientPhone: string;
  planName: string;
  billingDay: number;
};

export async function loadPlanBillingCharge(barbershopId: string, chargeId: string): Promise<PlanBillingCharge | null> {
  const r = await pool.query<{
    id: string;
    subscription_id: string;
    barbershop_id: string;
    amount: string;
    due_date: string;
    status: string;
    subscription_status: string;
    auto_billing: boolean;
    client_name: string | null;
    client_phone: string;
    plan_name: string;
    billing_day: number;
  }>(
    `SELECT ch.id, ch.subscription_id, ch.barbershop_id, ch.amount::text AS amount, ch.due_date::text AS due_date,
            ch.status, s.status AS subscription_status, s.auto_billing, s.billing_day,
            c.name AS client_name, c.phone AS client_phone, p.name AS plan_name
     FROM public.plan_pix_charges ch
     JOIN public.client_plan_subscriptions s ON s.id = ch.subscription_id
     JOIN public.clients c ON c.id = s.client_id
     JOIN public.barbershop_plans p ON p.id = s.plan_id
     WHERE ch.id = $1 AND ch.barbershop_id = $2`,
    [chargeId, barbershopId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    barbershopId: row.barbershop_id,
    amount: Number(row.amount),
    dueDate: row.due_date,
    status: row.status,
    subscriptionStatus: row.subscription_status,
    autoBilling: row.auto_billing,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    planName: row.plan_name,
    billingDay: row.billing_day,
  };
}

export type ManualChargeResult =
  | { kind: "queued"; runAfter: Date; waitUntil: Date | null }
  | { kind: "cap_reached" }
  | { kind: "not_open"; reason: string };

/** Operator's "Enviar cobrança": goes through the same queue and gate as the automatic sends. */
export async function enqueueManualCharge(barbershopId: string, chargeId: string): Promise<ManualChargeResult> {
  const charge = await loadPlanBillingCharge(barbershopId, chargeId);
  if (!charge) return { kind: "not_open", reason: "Cobrança não encontrada." };
  if (charge.status === "paid") return { kind: "not_open", reason: "Esta cobrança já está paga." };
  if (!(OPEN_CHARGE_STATUSES as readonly string[]).includes(charge.status)) {
    return { kind: "not_open", reason: "Esta cobrança foi cancelada." };
  }
  if (charge.subscriptionStatus !== "active") return { kind: "not_open", reason: "A assinatura não está ativa." };
  const toPhone = charge.clientPhone.replace(/\D/g, "");
  if (!toPhone) return { kind: "not_open", reason: "Cliente sem telefone cadastrado." };

  const tz = await barbershopTimezone(barbershopId);
  const gate = await checkDispatchGate(barbershopId, tz);
  if (gate.kind === "cap_reached") return { kind: "cap_reached" };

  const dedupeKey = planBillingDedupeKey(chargeId, "manual");
  await pool.query(
    `INSERT INTO public.scheduled_messages (barbershop_id, type, to_phone, payload_json, status, run_after, dedupe_key)
     VALUES ($1, 'plan_billing', $2, $3::jsonb, 'queued', now(), $4)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'queued' DO NOTHING`,
    [
      barbershopId,
      toPhone,
      JSON.stringify({ charge_id: chargeId, subscription_id: charge.subscriptionId, kind: "manual" satisfies PlanBillingKind }),
      dedupeKey,
    ],
  );
  const queued = await pool.query<{ run_after: Date }>(
    `SELECT run_after FROM public.scheduled_messages WHERE dedupe_key = $1 AND status = 'queued'`,
    [dedupeKey],
  );
  const runAfter = queued.rows[0]?.run_after ? new Date(queued.rows[0].run_after) : new Date();
  return { kind: "queued", runAfter, waitUntil: gate.kind === "wait" ? gate.until : null };
}

export type ReceiptResult = { kind: "paid" } | { kind: "not_open"; reason: string };

/** The month is paid only when the operator records the receipt (cash or PIX he checked). */
export async function recordPlanChargeReceipt(params: {
  barbershopId: string;
  chargeId: string;
  method: "cash" | "pix";
  paidOn?: string;
}): Promise<ReceiptResult> {
  const charge = await loadPlanBillingCharge(params.barbershopId, params.chargeId);
  if (!charge) return { kind: "not_open", reason: "Cobrança não encontrada." };
  if (charge.status === "paid") return { kind: "not_open", reason: "Esta cobrança já está paga." };
  if (!(OPEN_CHARGE_STATUSES as readonly string[]).includes(charge.status)) {
    return { kind: "not_open", reason: "Esta cobrança foi cancelada." };
  }
  const tz = await barbershopTimezone(params.barbershopId);
  const updated = await pool.query(
    `UPDATE public.plan_pix_charges
     SET status = 'paid', paid_method = $3,
         paid_at = CASE WHEN $4::date IS NULL THEN now() ELSE ($4::date + time '12:00') AT TIME ZONE $5 END
     WHERE id = $1 AND barbershop_id = $2 AND status = ANY($6::text[])
     RETURNING id`,
    [params.chargeId, params.barbershopId, params.method, params.paidOn ?? null, tz, [...OPEN_CHARGE_STATUSES]],
  );
  if (!updated.rows[0]) return { kind: "not_open", reason: "Esta cobrança não está mais em aberto." };

  await cancelQueuedPlanBilling({ barbershopId: params.barbershopId, chargeId: params.chargeId, reason: CHARGE_PAID_REASON });

  const stillOverdue = await pool.query(
    `SELECT 1
     FROM public.plan_pix_charges ch
     JOIN public.client_plan_subscriptions s ON s.id = ch.subscription_id
     WHERE s.client_id = (SELECT client_id FROM public.client_plan_subscriptions WHERE id = $1)
       AND ch.status = ANY($2::text[])
       AND ch.due_date <= (now() AT TIME ZONE $3)::date
     LIMIT 1`,
    [charge.subscriptionId, [...OPEN_CHARGE_STATUSES], tz],
  );
  if (stillOverdue.rows.length === 0) {
    void setPaymentPending(params.barbershopId, charge.clientPhone, false, null).catch(() => {});
  }

  const { recordAgendaChange } = await import("../agenda/record-agenda-change.js");
  await recordAgendaChange({
    barbershopId: params.barbershopId,
    appointmentId: null,
    type: "payment_recognized",
    actor: "owner",
    clientName: charge.clientName,
    clientPhone: charge.clientPhone,
    summary: `Recebimento do plano ${charge.planName} lançado (${params.method === "cash" ? "dinheiro" : "PIX conferido"})`,
  });
  return { kind: "paid" };
}

export async function runPlanBillingCycleSweepWithLock(): Promise<void> {
  const client = await directPool.connect(); // lock de sessão: conexão direta (ver db.ts)
  try {
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
      [PLAN_BILLING_CYCLE_SWEEP_ADVISORY_LOCK_ID],
    );
    if (!lockResult.rows[0]?.pg_try_advisory_lock) return;
    await runPlanBillingCycleSweep();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PLAN_BILLING_CYCLE_SWEEP_ADVISORY_LOCK_ID]);
    client.release();
  }
}
