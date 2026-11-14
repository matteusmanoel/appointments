/** Flag/atividade no inbox quando o teto de IA foi atingido nesta conversa. Não vai ao cliente. */
export const IA_PAUSED_BY_LIMIT_LABEL = "IA pausada por limite";

export function conversationNeedsHardCapFollowup(c: { needs_human_followup?: boolean | null } | null | undefined): boolean {
  return c?.needs_human_followup === true;
}
