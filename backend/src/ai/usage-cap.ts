import { pool } from "../db.js";
import {
  aiUsageAlertEnabled,
  maybeAlertAiUsageHardCap,
  usagePeriod,
  type UsageAlertResult,
} from "./usage-alert.js";
import type { AiUsageAlertEmailParams } from "../lib/ses.js";

type Env = Record<string, string | undefined>;

/**
 * TEXTO PADRÃO AGUARDANDO APROVAÇÃO DO MATEUS. Enquanto não houver aprovação, a copy abaixo é só um padrão neutro;
 * troque pela versão aprovada sem mexer no código, definindo AI_HARD_CAP_CUSTOMER_MESSAGE (Terraform: ai_hard_cap_customer_message).
 */
export const DEFAULT_HARD_CAP_CUSTOMER_MESSAGE = "No momento não consigo responder por aqui. A barbearia vai retornar em breve.";
const HARD_CAP_MESSAGE_MAX_LENGTH = 500;

/** Texto enviado ao cliente final no teto: AI_HARD_CAP_CUSTOMER_MESSAGE (até 500 caracteres) ou o padrão neutro. */
export function hardCapCustomerMessage(env: Env = process.env): string {
  const custom = (env.AI_HARD_CAP_CUSTOMER_MESSAGE ?? "").trim().slice(0, HARD_CAP_MESSAGE_MAX_LENGTH).trim();
  return custom || DEFAULT_HARD_CAP_CUSTOMER_MESSAGE;
}

/**
 * Reserva (atômico) o aviso do teto desta conversa neste mês. true = pode enviar; false = já enviado antes.
 * Gravado antes do envio para que mensagens simultâneas do cliente não gerem spam.
 */
export async function claimHardCapNotice(conversationId: string, period: string): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO public.ai_hard_cap_notices (conversation_id, period) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING 1`,
    [conversationId, period],
  );
  return (r.rowCount ?? 0) > 0;
}

export type HardCapTurn = {
  /** Texto a enviar ao cliente pelo caminho normal de resposta; "" = não enviar nada (silêncio). */
  reply: string;
  ownerAlert: UsageAlertResult;
  customerNotice: "to_send" | "already_sent" | "disabled" | "not_applicable";
};

/**
 * Turno no teto duro (uso >= 2x o limite). Antes: resposta "" e ninguém sabia. Agora:
 *  - avisa o dono por e-mail (1 por mês), mesmo canal e flag do aviso de 80% (AI_USAGE_ALERT_ENABLED);
 *  - devolve o texto curto ao cliente final na PRIMEIRA vez por conversa e mês; nas demais, "" (silêncio, sem spam).
 * Flag desligada = comportamento antigo (nada sai). Plano sem IA (limite 0) e conversa sandbox ficam em silêncio.
 * Nunca lança.
 */
export async function handleHardCapTurn(
  params: { barbershopId: string; conversationId: string; used: number; limit: number },
  deps: { sender?: (p: AiUsageAlertEmailParams) => Promise<void>; env?: Env; now?: Date; alertTimeoutMs?: number } = {},
): Promise<HardCapTurn> {
  const env = deps.env ?? process.env;
  if (!aiUsageAlertEnabled(env)) return { reply: "", ownerAlert: "disabled", customerNotice: "disabled" };
  if (!(params.limit > 0)) return { reply: "", ownerAlert: "below", customerNotice: "not_applicable" };

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
    if (conv.rows[0]?.is_sandbox !== false) return { reply: "", ownerAlert, customerNotice: "not_applicable" };
    const first = await claimHardCapNotice(params.conversationId, usagePeriod(deps.now));
    if (!first) return { reply: "", ownerAlert, customerNotice: "already_sent" };
    return { reply: hardCapCustomerMessage(env), ownerAlert, customerNotice: "to_send" };
  } catch (e) {
    console.warn("[ai-usage-cap] falha ao reservar o aviso ao cliente (fica em silêncio neste turno):", e instanceof Error ? e.message : e);
    return { reply: "", ownerAlert, customerNotice: "not_applicable" };
  }
}
