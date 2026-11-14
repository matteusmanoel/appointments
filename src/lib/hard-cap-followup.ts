/** Flag/atividade no inbox quando o teto de IA foi atingido nesta conversa no mês atual. Não vai ao cliente. */
export const IA_PAUSED_BY_LIMIT_LABEL = "IA pausada por limite";

export function conversationNeedsHardCapFollowup(
  c: { ia_paused_by_limit?: boolean | null; needs_human_followup?: boolean | null } | null | undefined,
): boolean {
  return c?.ia_paused_by_limit === true;
}
