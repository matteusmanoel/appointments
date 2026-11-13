import { config } from "../config.js";
import { pool } from "../db.js";
import { sendAiUsageAlertEmail, type AiUsageAlertEmailParams } from "../lib/ses.js";

type Env = Record<string, string | undefined>;

/** Liga o aviso de uso da IA ao dono. PADRÃO DESLIGADO: sem AI_USAGE_ALERT_ENABLED=true nada é enviado. */
export function aiUsageAlertEnabled(env: Env = process.env): boolean {
  return (env.AI_USAGE_ALERT_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Percentual do limite que dispara o aviso (padrão 80; aceita 1–99). */
export function aiUsageAlertThresholdPct(env: Env = process.env): number {
  const n = parseInt(env.AI_USAGE_ALERT_THRESHOLD_PCT ?? "80", 10);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 80;
}

/** Regra pura: plano com limite > 0 e uso >= pct% do limite. (Plano sem IA, limite 0, nunca alerta.) */
export function usageReachedThreshold(used: number, limit: number, pct: number): boolean {
  if (!(limit > 0)) return false;
  return used >= Math.ceil((limit * pct) / 100);
}

/** Mês de referência (yyyy-mm, fuso de São Paulo) para o dedupe: um aviso por barbearia, por mês e por limiar. */
export function usagePeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

export type UsageAlertResult = "disabled" | "below" | "duplicate" | "no_recipient" | "sent" | "error";

/**
 * Avisa o dono (e-mail do admin) quando o uso mensal da IA chega a AI_USAGE_ALERT_THRESHOLD_PCT% (padrão 80%) do limite.
 * - Flag desligada: retorna "disabled" sem tocar o banco nem enviar nada.
 * - Dedupe: `ai_usage_alerts (barbershop_id, period, threshold_pct)` único → 1 aviso por mês.
 * - Nunca lança (o worker de IA não pode falhar por causa do aviso).
 */
export async function maybeAlertAiUsage(
  params: { barbershopId: string; used: number; limit: number },
  deps: { sender?: (p: AiUsageAlertEmailParams) => Promise<void>; env?: Env; now?: Date } = {},
): Promise<UsageAlertResult> {
  const env = deps.env ?? process.env;
  if (!aiUsageAlertEnabled(env)) return "disabled";
  const pct = aiUsageAlertThresholdPct(env);
  if (!usageReachedThreshold(params.used, params.limit, pct)) return "below";
  try {
    const claim = await pool.query(
      `INSERT INTO public.ai_usage_alerts (barbershop_id, period, threshold_pct) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [params.barbershopId, usagePeriod(deps.now), pct],
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
    await (deps.sender ?? sendAiUsageAlertEmail)({
      to: row.email,
      barbershopName: row.name,
      appUrl: config.appUrl,
      used: params.used,
      limit: params.limit,
      thresholdPct: pct,
    });
    return "sent";
  } catch (e) {
    console.warn("[ai-usage-alert] falha ao avisar o dono:", e instanceof Error ? e.message : e);
    return "error";
  }
}
