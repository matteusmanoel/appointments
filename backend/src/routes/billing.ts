import { Request, Response } from "express";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { config } from "../config.js";
import { sendOnboardingEmail } from "../lib/ses.js";

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey, { apiVersion: "2025-02-24.acacia" }) : null;

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
}

async function provisionFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const customerEmail = (session.customer_email || (session.customer as string) || "").toString();
  if (!customerEmail || !session.customer) return;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const metadata = (session.metadata || {}) as Record<string, string>;
  const barbershopName = metadata.barbershop_name || metadata.barbershopName || "Minha Barbearia";
  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;

  const existing = await pool.query(
    "SELECT id FROM public.barbershops WHERE stripe_customer_id = $1",
    [stripeCustomerId]
  );
  if (existing.rows.length > 0) return;

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const apiKey = `bfk_${crypto.randomUUID()}_${Math.random().toString(36).slice(2, 10)}`;
  const keyHash = await bcrypt.hash(apiKey, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const shopResult = await client.query(
      `INSERT INTO public.barbershops (name, email, stripe_customer_id, stripe_subscription_id, subscription_status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [barbershopName, customerEmail, stripeCustomerId, stripeSubscriptionId, "active"]
    );
    const barbershopId = shopResult.rows[0].id;
    await client.query(
      `INSERT INTO public.profiles (user_id, barbershop_id, full_name, email, password_hash, role, must_change_password)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'admin', true)`,
      [barbershopId, barbershopName, customerEmail, passwordHash]
    );
    await client.query(
      `INSERT INTO public.barbershop_api_keys (barbershop_id, name, key_hash) VALUES ($1, $2, $3)`,
      [barbershopId, "n8n-default", keyHash]
    );
    await client.query("COMMIT");
    if (config.fromEmail) {
      await sendOnboardingEmail({
        to: customerEmail,
        barbershopName,
        appUrl: config.appUrl,
        tempPassword,
        apiKey,
      });
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
