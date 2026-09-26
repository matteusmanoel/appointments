import { pool } from "../../db.js";
import * as evo from "./evolution-client.js";
import { evolutionWebhookUrl, persistEvolutionSocketState } from "./evolution-session.js";
import { shouldOpenWhatsAppSocket, shouldRestoreDroppedSession, webhookNeedsRepair } from "./evolution-policy.js";

const INTERVAL_MS = 20_000;
const RESTORE_COOLDOWN_MS = 45_000;
const lastRestoreAt = new Map<string, number>();

function parseWebhookFind(raw: unknown): {
  enabled?: boolean | null;
  url?: string | null;
  events?: string[] | null;
} {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const nested =
    obj.webhook && typeof obj.webhook === "object" ? (obj.webhook as Record<string, unknown>) : obj;
  const enabledRaw = nested.enabled ?? nested.enable ?? obj.enabled;
  const url = nested.url ?? nested.webhookUrl ?? obj.url;
  const events = nested.events ?? obj.events;
  return {
    enabled: enabledRaw === true || enabledRaw === "true" || enabledRaw === 1,
    url: typeof url === "string" ? url : null,
    events: Array.isArray(events) ? events.map(String) : null,
  };
}

async function repairWebhook(instanceName: string, expectedUrl: string): Promise<void> {
  let found: unknown = null;
  try {
    found = await evo.findInstanceWebhook(instanceName);
  } catch {
    found = null;
  }
  const parsed = parseWebhookFind(found);
  if (!webhookNeedsRepair({ ...parsed, expectedUrl })) return;
  await evo.setInstanceWebhook(instanceName, expectedUrl);
  try {
    await evo.setInstanceSettings(instanceName);
  } catch {
    // alwaysOnline is best-effort
  }
}

const restoreFailures = new Map<string, number>();

function restoreCooldownMs(instanceName: string): number {
  const failures = restoreFailures.get(instanceName) ?? 0;
  return Math.min(5 * 60_000, RESTORE_COOLDOWN_MS * 2 ** failures);
}

async function restoreSocket(
  instanceName: string,
): Promise<"open" | "qr" | "pending" | "skipped"> {
  const now = Date.now();
  const prev = lastRestoreAt.get(instanceName) ?? 0;
  if (now - prev < restoreCooldownMs(instanceName)) return "skipped";
  lastRestoreAt.set(instanceName, now);
  try {
    const liveNow = evo.mapEvolutionState(await evo.connectionState(instanceName).catch(() => null));
    if (!shouldOpenWhatsAppSocket(liveNow)) {
      return liveNow === "connected" ? "open" : "pending";
    }
    await new Promise((r) => setTimeout(r, 4000));
    const liveWait = evo.mapEvolutionState(await evo.connectionState(instanceName).catch(() => null));
    if (!shouldOpenWhatsAppSocket(liveWait)) {
      return liveWait === "connected" ? "open" : "pending";
    }
    const raw = await evo.connectInstance(instanceName);
    const { qr } = evo.extractQr(raw);
    const live = evo.mapEvolutionState(raw);
    if (qr) return "qr";
    if (live === "connected") return "open";
    return "pending";
  } catch (e) {
    restoreFailures.set(instanceName, (restoreFailures.get(instanceName) ?? 0) + 1);
    console.warn("[evolution keepalive] restoreSocket %s:", instanceName, e instanceof Error ? e.message : e);
    return "pending";
  }
}

async function keepOne(row: {
  barbershop_id: string;
  evolution_instance_name: string;
  status: "disconnected" | "connecting" | "connected";
}): Promise<void> {
  const name = row.evolution_instance_name;
  let expectedUrl: string;
  try {
    expectedUrl = evolutionWebhookUrl();
  } catch (e) {
    console.warn("[evolution keepalive] webhook URL missing:", e instanceof Error ? e.message : e);
    return;
  }

  let live: "disconnected" | "connecting" | "connected" = "disconnected";
  try {
    live = evo.mapEvolutionState(await evo.connectionState(name));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/404|not found|does not exist/i.test(msg)) {
      console.warn("[evolution keepalive] connectionState %s:", name, msg);
      return;
    }
  }

  if (live === "connected") {
    restoreFailures.delete(name);
    if (row.status !== "connected") {
      await persistEvolutionSocketState(row.barbershop_id, "connected");
    }
    try {
      await repairWebhook(name, expectedUrl);
    } catch (e) {
      console.warn(
        "[evolution keepalive] webhook repair %s:",
        name,
        e instanceof Error ? e.message : e,
      );
    }
    return;
  }

  if (shouldRestoreDroppedSession({ dbStatus: row.status, evolutionState: live })) {
    console.info("[evolution keepalive] restoring dropped session instance=%s", name);
    try {
      const outcome = await restoreSocket(name);
      if (outcome === "skipped") return;
      if (outcome === "open") {
        restoreFailures.delete(name);
        await persistEvolutionSocketState(row.barbershop_id, "connected");
        await repairWebhook(name, expectedUrl);
        return;
      }
      if (outcome === "qr") {
        restoreFailures.set(name, 8);
        lastRestoreAt.set(name, Date.now());
        console.warn(
          "[evolution keepalive] session creds lost instance=%s — scan QR in the panel (Conectar)",
          name,
        );
        await persistEvolutionSocketState(row.barbershop_id, "connecting");
        return;
      }
      restoreFailures.set(name, (restoreFailures.get(name) ?? 0) + 1);
      await repairWebhook(name, expectedUrl);
    } catch (e) {
      restoreFailures.set(name, (restoreFailures.get(name) ?? 0) + 1);
      console.warn("[evolution keepalive] restore %s:", name, e instanceof Error ? e.message : e);
    }
  }
}

async function tick(): Promise<void> {
  if (!process.env.EVOLUTION_API_URL) return;
  const { rows } = await pool.query<{
    barbershop_id: string;
    evolution_instance_name: string;
    status: "disconnected" | "connecting" | "connected";
  }>(
    `SELECT barbershop_id, evolution_instance_name, status
     FROM public.barbershop_whatsapp_connections
     WHERE provider = 'evolution'
       AND evolution_instance_name IS NOT NULL
       AND evolution_instance_name <> ''`,
  );
  for (const row of rows) {
    try {
      await keepOne(row);
    } catch (e) {
      console.warn(
        "[evolution keepalive] instance=%s:",
        row.evolution_instance_name,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export function startEvolutionKeepalive(): void {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  if (!process.env.EVOLUTION_API_URL) return;
  console.log("[evolution keepalive] started (every %ss)", INTERVAL_MS / 1000);
  void tick().catch((e) => console.warn("[evolution keepalive] tick:", e));
  setInterval(() => {
    void tick().catch((e) => console.warn("[evolution keepalive] tick:", e));
  }, INTERVAL_MS);
}
