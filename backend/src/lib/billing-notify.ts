import { config } from "../config.js";
import { graceDays } from "../billing-access.js";
import { pool } from "../db.js";
import { sendPaymentFailedEmail } from "./ses.js";

/** Liga o aviso ao dono quando a cobrança falha. PADRÃO DESLIGADO: sem BILLING_NOTIFY_PAYMENT_FAILED=true nada é enviado. */
export function paymentFailedNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BILLING_NOTIFY_PAYMENT_FAILED ?? "").trim().toLowerCase() === "true";
}

export type PaymentFailedSender = (p: { to: string; barbershopName: string; appUrl: string; graceEndsAt: Date }) => Promise<void>;
export type NotifyResult = "disabled" | "duplicate" | "no_recipient" | "sent" | "error";

/**
 * Aviso de falha de pagamento ao dono (e-mail do admin). Atrás de BILLING_NOTIFY_PAYMENT_FAILED (desligado por padrão).
 *
 * DEDUPE SÓ DEPOIS DO ENVIO: o registro em `billing_notice_log` é gravado apenas quando o envio deu certo. Falha do SES,
 * `FROM_EMAIL` ausente (o envio lança) e dono sem e-mail NÃO gravam nada, então o aviso continua pendente e é tentado
 * de novo pelo `retryPaymentFailedNotices` (varredura do worker agendado) enquanto durar a tolerância.
 * Duas execuções concorrentes para a mesma fatura são serializadas por um advisory lock transacional (a segunda
 * devolve "duplicate" sem enviar); a trava dura só o envio.
 * Nunca lança: falha de envio não pode fazer o webhook do Stripe falhar/reentregar.
 */
export async function notifyOwnerPaymentFailed(
  params: { barbershopId: string; invoiceId: string },
  deps: { sender?: PaymentFailedSender; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<NotifyResult> {
  const env = deps.env ?? process.env;
  if (!paymentFailedNotifyEnabled(env)) {
    console.info("[billing-notify] flag BILLING_NOTIFY_PAYMENT_FAILED desligada; aviso de pagamento não enviado barbershop=%s", params.barbershopId);
    return "disabled";
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok", [
      `billing_notice:payment_failed:${params.barbershopId}:${params.invoiceId}`,
    ]);
    if (!lock.rows[0]?.ok) {
      await client.query("ROLLBACK");
      return "duplicate";
    }
    const done = await client.query(
      `SELECT 1 FROM public.billing_notice_log WHERE barbershop_id = $1 AND kind = 'payment_failed' AND ref = $2`,
      [params.barbershopId, params.invoiceId],
    );
    if ((done.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return "duplicate";
    }
    const r = await client.query<{ name: string; email: string | null; changed_at: Date | null }>(
      `SELECT b.name, b.subscription_status_changed_at AS changed_at,
              (SELECT p.email FROM public.profiles p
                WHERE p.barbershop_id = b.id AND p.role = 'admin' AND p.email IS NOT NULL
                ORDER BY p.created_at ASC LIMIT 1) AS email
       FROM public.barbershops b WHERE b.id = $1`,
      [params.barbershopId],
    );
    const row = r.rows[0];
    if (!row?.email) {
      // Nada gravado: se um admin com e-mail aparecer durante a tolerância, a varredura envia.
      await client.query("ROLLBACK");
      console.warn("[billing-notify] sem destinatário (admin com e-mail) barbershop=%s", params.barbershopId);
      return "no_recipient";
    }
    const sender = deps.sender ?? sendPaymentFailedEmail;
    const now = deps.now ?? new Date();
    // Fim da tolerância a partir da mudança de status gravada (mesma conta do evaluateSubscriptionAccess), não de "agora".
    const base = row.changed_at ?? now;
    await sender({
      to: row.email,
      barbershopName: row.name,
      appUrl: config.appUrl,
      graceEndsAt: new Date(base.getTime() + graceDays(env) * 86_400_000),
    });
    await client.query(
      `INSERT INTO public.billing_notice_log (barbershop_id, kind, ref) VALUES ($1, 'payment_failed', $2) ON CONFLICT DO NOTHING`,
      [params.barbershopId, params.invoiceId],
    );
    await client.query("COMMIT");
    return "sent";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.warn("[billing-notify] falha ao avisar o dono (sem registro de envio; será tentado de novo):", e instanceof Error ? e.message : e);
    return "error";
  } finally {
    client.release();
  }
}

let lastRetryMs = 0;
const RETRY_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Reenvio: barbearias em past_due/unpaid/incomplete, ainda dentro da tolerância, sem nenhum aviso `payment_failed`
 * registrado desde a mudança de status (o envio original falhou, faltava FROM_EMAIL ou o dono ainda não tinha e-mail).
 * No máximo uma varredura por 15 min por processo; desligada junto com a flag. Nunca lança.
 */
export async function retryPaymentFailedNotices(
  deps: { sender?: PaymentFailedSender; env?: Record<string, string | undefined>; nowMs?: number } = {},
): Promise<{ attempted: number; sent: number }> {
  const env = deps.env ?? process.env;
  if (!paymentFailedNotifyEnabled(env)) return { attempted: 0, sent: 0 };
  const nowMs = deps.nowMs ?? Date.now();
  if (nowMs - lastRetryMs < RETRY_INTERVAL_MS) return { attempted: 0, sent: 0 };
  lastRetryMs = nowMs;
  try {
    const pending = await pool.query<{ id: string; changed_at: Date }>(
      `SELECT b.id, b.subscription_status_changed_at AS changed_at
         FROM public.barbershops b
        WHERE b.stripe_subscription_id IS NOT NULL
          AND b.subscription_status IN ('past_due', 'unpaid', 'incomplete')
          AND b.subscription_status_changed_at IS NOT NULL
          AND b.subscription_status_changed_at > now() - make_interval(days => $1::int)
          AND NOT EXISTS (
            SELECT 1 FROM public.billing_notice_log l
             WHERE l.barbershop_id = b.id AND l.kind = 'payment_failed' AND l.created_at >= b.subscription_status_changed_at
          )
        LIMIT 50`,
      [graceDays(env)],
    );
    let sent = 0;
    for (const row of pending.rows) {
      const res = await notifyOwnerPaymentFailed(
        { barbershopId: row.id, invoiceId: `episode:${row.changed_at.getTime()}` },
        { sender: deps.sender, env },
      );
      if (res === "sent") sent++;
    }
    return { attempted: pending.rows.length, sent };
  } catch (e) {
    console.error("[billing-notify] varredura de reenvio falhou:", e instanceof Error ? e.message : e);
    return { attempted: 0, sent: 0 };
  }
}

/** Só para testes. */
export function resetPaymentFailedRetryThrottleForTests(): void {
  lastRetryMs = 0;
}
