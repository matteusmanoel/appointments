/** A client turn is every user bubble since the last assistant reply, flushed after quiet. */

export const DEFAULT_INBOUND_QUIET_SECONDS = 8;

export function clampInboundQuietSeconds(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_INBOUND_QUIET_SECONDS;
  return Math.min(30, Math.max(3, Math.floor(raw)));
}

export function isUserTurnQuiet(params: {
  lastUserAtMs: number;
  nowMs: number;
  quietMs: number;
}): boolean {
  return params.nowMs >= params.lastUserAtMs + params.quietMs;
}

/** New bubble landed after the worker locked the job — do not send a half-turn reply. */
export function shouldDropReplyBecauseTurnGrew(params: {
  latestUserAtMs: number;
  jobLockedAtMs: number;
}): boolean {
  return params.latestUserAtMs > params.jobLockedAtMs;
}
