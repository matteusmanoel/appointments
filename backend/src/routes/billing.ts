import { Request, Response, Router } from "express";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { config } from "../config.js";
import { notifyOwnerPaymentFailed } from "../lib/billing-notify.js";
import { sendOnboardingEmail } from "../lib/ses.js";
import { requireJwt, getBarbershopId, type JwtPayload } from "../middleware/auth.js";
import { ADMIN_ONLY, requireRole } from "../middleware/rbac.js";
import { schedulePaymentReminder } from "../outbound/scheduled-messages.js";
import { checkoutAttribution, marketingConsentMetadata } from "../lib/checkout-attribution.js";

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey, { apiVersion: "2025-02-24.acacia" }) : null;

/** Cancel a Stripe subscription by ID. No-op if stripe not configured or id empty. */
export async function cancelStripeSubscription(subscriptionId: string | null): Promise<void> {
  if (!stripe || !subscriptionId?.trim()) return;
  await stripe.subscriptions.cancel(subscriptionId).catch((e) => {
    console.warn("Stripe subscription cancel warning:", e);
  });
}

/** Janela (s) em que o session_id do checkout ainda pode ser trocado por acesso. */
const SESSION_EXCHANGE_MAX_AGE_SEC = 24 * 3600;

const planSchema = z.enum(["essential", "pro", "premium"]);

function getPriceIdForPlan(plan: "essential" | "pro" | "premium"): string | null {
  if (plan === "essential" && config.stripePriceIdEssential) return config.stripePriceIdEssential;
  if (plan === "pro" && config.stripePriceIdPro) return config.stripePriceIdPro;
  if (plan === "premium" && config.stripePriceIdPremium) return config.stripePriceIdPremium;
  return config.stripePriceId || null;
}

function slugify(value: string): string {
  const base = (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length >= 2 ? base : "minha-navalhia";
}

async function chooseUniqueSlug(client: import("pg").PoolClient, base: string): Promise<string> {
  const cleaned = slugify(base);
  for (let attempt = 0; attempt < 12; attempt++) {
    const suffix = attempt === 0 ? "" : `-${Math.random().toString(36).slice(2, 8)}`;
    const candidate = `${cleaned}${suffix}`;
    const exists = await client.query("SELECT 1 FROM public.barbershops WHERE slug = $1 LIMIT 1", [candidate]);
    if (exists.rows.length === 0) return candidate;
  }
  return `${cleaned}-${crypto.randomUUID().slice(0, 8)}`;
}

const extraNumbersSchema = z.number().int().min(0).max(20).optional().default(0);

const checkoutBody = z.object({
  barbershop_name: z.string().min(1, "Nome da NavalhIA é obrigatório"),
  cnpj: z.string().optional(),
  phone: z.string().min(1, "Telefone é obrigatório"),
  email: z.string().email("E-mail inválido"),
  contact_name: z.string().optional(),
  plan: planSchema.optional(),
  extra_numbers: extraNumbersSchema,
  /** Aceite do aviso de risco do WhatsApp (QR/API não oficial), marcado antes de pagar (lp-correcoes §16.2/§16.5, B-05). */
  whatsapp_risk_accepted: z.boolean().optional(),
  whatsapp_risk_notice_version: z.string().max(40).optional(),
  /** First/last-touch UTMs e click ids (whitelist no attributionMetadata). Só vale com marketing_consent: true. */
  attribution: z.unknown().optional(),
  /** Escolha de consentimento de marketing do visitante (banner), a versão do texto e a data (ISO) do registro. */
  marketing_consent: z.boolean().optional(),
  marketing_consent_notice_version: z.string().max(40).optional(),
  marketing_consent_at: z.string().max(40).optional(),
});

/** Versão do texto do aviso mostrada no checkout (a UI envia a que exibiu; fica gravada na sessão do Stripe). */
export const WHATSAPP_RISK_NOTICE_VERSION = "2026-11-13b";

/**
 * O aceite é obrigatório no servidor (não só na UI). CHECKOUT_REQUIRE_RISK_ACCEPTANCE=false desliga a exigência
 * temporariamente (ex.: durante a troca de versão entre front e API). Ordem segura de deploy: front primeiro, API depois.
 */
export function riskAcceptanceRequired(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CHECKOUT_REQUIRE_RISK_ACCEPTANCE ?? "true").trim().toLowerCase() !== "false";
}

/** Metadados do aceite gravados na sessão do Stripe (prova do consentimento: quando e qual texto). */
export function riskAcceptanceMetadata(
  body: { whatsapp_risk_accepted?: boolean; whatsapp_risk_notice_version?: string },
  now: Date = new Date(),
): Record<string, string> {
  if (body.whatsapp_risk_accepted !== true) return {};
  return {
    whatsapp_risk_accepted_at: now.toISOString(),
    whatsapp_risk_notice_version: body.whatsapp_risk_notice_version?.trim() || WHATSAPP_RISK_NOTICE_VERSION,
  };
}

function checkoutSessionAttribution(body: Parameters<typeof checkoutAttribution>[0]): Record<string, string> {
  return checkoutAttribution(body);
}

const RISK_NOT_ACCEPTED_BODY = {
  error: "Para continuar, aceite o aviso sobre o uso do WhatsApp.",
  code: "whatsapp_risk_not_accepted",
};

const checkoutEmbeddedBody = checkoutBody.extend({
  plan: planSchema.default("pro"),
});

export function stripeWebhookHandler(req: Request, res: Response): void {
  const sig = req.headers["stripe-signature"] as string | undefined;
  const body = req.body as Buffer | undefined;
  if (!body || !Buffer.isBuffer(body)) {
    res.status(400).send("Missing or invalid body");
    return;
  }
  if (!config.stripeWebhookSecret) {
    res.status(503).send("Webhook not configured");
    return;
  }
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(body, sig!, config.stripeWebhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).send(`Webhook signature verification failed: ${message}`);
    return;
  }
  void processStripeEventOnce(event).then((result) => {
    if (result === "in_progress") {
      // Outra entrega do mesmo evento está processando agora: 409 faz o Stripe reenviar depois (e aí cai em "duplicate").
      res.status(409).send("Event is being processed");
      return;
    }
    res.status(200).send();
  }).catch((e) => {
    console.error("Stripe webhook handler error:", e);
    res.status(500).send("Internal error");
  });
}

/** Quanto tempo (s) uma reivindicação sem `processed_at` segura o evento (cobre Lambda que caiu no meio). */
export const STRIPE_EVENT_CLAIM_LEASE_SEC = 300;

export type StripeEventOutcome = "processed" | "duplicate" | "in_progress";

/**
 * Idempotência atômica por event.id.
 * - A reivindicação é UM comando (`INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING`): só uma entrega concorrente
 *   recebe a linha; as demais veem "duplicate" (já processado) ou "in_progress" (outra entrega em andamento → 409).
 * - `processed_at` só é gravado depois do sucesso do handler (e um erro nessa gravação sobe: nada de `.catch` engolido).
 * - Se o handler falha, a reivindicação é liberada (DELETE) para o reenvio do Stripe poder processar de novo.
 * - Linha sem `processed_at` mais velha que o lease (processo morreu no meio) pode ser reivindicada de novo.
 * - Tabela ausente (migration não aplicada) é o único erro que cai para "sem idempotência", com aviso alto.
 */
export async function processStripeEventOnce(
  event: { id: string; type: string },
  handler: (e: Stripe.Event) => Promise<void> = handleStripeEvent,
): Promise<StripeEventOutcome> {
  let claimed = false;
  try {
    for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
      const claim = await pool.query(
        `INSERT INTO public.stripe_events (event_id, type) VALUES ($1, $2)
         ON CONFLICT (event_id) DO UPDATE SET received_at = now()
           WHERE public.stripe_events.processed_at IS NULL
             AND public.stripe_events.received_at < now() - ($3::int * interval '1 second')
         RETURNING event_id`,
        [event.id, event.type, STRIPE_EVENT_CLAIM_LEASE_SEC],
      );
      if ((claim.rowCount ?? 0) > 0) {
        claimed = true;
        break;
      }
      const cur = await pool.query<{ processed_at: string | null }>(
        "SELECT processed_at FROM public.stripe_events WHERE event_id = $1",
        [event.id],
      );
      // Linha sumiu entre o INSERT e o SELECT (liberada por uma falha concorrente): tenta reivindicar de novo.
      if (cur.rows.length === 0) continue;
      if (cur.rows[0].processed_at) {
        console.info("[billing] evento %s já processado; ignorando reentrega", event.id);
        return "duplicate";
      }
      console.info("[billing] evento %s em processamento por outra entrega; respondendo 409", event.id);
      return "in_progress";
    }
    if (!claimed) return "in_progress";
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    // Tabela ausente (migration não aplicada): segue sem idempotência, mas avisa alto.
    console.warn("[billing] stripe_events indisponível; processando sem idempotência:", e);
    await handler(event as Stripe.Event);
    return "processed";
  }
  try {
    await handler(event as Stripe.Event);
  } catch (err) {
    await pool
      .query("DELETE FROM public.stripe_events WHERE event_id = $1 AND processed_at IS NULL", [event.id])
      .catch((relErr) => console.error("[billing] falha ao liberar o evento %s (o lease expira sozinho):", event.id, relErr));
    throw err;
  }
  await pool.query("UPDATE public.stripe_events SET processed_at = now() WHERE event_id = $1", [event.id]);
  return "processed";
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    console.warn("[billing] pagamento assíncrono falhou; tenant não será provisionado session=%s", session.id);
    return;
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = (session.metadata || {}) as Record<string, string>;
    if (metadata.credit_type === "followup_manual") {
      // Follow-up manual aposentado — não processa, não marca erro.
      console.info("[billing] ignorando checkout followup_manual aposentado session=%s", session.id);
      return;
    }
    // Só provisiona com pagamento confirmado. Método assíncrono (boleto/Pix) chega "unpaid" no completed; o tenant nasce
    // no checkout.session.async_payment_succeeded (se o endpoint do Stripe estiver assinando esse evento).
    if (!isCheckoutSessionPaid(session)) {
      console.info("[billing] checkout %s sem pagamento confirmado (payment_status=%s); aguardando", session.id, session.payment_status);
      return;
    }
    await provisionFromCheckoutSession(session);
    return;
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
    const plan = planFromPriceId(priceId);
    const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end ?? null;
    const status = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
    // Ignora evento atrasado (mais velho que o último aplicado) e propaga falha: o Stripe reenvia.
    const r = await pool.query(
      `UPDATE public.barbershops
       SET subscription_status_changed_at = CASE WHEN subscription_status IS DISTINCT FROM $1 THEN now() ELSE subscription_status_changed_at END,
           subscription_status = $1,
           subscription_current_period_end = COALESCE(to_timestamp($3), subscription_current_period_end),
           billing_plan = COALESCE($4, billing_plan),
           subscription_event_at = to_timestamp($5),
           updated_at = now()
       WHERE stripe_subscription_id = $2
         AND (subscription_event_at IS NULL OR subscription_event_at <= to_timestamp($5))`,
      [status, subscription.id, periodEnd, plan, event.created]
    );
    if ((r.rowCount ?? 0) === 0) {
      const exists = await pool.query("SELECT 1 FROM public.barbershops WHERE stripe_subscription_id = $1", [subscription.id]);
      // Barbearia ainda não provisionada (evento chegou antes do checkout.session.completed): erro → Stripe reenvia.
      if (exists.rows.length === 0) throw new Error(`subscription ${subscription.id} sem barbearia (aguardando provisionamento)`);
    }
    return;
  }
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? "");
    if (!customerId) return;
    // Inicia a tolerância (BILLING_GRACE_DAYS) só na primeira falha; falhas seguintes não renovam o prazo.
    // Ordem: evento mais velho que o último aplicado (ex.: payment_failed atrasado depois de invoice.paid) é ignorado.
    const r = await pool.query<{ id: string }>(
      `UPDATE public.barbershops
       SET subscription_status = 'past_due', subscription_status_changed_at = now(),
           subscription_event_at = to_timestamp($2), updated_at = now()
       WHERE stripe_customer_id = $1 AND COALESCE(subscription_status, 'active') IN ('active', 'trialing')
         AND (subscription_event_at IS NULL OR subscription_event_at <= to_timestamp($2))
       RETURNING id`,
      [customerId, event.created]
    );
    // Aviso ao dono (atrás de BILLING_NOTIFY_PAYMENT_FAILED; desligado por padrão): só na transição para past_due.
    for (const row of r.rows) {
      await notifyOwnerPaymentFailed({ barbershopId: row.id, invoiceId: invoice.id ?? event.id });
    }
    return;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? "");
    if (!customerId) return;
    // invoice.paid e invoice.payment_succeeded chegam juntos para a mesma fatura (event.id diferentes): o segundo é no-op
    // porque a linha já saiu de past_due; a guarda de ordem impede que um pagamento antigo reverta uma falha mais nova.
    await pool.query(
      `UPDATE public.barbershops
       SET subscription_status = 'active', subscription_status_changed_at = now(),
           subscription_event_at = to_timestamp($2), updated_at = now()
       WHERE stripe_customer_id = $1 AND subscription_status IN ('past_due', 'unpaid', 'incomplete')
         AND (subscription_event_at IS NULL OR subscription_event_at <= to_timestamp($2))`,
      [customerId, event.created]
    );
    return;
  }
}

/** Mapeia o price id do Stripe para o plano do produto (null se desconhecido: não altera o plano). */
export function planFromPriceId(priceId: string | null): "essential" | "pro" | "premium" | null {
  if (!priceId) return null;
  if (config.stripePriceIdEssential && priceId === config.stripePriceIdEssential) return "essential";
  if (config.stripePriceIdPro && priceId === config.stripePriceIdPro) return "pro";
  if (config.stripePriceIdPremium && priceId === config.stripePriceIdPremium) return "premium";
  return null;
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!stripe) return;
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : (invoice.customer?.id ?? "");
  if (!customerId) return;

  const shop = await pool.query<{
    id: string;
    name: string;
    stripe_customer_id: string | null;
  }>(
    `SELECT id, name, stripe_customer_id
     FROM public.barbershops
     WHERE stripe_customer_id = $1
     LIMIT 1`,
    [customerId]
  );
  const row = shop.rows[0];
  if (!row) return;

  const admin = await pool.query<{ phone: string | null }>(
    `SELECT phone
     FROM public.profiles
     WHERE barbershop_id = $1
       AND role = 'admin'
       AND phone IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [row.id]
  );
  const toPhone = (admin.rows[0]?.phone ?? "").replace(/\D/g, "");
  if (!toPhone) return;

  let portalLink = `${config.appUrl.replace(/\/$/, "")}/app/configuracoes`;
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.appUrl.replace(/\/$/, "")}/app/configuracoes`,
    });
    portalLink = portalSession.url;
  } catch (e) {
    console.warn("[billing] failed to create portal session for payment reminder:", e);
  }

  await schedulePaymentReminder({
    barbershopId: row.id,
    toPhone,
    barbershopName: row.name,
    portalLink,
  });
}

async function creditFollowupFromSession(session: Stripe.Checkout.Session): Promise<void> {
  const metadata = (session.metadata || {}) as Record<string, string>;
  const barbershopId = metadata.barbershop_id;
  const quantity = Math.max(1, parseInt(metadata.quantity ?? "1", 10) || 1);
  if (!barbershopId) {
    console.warn("creditFollowupFromSession: missing barbershop_id in metadata");
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string; barbershop_id: string; quantity: number }>(
      `INSERT INTO public.credit_purchases (barbershop_id, stripe_session_id, credit_type, quantity, status, updated_at)
       VALUES ($1, $2, 'followup_manual', $3, 'completed', now())
       ON CONFLICT (stripe_session_id) DO NOTHING
       RETURNING id, barbershop_id, quantity`,
      [barbershopId, session.id, quantity]
    );
    if (inserted.rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query(
      `INSERT INTO public.barbershop_message_credits (barbershop_id, credit_type, balance, updated_at)
       VALUES ($1, 'followup_manual', $2, now())
       ON CONFLICT (barbershop_id, credit_type) DO UPDATE SET balance = barbershop_message_credits.balance + $2, updated_at = now()`,
      [barbershopId, quantity]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export type ProvisionOutcome =
  | { kind: "created"; barbershopId: string }
  | { kind: "existing"; barbershopId: string }
  | { kind: "reactivated"; barbershopId: string }
  | { kind: "review"; reason: string; barbershopId: string | null };

/** Status de assinatura que NÃO está mais valendo: só nesse caso um novo pagamento com o mesmo e-mail reativa o tenant antigo. */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** Só registra o domínio do e-mail no log (nada de endereço completo). */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***";
}

/** `payment_status` que autoriza provisionar. Métodos assíncronos (boleto/Pix) chegam como "unpaid" no completed. */
export function isCheckoutSessionPaid(session: Pick<Stripe.Checkout.Session, "payment_status">): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

type ManualReview = {
  reason: string;
  stripeCustomerId: string;
  stripeSessionId: string;
  email: string;
  barbershopId: string | null;
  details?: Record<string, unknown>;
};

/** Registro durável para conferência manual (pagamento recebido que o provisionamento não pôde vincular sozinho). */
async function recordManualReview(
  q: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  r: ManualReview,
): Promise<void> {
  console.error(
    "[billing][REVISAO_MANUAL] motivo=%s customer=%s session=%s email=%s barbershop=%s",
    r.reason, r.stripeCustomerId, r.stripeSessionId, maskEmail(r.email), r.barbershopId ?? "-",
  );
  await q.query(
    `INSERT INTO public.billing_manual_reviews (reason, stripe_customer_id, stripe_session_id, email, barbershop_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (stripe_session_id, reason) DO NOTHING`,
    [r.reason, r.stripeCustomerId, r.stripeSessionId, r.email, r.barbershopId, JSON.stringify(r.details ?? {})],
  );
}

/**
 * Provisiona (ou reaproveita) o tenant de um checkout pago. Decisão para o mesmo e-mail:
 *  1. Mesmo `stripe_customer_id` → é o tenant dele (reentrega, fallback de /billing/session, nova assinatura do mesmo cliente).
 *  2. Senão, e-mail já existente em `profiles` (índice único global): reaproveita barbearia e perfil, SEM criar outro
 *     perfil (era o 23505 → 500 em toda reentrega), mas só se a assinatura anterior daquela barbearia já terminou
 *     (canceled/unpaid/incomplete_expired): então vincula o novo cliente Stripe, grava plano/assinatura e reativa.
 *  3. E-mail de tenant com assinatura viva de OUTRO cliente, ou de tenant sem cliente Stripe, ou de outro tenant:
 *     NÃO vincula (e-mail digitado no formulário não prova posse; vincular daria ao pagador acesso à conta alheia).
 *     Grava `billing_manual_reviews`, loga e responde 200 (sem reentrega infinita).
 *  Em 2 e 3 nenhuma senha nova nasce e nenhum e-mail com senha sai; `GET /billing/session` só troca o session_id por JWT
 *  quando o perfil foi criado por esta compra (existe `checkout_onboarding`), então o pagador nunca entra na conta alheia.
 */
export async function provisionFromCheckoutSession(session: Stripe.Checkout.Session): Promise<ProvisionOutcome | null> {
  const customerEmail = (
    session.customer_email ||
    session.customer_details?.email ||
    ""
  )
    .toString()
    .trim()
    .toLowerCase();
  if (!customerEmail || !session.customer) return null;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const metadata = (session.metadata || {}) as Record<string, string>;
  const barbershopName = metadata.barbershop_name || metadata.barbershopName || "Minha NavalhIA";
  const phone = metadata.phone || null;
  const cnpj = metadata.cnpj || null;
  const contactName = metadata.contact_name || barbershopName;
  const plan = (metadata.plan === "essential" || metadata.plan === "premium" ? metadata.plan : "pro") as "essential" | "pro" | "premium";
  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const apiKey = `bfk_${crypto.randomUUID()}_${Math.random().toString(36).slice(2, 10)}`;
  const keyHash = await bcrypt.hash(apiKey, 10);

  const review = (reason: string, barbershopId: string | null, details?: Record<string, unknown>): ManualReview => ({
    reason, stripeCustomerId, stripeSessionId: session.id, email: customerEmail, barbershopId, details,
  });
  /** Dentro da transação: SAVEPOINT para a tabela ausente (migration não aplicada) não abortar o resto. */
  const reviewInTx = async (client: import("pg").PoolClient, r: ManualReview) => {
    await client.query("SAVEPOINT manual_review");
    try {
      await recordManualReview(client, r);
      await client.query("RELEASE SAVEPOINT manual_review");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT manual_review");
      console.error("[billing] não foi possível gravar billing_manual_reviews (migration aplicada?):", e);
    }
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serializa o provisionamento por cliente Stripe e por e-mail (webhook × fallback de /billing/session, reentregas,
    // reassinatura): a 2ª chamada espera o commit da 1ª e então ENXERGA o que ela criou (os SELECTs abaixo rodam depois dos locks).
    // Ordem fixa dos locks (cliente → e-mail → slug) para não haver deadlock.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`stripe_customer:${stripeCustomerId}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`profile_email:${customerEmail}`]);

    const byCustomer = await client.query<{ id: string; account_id: string | null; stripe_subscription_id: string | null }>(
      "SELECT id, account_id, stripe_subscription_id FROM public.barbershops WHERE stripe_customer_id = $1 ORDER BY created_at ASC LIMIT 1",
      [stripeCustomerId]
    );

    let kind: "created" | "existing" | "reactivated";
    let barbershopId: string;
    let accountId: string | null;

    if (byCustomer.rows.length > 0) {
      kind = "existing";
      barbershopId = byCustomer.rows[0].id;
      accountId = byCustomer.rows[0].account_id;
      const newSubscription = !!stripeSubscriptionId && stripeSubscriptionId !== byCustomer.rows[0].stripe_subscription_id;
      if (newSubscription) {
        // Mesmo cliente assinando de novo: grava a nova assinatura e o plano e reativa.
        await client.query(
          `UPDATE public.barbershops
           SET stripe_subscription_id = $1, subscription_status = 'active', billing_plan = $2,
               subscription_status_changed_at = now(), subscription_event_at = NULL, updated_at = now()
           WHERE id = $3`,
          [stripeSubscriptionId, plan, barbershopId]
        );
      } else {
        await client.query(
          `UPDATE public.barbershops
           SET stripe_subscription_id = COALESCE($1, stripe_subscription_id),
               subscription_status = COALESCE(subscription_status, 'active'),
               billing_plan = COALESCE($2, billing_plan),
               updated_at = now()
           WHERE id = $3`,
          [stripeSubscriptionId, plan, barbershopId]
        );
      }
    } else {
      const byEmail = await client.query<{
        barbershop_id: string;
        account_id: string | null;
        stripe_customer_id: string | null;
        subscription_status: string | null;
      }>(
        `SELECT p.barbershop_id, b.account_id, b.stripe_customer_id, b.subscription_status
         FROM public.profiles p
         JOIN public.barbershops b ON b.id = p.barbershop_id
         WHERE LOWER(TRIM(p.email)) = $1
         ORDER BY p.created_at ASC
         LIMIT 1`,
        [customerEmail]
      );
      if (byEmail.rows.length > 0) {
        const row = byEmail.rows[0];
        const reusable = !!row.stripe_customer_id && TERMINAL_SUBSCRIPTION_STATUSES.has(row.subscription_status ?? "");
        if (!reusable) {
          const reason = row.stripe_customer_id ? "email_de_tenant_com_assinatura_ativa_de_outro_cliente" : "email_de_tenant_sem_cliente_stripe";
          await reviewInTx(client, review(reason, row.barbershop_id, { subscription_status: row.subscription_status, plan }));
          await client.query("COMMIT");
          return { kind: "review", reason, barbershopId: row.barbershop_id };
        }
        kind = "reactivated";
        barbershopId = row.barbershop_id;
        accountId = row.account_id;
        await client.query(
          `UPDATE public.barbershops
           SET stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = 'active', billing_plan = $3,
               subscription_status_changed_at = now(), subscription_event_at = NULL, updated_at = now()
           WHERE id = $4`,
          [stripeCustomerId, stripeSubscriptionId, plan, barbershopId]
        );
        console.info("[billing] tenant %s reativado por nova assinatura (customer=%s)", barbershopId, stripeCustomerId);
      } else {
        kind = "created";
        const accountResult = await client.query<{ id: string }>(
          "INSERT INTO public.accounts (name) VALUES ($1) RETURNING id",
          [barbershopName]
        );
        accountId = accountResult.rows[0].id;
        // Escolher o slug é "consulta + insert": serializa só esse trecho (lock global até o commit) para que dois
        // cadastros simultâneos com o mesmo nome não escolham o mesmo slug e um deles caia em erro de UNIQUE.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["barbershop_slug"]);
        const slug = await chooseUniqueSlug(client, barbershopName);
        const shopResult = await client.query<{ id: string }>(
          `INSERT INTO public.barbershops (account_id, name, slug, email, phone, cnpj, stripe_customer_id, stripe_subscription_id, subscription_status, billing_plan)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [accountId, barbershopName, slug, customerEmail, phone, cnpj, stripeCustomerId, stripeSubscriptionId, "active", plan]
        );
        barbershopId = shopResult.rows[0].id;
      }
    }

    if (!accountId) {
      // Barbearia legada sem conta: cria a conta e vincula (idempotente sob o lock).
      const acc = await client.query<{ id: string }>("INSERT INTO public.accounts (name) VALUES ($1) RETURNING id", [barbershopName]);
      accountId = acc.rows[0].id;
      await client.query("UPDATE public.barbershops SET account_id = $1 WHERE id = $2 AND account_id IS NULL", [accountId, barbershopId]);
    }

    // Perfil admin: o índice único de e-mail é GLOBAL. Reaproveita o perfil da própria barbearia; se o e-mail é de
    // OUTRA barbearia, não cria perfil (revisão manual) em vez de estourar 23505.
    const emailProfile = await client.query<{ id: string; barbershop_id: string }>(
      `SELECT id, barbershop_id FROM public.profiles WHERE LOWER(TRIM(email)) = $1 ORDER BY created_at ASC LIMIT 1`,
      [customerEmail]
    );
    let profileId: string | null = null;
    let profileInserted = false;
    if (emailProfile.rows.length > 0) {
      if (emailProfile.rows[0].barbershop_id === barbershopId) {
        profileId = emailProfile.rows[0].id;
      } else {
        await reviewInTx(client, review("email_pertence_a_outro_tenant", barbershopId, { other_barbershop_id: emailProfile.rows[0].barbershop_id }));
      }
    } else {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, phone, password_hash, role, must_change_password)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'admin', true)
         RETURNING id`,
        [barbershopId, contactName, customerEmail, phone, passwordHash]
      );
      profileId = ins.rows[0].id;
      profileInserted = true;
    }

    if (profileId) {
      await client.query(
        `INSERT INTO public.account_memberships (profile_id, account_id, role)
         SELECT $1, $2, 'owner'
         WHERE NOT EXISTS (SELECT 1 FROM public.account_memberships WHERE profile_id = $1 AND account_id = $2)`,
        [profileId, accountId]
      ).catch(() => {});
    }

    // Ensure an API key exists (idempotent by name).
    await client.query(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM public.barbershop_api_keys k WHERE k.barbershop_id = $1 AND k.name = $2
       )`,
      [barbershopId, "n8n-default", keyHash]
    );

    // Senha temporária (fallback legado do primeiro acesso): só existe quando ESTA compra criou o perfil. É também o que
    // autoriza GET /billing/session a emitir JWT; reativação/reentrega/outro tenant nunca gravam, então ninguém entra
    // numa conta que não criou.
    if (profileInserted) {
      await client.query(
        `INSERT INTO public.checkout_onboarding (stripe_session_id, email, barbershop_name, temporary_password)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (stripe_session_id) DO NOTHING`,
        [session.id, customerEmail, barbershopName, tempPassword]
      );
    }
    await client.query("COMMIT");
    // Só o perfil recém-criado ganha e-mail de boas-vindas (a senha/chave novas não valeriam para um perfil existente).
    if (config.fromEmail && profileInserted) {
      try {
        await sendOnboardingEmail({
          to: customerEmail,
          barbershopName,
          appUrl: config.appUrl,
          tempPassword,
          apiKey,
        });
      } catch (emailErr) {
        console.error("[billing] Onboarding email failed (provisioning already done):", emailErr);
      }
    }
    return { kind, barbershopId };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // Rede de segurança: perfil com e-mail já existente (idx_profiles_email) nunca deve virar 500 em toda reentrega por dias.
    if ((e as { code?: string; constraint?: string })?.code === "23505" && (e as { constraint?: string }).constraint === "idx_profiles_email") {
      await recordManualReview(pool, review("email_ja_cadastrado_conflito_de_indice", null)).catch((err) =>
        console.error("[billing] falha ao registrar revisão manual:", err)
      );
      return { kind: "review", reason: "email_ja_cadastrado_conflito_de_indice", barbershopId: null };
    }
    throw e;
  } finally {
    client.release();
  }
}

function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

// Public routes: create checkout session (form → Stripe) and get onboarding credentials (success page)
export const billingRouter = Router();

billingRouter.post("/checkout", async (req: Request, res: Response): Promise<void> => {
  if (!stripe) {
    res.status(503).json({ error: "Checkout não configurado (Stripe)" });
    return;
  }
  const parsed = checkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
    return;
  }
  if (riskAcceptanceRequired() && parsed.data.whatsapp_risk_accepted !== true) {
    res.status(400).json(RISK_NOT_ACCEPTED_BODY);
    return;
  }
  const { barbershop_name, cnpj, phone, email, contact_name, plan, extra_numbers: rawExtras } = parsed.data;
  const priceId = plan ? getPriceIdForPlan(plan) : config.stripePriceId || null;
  if (!priceId) {
    res.status(503).json({ error: "Checkout não configurado (STRIPE_PRICE_ID ou planos)" });
    return;
  }
  const effectivePlan = plan ?? "pro";
  const extraNumbers = effectivePlan === "essential" ? 0 : Math.max(0, Math.min(20, rawExtras ?? 0));
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }];
  if (extraNumbers > 0 && config.stripePriceIdExtraNumber) {
    lineItems.push({ price: config.stripePriceIdExtraNumber, quantity: extraNumbers });
  }
  const appUrl = config.appUrl.replace(/\/$/, "");
  const attr = checkoutSessionAttribution(parsed.data);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: lineItems,
      success_url: `${appUrl}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/`,
      metadata: {
        barbershop_name,
        cnpj: cnpj ?? "",
        phone,
        contact_name: contact_name ?? barbershop_name,
        ...(effectivePlan ? { plan: effectivePlan } : {}),
        extra_numbers: String(extraNumbers),
        whatsapp_numbers_total: String(1 + extraNumbers),
        ...riskAcceptanceMetadata(parsed.data),
        ...marketingConsentMetadata(parsed.data),
        ...attr,
      },
      ...(Object.keys(attr).length ? { subscription_data: { metadata: attr } } : {}),
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout create error:", e);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento" });
  }
});

billingRouter.post("/checkout_embedded", async (req: Request, res: Response): Promise<void> => {
  if (!stripe) {
    res.status(503).json({ error: "Checkout não configurado (Stripe)" });
    return;
  }
  const parsed = checkoutEmbeddedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
    return;
  }
  if (riskAcceptanceRequired() && parsed.data.whatsapp_risk_accepted !== true) {
    res.status(400).json(RISK_NOT_ACCEPTED_BODY);
    return;
  }
  const { barbershop_name, cnpj, phone, email, contact_name, plan, extra_numbers: rawExtras } = parsed.data;
  const priceId = getPriceIdForPlan(plan);
  if (!priceId) {
    res.status(503).json({ error: "Checkout não configurado (STRIPE_PRICE_ID ou planos)" });
    return;
  }
  const extraNumbers = plan === "essential" ? 0 : Math.max(0, Math.min(20, rawExtras ?? 0));
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }];
  if (extraNumbers > 0 && config.stripePriceIdExtraNumber) {
    lineItems.push({ price: config.stripePriceIdExtraNumber, quantity: extraNumbers });
  }
  const appUrl = config.appUrl.replace(/\/$/, "");
  const attr = checkoutSessionAttribution(parsed.data);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded",
      customer_email: email,
      line_items: lineItems,
      return_url: `${appUrl}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        barbershop_name,
        cnpj: cnpj ?? "",
        phone,
        contact_name: contact_name ?? barbershop_name,
        plan,
        extra_numbers: String(extraNumbers),
        whatsapp_numbers_total: String(1 + extraNumbers),
        ...riskAcceptanceMetadata(parsed.data),
        ...marketingConsentMetadata(parsed.data),
        ...attr,
      },
      ...(Object.keys(attr).length ? { subscription_data: { metadata: attr } } : {}),
    });
    res.json({ client_secret: session.client_secret });
  } catch (e) {
    console.error("Stripe checkout embedded create error:", e);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento" });
  }
});

/** POST /api/billing/portal — create Stripe Customer Portal session (add-ons, update payment, cancel). Requires JWT. */
billingRouter.post("/portal", requireJwt, requireRole(...ADMIN_ONLY), async (req: Request, res: Response): Promise<void> => {
  if (!stripe) {
    res.status(503).json({ error: "Billing não configurado (Stripe)" });
    return;
  }
  try {
    const barbershopId = getBarbershopId(req);
    const row = await pool.query<{ stripe_customer_id: string | null }>(
      "SELECT stripe_customer_id FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const stripeCustomerId = row.rows[0]?.stripe_customer_id ?? null;
    if (!stripeCustomerId) {
      res.status(400).json({
        error: "Nenhum cliente Stripe vinculado. Assine um plano pela landing para gerenciar assinatura e números extras.",
      });
      return;
    }
    const appUrl = config.appUrl.replace(/\/$/, "");
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${appUrl}/app/configuracoes`,
    });
    res.json({ url: session.url });
  } catch (e) {
    if (e instanceof Error && e.message === "barbershop_id required") {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }
    console.error("Billing portal create error:", e);
    res.status(500).json({ error: "Erro ao abrir portal de cobrança" });
  }
});

const creditsCheckoutBody = z.object({
  quantity: z.number().int().min(1).max(500).default(10),
});

/** POST /api/billing/credits_checkout — aposentado. */
billingRouter.post("/credits_checkout", requireJwt, requireRole(...ADMIN_ONLY), (_req: Request, res: Response): void => {
  res.status(410).json({ error: "Créditos de follow-up fora do produto. Use o painel de reativação." });
});

/** @deprecated kept for reference — do not call */
async function _credits_checkout_retired(req: Request, res: Response): Promise<void> {
  if (!stripe) {
    res.status(503).json({ error: "Checkout não configurado (Stripe)" });
    return;
  }
  const priceId = config.stripePriceIdFollowupCredit;
  if (!priceId) {
    res.status(503).json({
      error: "Créditos de follow-up não configurados. Configure STRIPE_PRICE_ID_FOLLOWUP_CREDIT.",
    });
    return;
  }
  const barbershopId = getBarbershopId(req);
  const parsed = creditsCheckoutBody.safeParse(req.body);
  const quantity = parsed.success ? parsed.data.quantity : 10;
  const appUrl = config.appUrl.replace(/\/$/, "");
  try {
    const row = await pool.query<{ stripe_customer_id: string | null; email: string | null }>(
      "SELECT stripe_customer_id, email FROM public.barbershops WHERE id = $1",
      [barbershopId]
    );
    const stripeCustomerId = row.rows[0]?.stripe_customer_id ?? null;
    const email = row.rows[0]?.email ?? undefined;
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [{ price: priceId, quantity }],
      metadata: {
        barbershop_id: barbershopId,
        credit_type: "followup_manual",
        quantity: String(quantity),
      },
      success_url: `${appUrl}/app/configuracoes?credits=success`,
      cancel_url: `${appUrl}/app/configuracoes`,
    };
    if (stripeCustomerId) sessionParams.customer = stripeCustomerId;
    else if (email) sessionParams.customer_email = email;
    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (e) {
    console.error("Credits checkout create error:", e);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento" });
  }
}
void _credits_checkout_retired;

billingRouter.get("/session", async (req: Request, res: Response): Promise<void> => {
  const sessionId = (req.query.session_id as string)?.trim();
  if (!sessionId || !stripe) {
    res.status(400).json({ error: "session_id obrigatório" });
    return;
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== "complete") {
      res.status(400).json({ error: "Pagamento ainda não foi concluído" });
      return;
    }
    if (session.mode && session.mode !== "subscription") {
      res.status(400).json({ error: "Sessão inválida (mode diferente de subscription)" });
      return;
    }
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      res.status(400).json({ error: "Pagamento ainda não foi confirmado" });
      return;
    }
    if (Date.now() / 1000 - (session.created ?? 0) > SESSION_EXCHANGE_MAX_AGE_SEC) {
      res.status(410).json({ error: "Este link expirou. Entre com seu e-mail e senha." });
      return;
    }
    const email = (session.customer_email || session.customer_details?.email || "").toString().trim().toLowerCase();
    const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (!email || !stripeCustomerId) {
      res.status(400).json({ error: "Sessão inválida (sem customer/email)." });
      return;
    }

    // Primary source of truth: barbershop created by webhook (stripe_customer_id).
    // This enables a passwordless first-login: exchange session_id for a JWT.
    const shopRow = await pool.query<{ id: string; name: string; email: string | null }>(
      "SELECT id, name, email FROM public.barbershops WHERE stripe_customer_id = $1 LIMIT 1",
      [stripeCustomerId]
    );
    if (shopRow.rows.length === 0) {
      // Webhook may still be provisioning (race) or may be misconfigured.
      // Fallback: provision synchronously so onboarding doesn't depend on email delivery.
      try {
        await provisionFromCheckoutSession(session);
      } catch (e) {
        console.error("[billing/session] fallback provisioning failed:", e);
      }

      const retryShop = await pool.query<{ id: string; name: string; email: string | null }>(
        "SELECT id, name, email FROM public.barbershops WHERE stripe_customer_id = $1 LIMIT 1",
        [stripeCustomerId]
      );
      if (retryShop.rows.length === 0) {
        res.status(202).json({
          email,
          message: "Pagamento confirmado. Aguarde enquanto estamos criando seu acesso…",
        });
        return;
      }

      shopRow.rows = retryShop.rows;
    }
    const barbershopId = shopRow.rows[0].id;
    const barbershopName = shopRow.rows[0].name;

    const profileRow = await pool.query<{ id: string; role: string }>(
      `SELECT id, role
       FROM public.profiles
       WHERE barbershop_id = $1 AND LOWER(TRIM(email)) = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [barbershopId, email]
    );
    if (profileRow.rows.length === 0) {
      // If the barbershop exists but the profile isn't visible yet, attempt fallback provisioning too.
      // (idempotent due to stripe_customer_id check inside provisionFromCheckoutSession).
      try {
        await provisionFromCheckoutSession(session);
      } catch (e) {
        console.error("[billing/session] fallback provisioning (profile) failed:", e);
      }

      const retryProfile = await pool.query<{ id: string; role: string }>(
        `SELECT id, role
         FROM public.profiles
         WHERE barbershop_id = $1 AND LOWER(TRIM(email)) = $2
         ORDER BY created_at ASC
         LIMIT 1`,
        [barbershopId, email]
      );
      if (retryProfile.rows.length === 0) {
        res.status(202).json({
          email,
          barbershop_name: barbershopName,
          message: "Pagamento confirmado. Aguarde enquanto estamos finalizando seu usuário…",
        });
        return;
      }

      profileRow.rows = retryProfile.rows;
    }

    // Troca de uso único: o mesmo session_id (que fica na URL/histórico) nunca emite um 2º JWT.
    const claim = await pool.query(
      "INSERT INTO public.checkout_session_exchanges (stripe_session_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING stripe_session_id",
      [sessionId]
    );
    if ((claim.rowCount ?? 0) === 0) {
      res.status(410).json({ error: "Este link já foi utilizado. Entre com seu e-mail e senha." });
      return;
    }
    // Só quem CRIOU o perfil nesta compra entra sem senha: `checkout_onboarding` só existe quando esta compra criou o perfil.
    // Reativação (mesmo e-mail, tenant antigo) e e-mail de outro tenant caem aqui: nada de JWT para a conta de outra pessoa.
    const created = await pool.query("SELECT 1 FROM public.checkout_onboarding WHERE stripe_session_id = $1", [sessionId]);
    if ((created.rowCount ?? 0) === 0) {
      res.status(409).json({
        error: "Pagamento confirmado. Este e-mail já tem cadastro: entre com seu e-mail e senha (ou use «Esqueci minha senha»).",
        code: "login_required",
        email,
      });
      return;
    }
    const payload: JwtPayload = {
      profileId: profileRow.rows[0].id,
      barbershopId,
      role: profileRow.rows[0].role,
      email,
    };
    // JWT curto: serve para o primeiro acesso (a troca de senha é obrigatória: must_change_password).
    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: "2h" } as jwt.SignOptions);

    // Best-effort cleanup of legacy one-time password storage (avoid leaking temp password).
    void pool
      .query("DELETE FROM public.checkout_onboarding WHERE stripe_session_id = $1", [sessionId])
      .catch(() => {});

    res.json({
      email,
      barbershop_name: barbershopName,
      token,
      message: "Acesso criado. Entrando no painel…",
    });
  } catch (e) {
    // If the session doesn't exist (wrong mode, expired/invalid id), return 400 with a clear error
    // instead of 500 (helps the onboarding UI show a meaningful message).
    if (
      e &&
      typeof e === "object" &&
      // Stripe SDK errors usually have `type` and `code`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).type === "StripeInvalidRequestError" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).code === "resource_missing"
    ) {
      res.status(400).json({ error: "session_id inválido ou expirado. Refaça o checkout e tente novamente." });
      return;
    }
    console.error("Billing session fetch error:", e);
    res.status(500).json({ error: "Erro ao obter dados da sessão" });
  }
});
