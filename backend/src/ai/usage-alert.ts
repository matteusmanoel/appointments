import { config } from "../config.js";
import { pool } from "../db.js";
import { sendAiUsageAlertEmail, type AiUsageAlertEmailParams } from "../lib/ses.js";

type Env = Record<string, string | undefined>;

/** Liga o aviso de uso da IA ao dono. PADRÃO LIGADO (B-06). Desliga com AI_USAGE_ALERT_ENABLED=false (opt-out global). */
export function aiUsageAlertEnabled(env: Env = process.env): boolean {
  const raw = (env.AI_USAGE_ALERT_ENABLED ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
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

/** Cache por processo dos (barbearia, mês, limiar) já resolvidos: evita uma consulta por turno depois do limiar. */
const resolved = new Set<string>();

/** Só para testes. */
export function resetUsageAlertCacheForTests(): void {
  resolved.clear();
}

/**
 * Avisa o dono (e-mail do admin) quando o uso mensal da IA chega a AI_USAGE_ALERT_THRESHOLD_PCT% (padrão 80%) do limite.
 * - Flag desligada (AI_USAGE_ALERT_ENABLED=false): retorna "disabled" sem tocar o banco nem enviar nada.
 * - DEDUPE SÓ DEPOIS DO ENVIO: `ai_usage_alerts (barbershop_id, period, threshold_pct)` só recebe a linha quando o e-mail
 *   saiu. Falha do SES, `FROM_EMAIL` ausente (o envio lança) e dono sem e-mail não consomem o aviso do mês: o próximo
 *   turno tenta de novo. Execuções concorrentes são serializadas por advisory lock transacional (segunda = "duplicate").
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
  const period = usagePeriod(deps.now);
  const cacheKey = `${params.barbershopId}:${period}:${pct}`;
  if (resolved.has(cacheKey)) return "duplicate";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok", [`ai_usage_alert:${cacheKey}`]);
    if (!lock.rows[0]?.ok) {
      await client.query("ROLLBACK");
      return "duplicate";
    }
    const done = await client.query(
      `SELECT 1 FROM public.ai_usage_alerts WHERE barbershop_id = $1 AND period = $2 AND threshold_pct = $3`,
      [params.barbershopId, period, pct],
    );
    if ((done.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      resolved.add(cacheKey);
      return "duplicate";
    }
    const r = await client.query<{ name: string; email: string | null }>(
      `SELECT b.name,
              (SELECT p.email FROM public.profiles p
                WHERE p.barbershop_id = b.id AND p.role = 'admin' AND p.email IS NOT NULL
                ORDER BY p.created_at ASC LIMIT 1) AS email
       FROM public.barbershops b WHERE b.id = $1`,
      [params.barbershopId],
    );
    const row = r.rows[0];
    if (!row?.email) {
      await client.query("ROLLBACK"); // nada consumido: se um admin com e-mail aparecer, o próximo turno avisa
      return "no_recipient";
    }
    await (deps.sender ?? sendAiUsageAlertEmail)({
      to: row.email,
      barbershopName: row.name,
      appUrl: config.appUrl,
      used: params.used,
      limit: params.limit,
      thresholdPct: pct,
    });
    await client.query(
      `INSERT INTO public.ai_usage_alerts (barbershop_id, period, threshold_pct) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [params.barbershopId, period, pct],
    );
    await client.query("COMMIT");
    resolved.add(cacheKey);
    return "sent";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.warn("[ai-usage-alert] falha ao avisar o dono (aviso do mês não consumido; será tentado de novo):", e instanceof Error ? e.message : e);
    return "error";
  } finally {
    client.release();
  }
}
