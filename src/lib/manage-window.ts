/** Espelho de backend/src/lib/manage-window.ts. A API é quem decide; a tela só evita o bloqueio à toa. */
export const MANAGE_CUTOFF_MINUTES = 120;
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
