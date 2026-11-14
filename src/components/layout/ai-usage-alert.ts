/** Textos e regras do badge de uso de IA no painel admin (sem tela de Usage). */

export const AI_HARD_CAP_BADGE_TEXT =
  "Limite de IA atingido: o atendimento automático parou de responder seus clientes até o próximo ciclo. Responda manualmente ou faça upgrade.";

export type AiUsageAlertLevel = "hard_cap" | "threshold" | null;

export type AiUsageAlertInput = {
  used: number;
  limit: number;
  hardExceeded: boolean;
  thresholdExceeded?: boolean;
  thresholdPct?: number;
};

/** Percentual inteiro do limite já usado (0 quando não há limite). */
export function aiUsagePercent(used: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.min(100, Math.floor((used / limit) * 100));
}

export function aiThresholdBadgeText(used: number, limit: number): string {
  return `Uso de IA em ${aiUsagePercent(used, limit)}% do limite do plano este mês`;
}

/**
 * hard_cap só quando o teto do período foi atingido e o plano tem IA (limit > 0).
 * Aviso leve a partir do limiar (padrão 80%) ou quando thresholdExceeded vem da API.
 */
export function aiUsageAlertLevel(usage: AiUsageAlertInput): AiUsageAlertLevel {
  if (!(usage.limit > 0)) return null;
  if (usage.hardExceeded) return "hard_cap";
  if (usage.thresholdExceeded === true) return "threshold";
  const pct = usage.thresholdPct ?? 80;
  if (usage.used >= Math.ceil((usage.limit * pct) / 100)) return "threshold";
  return null;
}
