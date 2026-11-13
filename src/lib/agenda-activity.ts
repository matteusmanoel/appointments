export type OperationalActivityTone = "danger" | "warning" | "success";

type OperationalActivityMeta = {
  /** Short badge text. */
  label: string;
  /** Story text when the event has no summary. */
  fallback: string;
  tone: OperationalActivityTone;
};

/** Failure/observability events written by the workers (actor "system"). */
export const OPERATIONAL_ACTIVITY: Record<string, OperationalActivityMeta> = {
  send_failure: { label: "Não entregue", fallback: "Mensagem não entregue", tone: "danger" },
  agent_silenced: { label: "Revisar", fallback: "Agente silenciado — revisar conversa", tone: "warning" },
  agent_stuck: { label: "Agente travado", fallback: "Agente travou — cliente sem resposta", tone: "danger" },
  tool_error_escalated: { label: "Erro do agente", fallback: "Agente encontrou erros — revisar conversa", tone: "warning" },
  payment_sent: { label: "Cobrança", fallback: "Cobrança enviada", tone: "success" },
  payment_failed: { label: "Cobrança falhou", fallback: "Cobrança falhou", tone: "danger" },
};

export const OPERATIONAL_TONE_CLASS: Record<OperationalActivityTone, string> = {
  danger: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
};

export function operationalActivity(type: string): OperationalActivityMeta | null {
  return OPERATIONAL_ACTIVITY[type] ?? null;
}

export function operationalActivityText(type: string, summary: string | null | undefined): string | null {
  const meta = operationalActivity(type);
  if (!meta) return null;
  return summary?.trim() || meta.fallback;
}
