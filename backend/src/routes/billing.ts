import { Request, Response, Router } from "express";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sendOnboardingEmail } from "../lib/ses.js";
import { requireJwt, getBarbershopId, type JwtPayload } from "../middleware/auth.js";
import { schedulePaymentReminder } from "../outbound/scheduled-messages.js";

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey, { apiVersion: "2025-02-24.acacia" }) : null;

/** Cancel a Stripe subscription by ID. No-op if stripe not configured or id empty. */
export async function cancelStripeSubscription(subscriptionId: string | null): Promise<void> {
  if (!stripe || !subscriptionId?.trim()) return;
  await stripe.subscriptions.cancel(subscriptionId).catch((e) => {
    console.warn("Stripe subscription cancel warning:", e);
  });
}

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
});

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
  void handleStripeEvent(event).then(() => {
    res.status(200).send();
  }).catch((e) => {
    console.error("Stripe webhook handler error:", e);
    res.status(500).send("Internal error");
  });
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = (session.metadata || {}) as Record<string, string>;
    if (metadata.credit_type === "followup_manual") {
      await creditFollowupFromSession(session);
      return;
    }
    await provisionFromCheckoutSession(session);
    return;
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    await pool.query(
      `UPDATE public.barbershops SET subscription_status = $1 WHERE stripe_subscription_id = $2`,
      [subscription.status, subscription.id]
    ).catch(() => {});
  }
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    await handleInvoicePaymentFailed(invoice);
  }
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

async function provisionFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const customerEmail = (
    session.customer_email ||
    session.customer_details?.email ||
    ""
  )
    .toString()
    .trim()
    .toLowerCase();
  if (!customerEmail || !session.customer) return;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const metadata = (session.metadata || {}) as Record<string, string>;
  const barbershopName = metadata.barbershop_name || metadata.barbershopName || "Minha NavalhIA";
  const phone = metadata.phone || null;
  const cnpj = metadata.cnpj || null;
  const contactName = metadata.contact_name || barbershopName;
  const plan = (metadata.plan === "essential" || metadata.plan === "premium" ? metadata.plan : "pro") as "essential" | "pro" | "premium";
  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  const existing = await pool.query<{ id: string; account_id: string | null }>(
    "SELECT id, account_id FROM public.barbershops WHERE stripe_customer_id = $1 LIMIT 1",
    [stripeCustomerId]
  );

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const apiKey = `bfk_${crypto.randomUUID()}_${Math.random().toString(36).slice(2, 10)}`;
  const keyHash = await bcrypt.hash(apiKey, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Multi-tenant: ensure an account exists and this barbershop belongs to it.
    let accountId: string;
    if (existing.rows.length > 0 && existing.rows[0].account_id) {
      accountId = existing.rows[0].account_id;
    } else {
      const accountResult = await client.query<{ id: string }>(
        "INSERT INTO public.accounts (name) VALUES ($1) RETURNING id",
        [barbershopName]
      );
      accountId = accountResult.rows[0].id;
    }

    let barbershopId: string;
    if (existing.rows.length > 0) {
      barbershopId = existing.rows[0].id;
      // Keep subscription metadata up to date (idempotent).
      await client.query(
        `UPDATE public.barbershops
         SET account_id = COALESCE(account_id, $1),
             stripe_subscription_id = COALESCE($2, stripe_subscription_id),
             subscription_status = COALESCE(subscription_status, 'active'),
             billing_plan = COALESCE($3, billing_plan),
             updated_at = now()
         WHERE id = $4`,
        [accountId, stripeSubscriptionId, plan, barbershopId]
      ).catch(() => {});
    } else {
      const slug = await chooseUniqueSlug(client, barbershopName);
      const shopResult = await client.query<{ id: string }>(
        `INSERT INTO public.barbershops (account_id, name, slug, email, phone, cnpj, stripe_customer_id, stripe_subscription_id, subscription_status, billing_plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [accountId, barbershopName, slug, customerEmail, phone, cnpj, stripeCustomerId, stripeSubscriptionId, "active", plan]
      );
      barbershopId = shopResult.rows[0].id;
    }

    // Ensure an admin profile exists for this barbershop + email (idempotent).
    await client.query(
      `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, phone, password_hash, role, must_change_password)
       SELECT gen_random_uuid(), $1, $2, $3, $4, $5, 'admin', true
       WHERE NOT EXISTS (
         SELECT 1 FROM public.profiles p
         WHERE p.barbershop_id = $1 AND LOWER(TRIM(p.email)) = LOWER(TRIM($3))
       )`,
      [barbershopId, contactName, customerEmail, phone, passwordHash]
    );

    const profileRow = await client.query<{ id: string }>(
      `SELECT id FROM public.profiles
       WHERE barbershop_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))
       ORDER BY created_at ASC
       LIMIT 1`,
      [barbershopId, customerEmail]
    );
    const profileId = profileRow.rows[0]?.id;
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

    // Temporary password storage: legacy fallback for email-based first access.
    // Best-effort; will be deleted when /billing/session returns a token.
    await client.query(
      `INSERT INTO public.checkout_onboarding (stripe_session_id, email, barbershop_name, temporary_password)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_session_id) DO UPDATE SET temporary_password = EXCLUDED.temporary_password`,
      [session.id, customerEmail, barbershopName, tempPassword]
    );
    await client.query("COMMIT");
    if (config.fromEmail) {
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
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
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
      },
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
      },
    });
    res.json({ client_secret: session.client_secret });
  } catch (e) {
    console.error("Stripe checkout embedded create error:", e);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento" });
  }
});

/** POST /api/billing/portal — create Stripe Customer Portal session (add-ons, update payment, cancel). Requires JWT. */
billingRouter.post("/portal", requireJwt, async (req: Request, res: Response): Promise<void> => {
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

/** POST /api/billing/credits_checkout — create Stripe Checkout (payment) for follow-up credits. Requires JWT. */
billingRouter.post("/credits_checkout", requireJwt, async (req: Request, res: Response): Promise<void> => {
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
});

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

    const payload: JwtPayload = {
      profileId: profileRow.rows[0].id,
      barbershopId,
      role: profileRow.rows[0].role,
      email,
    };
    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);

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
