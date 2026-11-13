export type WhatsAppSocketState = "disconnected" | "connecting" | "connected";

/** Only open a Baileys socket when there isn't one. Connecting/open + connectInstance = conflict/replaced. */
export function shouldOpenWhatsAppSocket(state: WhatsAppSocketState): boolean {
  return state === "disconnected";
}

/** Session was paired (DB connected) but Evolution socket died — restore from stored creds, no new QR flow from the panel. */
export function shouldRestoreDroppedSession(params: {
  dbStatus: WhatsAppSocketState;
  evolutionState: WhatsAppSocketState;
}): boolean {
  return params.dbStatus === "connected" && params.evolutionState === "disconnected";
}

const PROBE_BASE_MS = 45_000;
const PROBE_CAP_MS = 5 * 60_000;

/** How long to wait before asking Evolution again after it stopped answering. Doubles, caps at 5 min. */
export function evolutionProbeCooldownMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(PROBE_CAP_MS, PROBE_BASE_MS * 2 ** (consecutiveFailures - 1));
}

/** Skip the next probe while the cooldown from the last failure is still running. */
export function shouldSkipEvolutionProbe(consecutiveFailures: number, elapsedMs: number): boolean {
  if (consecutiveFailures <= 0) return false;
  return elapsedMs < evolutionProbeCooldownMs(consecutiveFailures);
}

export function webhookNeedsRepair(params: {
  enabled?: boolean | null;
  url?: string | null;
  expectedUrl: string;
  events?: string[] | null;
}): boolean {
  if (!params.enabled) return true;
  const current = (params.url ?? "").replace(/\/$/, "");
  const expected = params.expectedUrl.replace(/\/$/, "");
  if (!current || current !== expected) return true;
  const events = (params.events ?? []).map((e) => String(e).toUpperCase().replace(/-/g, "_"));
  const has = (name: string) => events.some((e) => e === name || e === name.replace("_", "."));
  return !has("MESSAGES_UPSERT") || !has("CONNECTION_UPDATE");
}
