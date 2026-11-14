import { pool } from "../db.js";
import { recordOperationalActivity } from "../agenda/record-operational-activity.js";
import {
  aiUsageAlertEnabled,
  maybeAlertAiUsageHardCap,
  usagePeriod,
  type UsageAlertResult,
} from "./usage-alert.js";
import type { AiUsageAlertEmailParams } from "../lib/ses.js";

type Env = Record<string, string | undefined>;

/** Texto da atividade/flag visível no inbox para a atendente. Nada disso vai ao cliente. */
export const IA_PAUSED_BY_LIMIT_REASON = "IA pausada por limite";

/**
 * Reserva (atômico) o registro do teto desta conversa neste mês. true = primeira vez; false = já gravado.
 * Só serve de histórico operacional (o cliente final não recebe mensagem).
 */
export async function claimHardCapNotice(conversationId: string, period: string): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO public.ai_hard_cap_notices (conversation_id, period) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING 1`,
    [conversationId, period],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Marca a conversa para acompanhamento humano (1× por conversa/mês, depois do claim).
 * Nunca lança; o cliente permanece em silêncio.
 */
export async function markHardCapHumanFollowup(params: { barbershopId: string; conversationId: string }): Promise<void> {
  try {
    await pool.query(
      `UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`,
      [params.conversationId],
    );
  } catch (e) {
    console.warn("[ai-usage-cap] falha ao marcar needs_human_followup:", e instanceof Error ? e.message : e);
  }
  try {
    await pool.query(
      `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
       VALUES ($1, $2, 'pending_review', 'auto', $3)`,
      [params.barbershopId, params.conversationId, IA_PAUSED_BY_LIMIT_REASON],
    );
  } catch (e) {
    console.warn("[ai-usage-cap] falha ao registrar handoff do teto:", e instanceof Error ? e.message : e);
  }
  try {
    const conv = await pool.query<{ external_thread_id: string }>(
      `SELECT external_thread_id FROM public.ai_conversations WHERE id = $1`,
      [params.conversationId],
    );
    await recordOperationalActivity({
      barbershopId: params.barbershopId,
      conversationId: params.conversationId,
      clientPhone: conv.rows[0]?.external_thread_id ?? null,
      type: "agent_silenced",
      summary: IA_PAUSED_BY_LIMIT_REASON,
    });
  } catch (e) {
    console.warn("[ai-usage-cap] falha ao registrar atividade do teto:", e instanceof Error ? e.message : e);
  }
}

export type HardCapTurn = {
  /** Sempre "" — no teto o agente fica em silêncio com o cliente (nada que denuncie IA/robô). */
  reply: string;
  ownerAlert: UsageAlertResult;
  event: "recorded" | "already_recorded" | "disabled" | "not_applicable";
};

/**
 * Turno no teto duro (uso >= 2x o limite). O cliente final nunca recebe mensagem:
 *  - avisa o dono por e-mail (1 por mês) só com AI_USAGE_OWNER_EMAIL_ENABLED=true (desligado por padrão);
 *  - registra o evento em ai_hard_cap_notices (1 por conversa e mês) quando AI_USAGE_ALERT_ENABLED está ligado;
 *  - na primeira vez no mês, marca a conversa para acompanhamento («IA pausada por limite») no inbox da atendente.
 * AI_USAGE_ALERT_ENABLED desligado = silêncio e sem registro (o e-mail, se o outro flag estiver ligado, não sai por este caminho).
 * Plano sem IA (limite 0) e conversa sandbox ficam em silêncio e não registram.
 * Nunca lança.
 */
export async function handleHardCapTurn(
  params: { barbershopId: string; conversationId: string; used: number; limit: number },
  deps: { sender?: (p: AiUsageAlertEmailParams) => Promise<void>; env?: Env; now?: Date; alertTimeoutMs?: number } = {},
): Promise<HardCapTurn> {
  const env = deps.env ?? process.env;
  if (!aiUsageAlertEnabled(env)) return { reply: "", ownerAlert: "disabled", event: "disabled" };
  if (!(params.limit > 0)) return { reply: "", ownerAlert: "below", event: "not_applicable" };

  // AGUARDADO com teto (um `void` solto podia ser congelado pelo fim do ciclo da Lambda no meio do envio).
  const ownerAlert = await Promise.race([
    maybeAlertAiUsageHardCap(
      { barbershopId: params.barbershopId, used: params.used, limit: params.limit },
      { sender: deps.sender, env, now: deps.now },
    ),
    new Promise<UsageAlertResult>((resolve) => setTimeout(() => resolve("error"), deps.alertTimeoutMs ?? 3000).unref?.()),
  ]);

  try {
    const conv = await pool.query<{ is_sandbox: boolean }>(`SELECT is_sandbox FROM public.ai_conversations WHERE id = $1`, [
      params.conversationId,
    ]);
    if (conv.rows[0]?.is_sandbox !== false) return { reply: "", ownerAlert, event: "not_applicable" };
    const first = await claimHardCapNotice(params.conversationId, usagePeriod(deps.now));
    if (!first) return { reply: "", ownerAlert, event: "already_recorded" };
    await markHardCapHumanFollowup({ barbershopId: params.barbershopId, conversationId: params.conversationId });
    return { reply: "", ownerAlert, event: "recorded" };
  } catch (e) {
    console.warn("[ai-usage-cap] falha ao registrar o teto (cliente permanece em silêncio):", e instanceof Error ? e.message : e);
    return { reply: "", ownerAlert, event: "not_applicable" };
  }
}
