import { pool } from "../db.js";

/** Message limits per billing_plan per month (outbound AI replies). */
const LIMITS: Record<string, number> = {
  essential: 0,
  pro: 500,
  premium: 2000,
};

export type UsageLimitResult = {
  used: number;
  limit: number;
  softExceeded: boolean;
  hardExceeded: boolean;
  billingPlan: string;
};

/**
 * Returns current month AI message usage and limit for the barbershop.
 * Soft = used >= limit, Hard = used >= 2 * limit.
 */
export async function getUsageAndLimit(barbershopId: string): Promise<UsageLimitResult> {
  const [countRow, planRow] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.ai_messages m
       JOIN public.ai_conversations c ON c.id = m.conversation_id
       WHERE c.barbershop_id = $1 AND c.is_sandbox = false
         AND m.created_at >= date_trunc('month', now()) AND m.role = 'assistant'`,
      [barbershopId]
    ),
    pool.query<{ billing_plan: string }>(
      `SELECT COALESCE(billing_plan, 'pro') AS billing_plan FROM public.barbershops WHERE id = $1`,
      [barbershopId]
    ),
  ]);
  const used = parseInt(countRow.rows[0]?.count ?? "0", 10);
  const plan = planRow.rows[0]?.billing_plan ?? "pro";
  const limit = LIMITS[plan] ?? LIMITS.pro;
  const softExceeded = limit > 0 && used >= limit;
  const hardExceeded = limit > 0 && used >= 2 * limit;
  return {
    used,
    limit,
    softExceeded,
    hardExceeded,
    billingPlan: plan,
  };
}
