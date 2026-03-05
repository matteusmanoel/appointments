import { Router, Request, Response } from "express";
import { pool } from "../db.js";
import { requireJwt, getBarbershopId } from "../middleware/auth.js";
import { cancelStripeSubscription } from "./billing.js";

export const accountRouter = Router();

/** DELETE /api/account/barbershop — delete current barbershop (unit). Requires owner or admin. */
accountRouter.delete("/barbershop", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const profileId = req.auth?.profileId;
  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const barbershopId = getBarbershopId(req);

  const membership = await pool.query<{ role: string }>(
    `SELECT am.role FROM public.barbershops b
     INNER JOIN public.account_memberships am ON am.account_id = b.account_id
     WHERE am.profile_id = $1 AND b.id = $2`,
    [profileId, barbershopId]
  );
  const legacy = await pool.query<{ role: string }>(
    "SELECT role FROM public.profiles WHERE id = $1 AND barbershop_id = $2",
    [profileId, barbershopId]
  );
  const role = membership.rows[0]?.role ?? legacy.rows[0]?.role;
  if (!role || !["owner", "admin"].includes(role)) {
    res.status(403).json({ error: "Apenas owner ou admin pode excluir a unidade" });
    return;
  }

  const subRow = await pool.query<{ stripe_subscription_id: string | null }>(
    "SELECT stripe_subscription_id FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  const subscriptionId = subRow.rows[0]?.stripe_subscription_id ?? null;
  await cancelStripeSubscription(subscriptionId);

  await pool.query("DELETE FROM public.barbershops WHERE id = $1", [barbershopId]);

  const remaining = await pool.query<{ id: string }>(
    `SELECT b.id FROM public.barbershops b
     INNER JOIN public.account_memberships am ON am.account_id = b.account_id
     WHERE am.profile_id = $1 AND b.id != $2 LIMIT 1`,
    [profileId, barbershopId]
  );
  const fallback = await pool.query<{ id: string }>(
    "SELECT id FROM public.barbershops WHERE id IN (SELECT barbershop_id FROM public.profiles WHERE id = $1) AND id != $2 LIMIT 1",
    [profileId, barbershopId]
  );
  const nextBarbershopId = remaining.rows[0]?.id ?? fallback.rows[0]?.id ?? null;
  if (!nextBarbershopId) {
    res.json({ deleted: true, redirect: "login" });
    return;
  }
  res.json({ deleted: true, switch_to: nextBarbershopId });
});

/** DELETE /api/account — delete entire account (all barbershops). Requires owner. */
accountRouter.delete("/", requireJwt, async (req: Request, res: Response): Promise<void> => {
  const profileId = req.auth?.profileId;
  if (!profileId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const barbershopId = getBarbershopId(req);

  const accountRow = await pool.query<{ account_id: string | null }>(
    "SELECT account_id FROM public.barbershops WHERE id = $1",
    [barbershopId]
  );
  const accountId = accountRow.rows[0]?.account_id;
  if (!accountId) {
    await pool.query("DELETE FROM public.barbershops WHERE id = $1", [barbershopId]);
    res.json({ deleted: true, redirect: "login" });
    return;
  }

  const membership = await pool.query<{ role: string }>(
    "SELECT role FROM public.account_memberships WHERE profile_id = $1 AND account_id = $2",
    [profileId, accountId]
  );
  if (membership.rows[0]?.role !== "owner") {
    res.status(403).json({ error: "Apenas o dono da conta pode excluir a conta inteira" });
    return;
  }

  const barbershops = await pool.query<{ id: string; stripe_subscription_id: string | null }>(
    "SELECT id, stripe_subscription_id FROM public.barbershops WHERE account_id = $1",
    [accountId]
  );
  for (const b of barbershops.rows) {
    await cancelStripeSubscription(b.stripe_subscription_id);
  }
  await pool.query("DELETE FROM public.barbershops WHERE account_id = $1", [accountId]);
  await pool.query("DELETE FROM public.account_memberships WHERE account_id = $1", [accountId]);
  await pool.query("DELETE FROM public.accounts WHERE id = $1", [accountId]);

  res.json({ deleted: true, redirect: "login" });
});
