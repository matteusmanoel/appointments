import { pool } from "./db.js";

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
    return evaluateSubscriptionAccess({
      stripeSubscriptionId: row.stripe_subscription_id,
      status: row.subscription_status,
      statusChangedAt: row.subscription_status_changed_at,
      periodEnd: row.subscription_current_period_end,
    });
  } catch (e) {
    // Colunas ausentes (migration pendente): não bloqueia ninguém por erro de infraestrutura.
    console.warn("[billing-access] indisponível; liberando:", e instanceof Error ? e.message : e);
    return { allowed: true, level: "ok", graceEndsAt: null, message: null };
  }
}
