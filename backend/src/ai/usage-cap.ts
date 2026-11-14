import type { PoolClient } from "pg";
import { pool } from "../db.js";
import {
  aiUsageAlertEnabled,
  maybeAlertAiUsageHardCap,
  usagePeriod,
  type UsageAlertResult,
} from "./usage-alert.js";
import type { AiUsageAlertEmailParams } from "../lib/ses.js";

type Env = Record<string, string | undefined>;
type Queryable = Pick<PoolClient, "query">;

/** Texto da atividade/flag visível no inbox para a atendente. Nada disso vai ao cliente. */
export const IA_PAUSED_BY_LIMIT_REASON = "IA pausada por limite";

/**
 * Reserva (atômico) o registro do teto desta conversa neste mês. true = primeira vez; false = já gravado.
 * Passe o client da transação quando o claim precisar acompanhar os efeitos.
 */
export async function claimHardCapNotice(conversationId: string, period: string, exec: Queryable = pool): Promise<boolean> {
  const r = await exec.query(
    `INSERT INTO public.ai_hard_cap_notices (conversation_id, period) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING 1`,
    [conversationId, period],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Efeitos do teto na mesma transação do claim (lança para o caller dar ROLLBACK).
 * Nunca envia nada ao cliente.
 */
export async function markHardCapHumanFollowup(
  params: { barbershopId: string; conversationId: string; clientPhone?: string | null },
  exec: Queryable,
): Promise<void> {
  await exec.query(
    `UPDATE public.ai_conversations SET needs_human_followup = true, updated_at = now() WHERE id = $1`,
    [params.conversationId],
  );
  await exec.query(
    `INSERT INTO public.ai_handoff_events (barbershop_id, conversation_id, event_type, triggered_by, reason)
     VALUES ($1, $2, 'pending_review', 'auto', $3)`,
    [params.barbershopId, params.conversationId, IA_PAUSED_BY_LIMIT_REASON],
  );
  await exec.query(
    `INSERT INTO public.agenda_activity
       (barbershop_id, conversation_id, type, actor, client_phone, summary)
     VALUES ($1, $2, 'agent_silenced', 'system', $3, $4)`,
    [params.barbershopId, params.conversationId, params.clientPhone ?? null, IA_PAUSED_BY_LIMIT_REASON],
  );
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
 *  - reserva ai_hard_cap_notices e aplica os efeitos (needs_human_followup, handoff, atividade) numa transação;
 *    se algum efeito falhar, dá ROLLBACK (o claim não fica preso) e o próximo turno tenta de novo;
 *  - na primeira vez no mês, marca a conversa para acompanhamento («IA pausada por limite») no inbox da atendente.
 * AI_USAGE_ALERT_ENABLED desligado = silêncio e sem registro.
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
    const conv = await pool.query<{ is_sandbox: boolean; external_thread_id: string }>(
      `SELECT is_sandbox, external_thread_id FROM public.ai_conversations WHERE id = $1`,
      [params.conversationId],
    );
    if (conv.rows[0]?.is_sandbox !== false) return { reply: "", ownerAlert, event: "not_applicable" };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const first = await claimHardCapNotice(params.conversationId, usagePeriod(deps.now), client);
      if (!first) {
        await client.query("ROLLBACK");
        return { reply: "", ownerAlert, event: "already_recorded" };
      }
      await markHardCapHumanFollowup(
        {
          barbershopId: params.barbershopId,
          conversationId: params.conversationId,
          clientPhone: conv.rows[0]?.external_thread_id ?? null,
        },
        client,
      );
      await client.query("COMMIT");
      return { reply: "", ownerAlert, event: "recorded" };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.warn("[ai-usage-cap] falha ao registrar o teto (transação desfeita; cliente permanece em silêncio):", e instanceof Error ? e.message : e);
      return { reply: "", ownerAlert, event: "not_applicable" };
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn("[ai-usage-cap] falha ao registrar o teto (cliente permanece em silêncio):", e instanceof Error ? e.message : e);
    return { reply: "", ownerAlert, event: "not_applicable" };
  }
}
