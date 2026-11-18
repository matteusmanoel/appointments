/** Antecedência mínima para cancelar ou reagendar pelo link público. */
export const MANAGE_CUTOFF_MINUTES = 120;

/**
 * Depois de marcar, o cliente ainda pode desfazer ou mudar o horário
 * mesmo que ele caia dentro das 2 horas. Passada essa janela, a antecedência volta a valer.
 */
export const FRESH_BOOKING_GRACE_MINUTES = 15;

export type ManageChangeBlock = "past" | "cutoff";

export function manageChangeBlock(input: {
  startMs: number;
  createdAtMs: number | null;
  nowMs: number;
}): ManageChangeBlock | null {
  const { startMs, createdAtMs, nowMs } = input;
  if (!Number.isFinite(startMs)) return null;
  if (startMs <= nowMs) return "past";
  const ageMs = createdAtMs == null || !Number.isFinite(createdAtMs) ? null : nowMs - createdAtMs;
  const fresh =
    ageMs != null && ageMs >= -2 * 60_000 && ageMs < FRESH_BOOKING_GRACE_MINUTES * 60_000;
  if (fresh) return null;
  if (startMs - nowMs < MANAGE_CUTOFF_MINUTES * 60_000) return "cutoff";
  return null;
}
