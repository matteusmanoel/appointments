import { config } from "../config.js";
import { graceDays } from "../billing-access.js";
import { pool } from "../db.js";
import { sendPaymentFailedEmail } from "./ses.js";

/** Liga o aviso ao dono quando a cobrança falha. PADRÃO DESLIGADO: sem BILLING_NOTIFY_PAYMENT_FAILED=true nada é enviado. */
export function paymentFailedNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BILLING_NOTIFY_PAYMENT_FAILED ?? "").trim().toLowerCase() === "true";
}

export type PaymentFailedSender = (p: { to: string; barbershopName: string; appUrl: string; graceEndsAt: Date }) => Promise<void>;

/**
 * Prepara (e, com a flag ligada, dispara) o aviso de falha de pagamento ao dono (e-mail do admin).
 * - Flag desligada: só loga; não consulta destinatário nem envia.
 * - Dedupe por fatura: `billing_notice_log (barbershop_id, kind, ref)` único → retries do Stripe (invoice.payment_failed
 *   repetido, com event.id diferente) não geram e-mails repetidos.
 * - Nunca lança: falha de envio não pode fazer o webhook do Stripe falhar/reentregar.
 * Retorna "disabled" | "duplicate" | "no_recipient" | "sent" | "error".
 */
export async function notifyOwnerPaymentFailed(
  params: { barbershopId: string; invoiceId: string },
  deps: { sender?: PaymentFailedSender; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<"disabled" | "duplicate" | "no_recipient" | "sent" | "error"> {
  const env = deps.env ?? process.env;
  if (!paymentFailedNotifyEnabled(env)) {
    console.info("[billing-notify] flag BILLING_NOTIFY_PAYMENT_FAILED desligada; aviso de pagamento não enviado barbershop=%s", params.barbershopId);
    return "disabled";
  }
  try {
    const claim = await pool.query(
      `INSERT INTO public.billing_notice_log (barbershop_id, kind, ref) VALUES ($1, 'payment_failed', $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [params.barbershopId, params.invoiceId],
    );
    if ((claim.rowCount ?? 0) === 0) return "duplicate";
    const r = await pool.query<{ name: string; email: string | null }>(
      `SELECT b.name,
              (SELECT p.email FROM public.profiles p
                WHERE p.barbershop_id = b.id AND p.role = 'admin' AND p.email IS NOT NULL
                ORDER BY p.created_at ASC LIMIT 1) AS email
       FROM public.barbershops b WHERE b.id = $1`,
      [params.barbershopId],
    );
    const row = r.rows[0];
    if (!row?.email) return "no_recipient";
    const sender = deps.sender ?? sendPaymentFailedEmail;
    const now = deps.now ?? new Date();
    await sender({
      to: row.email,
      barbershopName: row.name,
      appUrl: config.appUrl,
      graceEndsAt: new Date(now.getTime() + graceDays(env) * 86_400_000),
    });
    return "sent";
  } catch (e) {
    console.warn("[billing-notify] falha ao avisar o dono:", e instanceof Error ? e.message : e);
    return "error";
  }
}
