import { pool } from "./db.js";
import { getUsageAndLimit } from "./ai/usage-limits.js";

/** Dias de tolerância depois de uma cobrança falhar (past_due) antes de pausar a IA e os envios. */
export function graceDays(env: Record<string, string | undefined> = process.env): number {
  const n = parseInt(env.BILLING_GRACE_DAYS ?? "7", 10);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}

export type SubscriptionAccess = {
  /** IA e envios automáticos liberados. */
  allowed: boolean;
  level: "ok" | "grace" | "blocked";
  /** Fim da tolerância (só em level="grace"). */
  graceEndsAt: Date | null;
  message: string | null;
};

type Input = {
  stripeSubscriptionId: string | null;
  status: string | null;
  statusChangedAt: Date | null;
  periodEnd: Date | null;
};

const OK_STATUSES = new Set(["active", "trialing"]);
const GRACE_STATUSES = new Set(["past_due", "incomplete", "unpaid"]);

/**
 * Regra (pura, testável):
 * - sem assinatura Stripe (cobrança manual/PIX/legado) → liberado;
 * - active/trialing → liberado;
 * - past_due/incomplete/unpaid → tolerância de `graceDays` a partir da mudança de status; depois, bloqueado;
 * - canceled/incomplete_expired → liberado até o fim do período já pago; depois, bloqueado.
 * O painel continua acessível: só a IA e os disparos automáticos pausam (o dono precisa conseguir pagar).
 */
export function evaluateSubscriptionAccess(input: Input, now: Date = new Date(), grace = graceDays()): SubscriptionAccess {
  if (!input.stripeSubscriptionId || !input.status || OK_STATUSES.has(input.status)) {
    return { allowed: true, level: "ok", graceEndsAt: null, message: null };
  }
  if (GRACE_STATUSES.has(input.status)) {
    const since = input.statusChangedAt ?? now;
    const end = new Date(since.getTime() + grace * 86_400_000);
    if (now < end) {
      return {
        allowed: true,
        level: "grace",
        graceEndsAt: end,
        message: `Não conseguimos cobrar sua assinatura. Atualize o pagamento até ${end.toLocaleDateString("pt-BR")} para não pausar o atendimento automático.`,
      };
    }
    return { allowed: false, level: "blocked", graceEndsAt: null, message: "Atendimento automático pausado por falta de pagamento. Atualize o pagamento para reativar." };
  }
  // canceled / incomplete_expired / outros
  if (input.periodEnd && now < input.periodEnd) {
    return {
      allowed: true,
      level: "grace",
      graceEndsAt: input.periodEnd,
      message: `Assinatura cancelada. O atendimento automático segue até ${input.periodEnd.toLocaleDateString("pt-BR")}.`,
    };
  }
  return { allowed: false, level: "blocked", graceEndsAt: null, message: "Assinatura cancelada. Reative o plano para voltar a usar o atendimento automático." };
}

/**
 * Linhas anteriores à migration de cobrança (past_due/canceled sem data de referência) não podem ficar com tolerância
 * eterna (`statusChangedAt ?? now` desliza a cada leitura) nem ser cortadas de surpresa (canceled sem fim de período
 * bloqueia na hora). Regra única, usada pela migration (SQL equivalente) e na leitura (idempotente, persiste uma vez):
 * - past_due/incomplete/unpaid sem `statusChangedAt` → começa a tolerância AGORA (`graceDays` completos);
 * - canceled/outros sem `periodEnd` → período de despedida de `graceDays` a partir de agora.
 */
export function planBackfill(input: Input, now: Date = new Date(), grace = graceDays()): { statusChangedAt?: Date; periodEnd?: Date } {
  if (!input.stripeSubscriptionId || !input.status || OK_STATUSES.has(input.status)) return {};
  if (GRACE_STATUSES.has(input.status)) return input.statusChangedAt ? {} : { statusChangedAt: now };
  return input.periodEnd ? {} : { periodEnd: new Date(now.getTime() + grace * 86_400_000) };
}

export async function getSubscriptionAccess(barbershopId: string): Promise<SubscriptionAccess> {
  try {
    const r = await pool.query<{
      stripe_subscription_id: string | null;
      subscription_status: string | null;
      subscription_status_changed_at: Date | null;
      subscription_current_period_end: Date | null;
    }>(
      `SELECT stripe_subscription_id, subscription_status, subscription_status_changed_at, subscription_current_period_end
       FROM public.barbershops WHERE id = $1`,
      [barbershopId],
    );
    const row = r.rows[0];
    if (!row) return { allowed: true, level: "ok", graceEndsAt: null, message: null };
    const input: Input = {
      stripeSubscriptionId: row.stripe_subscription_id,
      status: row.subscription_status,
      statusChangedAt: row.subscription_status_changed_at,
      periodEnd: row.subscription_current_period_end,
    };
    const fill = planBackfill(input);
    if (fill.statusChangedAt || fill.periodEnd) {
      // Persiste uma única vez (WHERE ... IS NULL): leituras seguintes veem a mesma data de referência.
      await pool
        .query(
          `UPDATE public.barbershops
           SET subscription_status_changed_at = COALESCE(subscription_status_changed_at, $2),
               subscription_current_period_end = COALESCE(subscription_current_period_end, $3)
           WHERE id = $1`,
          [barbershopId, fill.statusChangedAt ?? null, fill.periodEnd ?? null],
        )
        .catch(() => {});
      input.statusChangedAt = input.statusChangedAt ?? fill.statusChangedAt ?? null;
      input.periodEnd = input.periodEnd ?? fill.periodEnd ?? null;
    }
    return evaluateSubscriptionAccess(input);
  } catch (e) {
    // Colunas ausentes (migration pendente): não bloqueia ninguém por erro de infraestrutura.
    console.warn("[billing-access] indisponível; liberando:", e instanceof Error ? e.message : e);
    return { allowed: true, level: "ok", graceEndsAt: null, message: null };
  }
}

export type AiGateState = "subscription_blocked" | "hard_limit" | null;

/**
 * Porta única da IA: assinatura inativa ou limite do plano (Essencial = 0 → bloqueado). Vale para o agente nativo E
 * para o ramo n8n (NATIVE_AI_DISABLED), que antes passava sem nenhuma checagem.
 */
export async function aiGateState(barbershopId: string): Promise<AiGateState> {
  const access = await getSubscriptionAccess(barbershopId);
  if (!access.allowed) return "subscription_blocked";
  const usage = await getUsageAndLimit(barbershopId);
  return usage.hardExceeded ? "hard_limit" : null;
}
