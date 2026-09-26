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
