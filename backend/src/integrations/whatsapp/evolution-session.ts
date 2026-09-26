import { pool } from "../../db.js";
import { config } from "../../config.js";
import * as evo from "./evolution-client.js";
import { shouldOpenWhatsAppSocket } from "./evolution-policy.js";
import type {
  ConnectResult,
  ConnectionRow,
  SendLocationParams,
  SendResult,
  StatusResult,
  WhatsAppSession,
} from "./types.js";

function instanceNameFor(barbershopId: string, existing: string | null): string {
  if (existing && existing.trim()) return existing.trim();
  const compact = barbershopId.replace(/-/g, "").slice(0, 16);
  return `nh-${compact}`;
}

export function evolutionWebhookUrl(): string {
  const dedicated = (process.env.EVOLUTION_WEBHOOK_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (dedicated) return dedicated;
  const app = (config.appUrl ?? "").replace(/\/$/, "");
  if (app.includes("localhost") || !app) {
    throw new Error("EVOLUTION_WEBHOOK_PUBLIC_URL is required (public URL of POST /api/webhooks/evolution)");
  }
  return `${app.replace(/:\d+$/, "")}/api/webhooks/evolution`;
}

export async function persistEvolutionSocketState(
  barbershopId: string,
  status: "disconnected" | "connecting" | "connected",
  extra?: { lastError?: string | null; phone?: string | null },
): Promise<void> {
  await pool.query(
    `UPDATE public.barbershop_whatsapp_connections
     SET status = $1,
         connected_at = CASE WHEN $1 = 'connected' THEN COALESCE(connected_at, now()) ELSE connected_at END,
         disconnected_at = CASE WHEN $1 = 'disconnected' THEN now() ELSE disconnected_at END,
         last_error = COALESCE($3, last_error),
         whatsapp_phone = COALESCE($4, whatsapp_phone),
         updated_at = now()
     WHERE barbershop_id = $2 AND provider = 'evolution'`,
    [status, barbershopId, extra?.lastError ?? null, extra?.phone ?? null],
  );
}

async function ensureWebhookAndSettings(instanceName: string): Promise<{ webhook_set: boolean; webhook_warning?: string }> {
  const url = evolutionWebhookUrl();
  try {
    await evo.setInstanceWebhook(instanceName, url);
  } catch (e) {
    return { webhook_set: false, webhook_warning: e instanceof Error ? e.message : String(e) };
  }
  try {
    await evo.setInstanceSettings(instanceName);
  } catch {
    // settings are best-effort (alwaysOnline)
  }
  return { webhook_set: true };
}

export class EvolutionSession implements WhatsAppSession {
  readonly provider = "evolution" as const;

  constructor(
    private readonly barbershopId: string,
    private instanceName: string,
    private readonly row: ConnectionRow,
  ) {}

  async sendText(to: string, text: string): Promise<SendResult> {
    const sent = await evo.sendText(this.instanceName, to, text);
    return { providerMessageId: evo.extractEvolutionMessageId(sent) ?? `evolution-${Date.now()}` };
  }

  async sendLocation(to: string, params: SendLocationParams): Promise<SendResult> {
    const sent = await evo.sendLocation(this.instanceName, {
      number: to,
      name: params.name,
      address: params.address,
      latitude: params.lat,
      longitude: params.lng,
    });
    return { providerMessageId: evo.extractEvolutionMessageId(sent) ?? `evolution-${Date.now()}` };
  }

  async sendSticker(to: string, url: string): Promise<SendResult> {
    const sent = await evo.sendSticker(this.instanceName, to, url);
    return { providerMessageId: evo.extractEvolutionMessageId(sent) ?? `evolution-${Date.now()}` };
  }

  async connect(opts?: { phone?: string }): Promise<ConnectResult> {
    const name = instanceNameFor(this.barbershopId, this.instanceName);
    this.instanceName = name;

    try {
      await evo.createInstance(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already|exist|409|403/i.test(msg)) {
        if (!/400|422/.test(msg)) throw e;
      }
    }

    const hook = await ensureWebhookAndSettings(name);
    let live = evo.mapEvolutionState(await evo.connectionState(name).catch(() => null));

    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET evolution_instance_name = $1, last_error = $2, updated_at = now()
       WHERE barbershop_id = $3 AND provider = 'evolution'`,
      [name, hook.webhook_warning ?? null, this.barbershopId],
    );

    if (!shouldOpenWhatsAppSocket(live)) {
      if (live === "connected") {
        await persistEvolutionSocketState(this.barbershopId, "connected");
      } else {
        await persistEvolutionSocketState(this.barbershopId, "connecting");
      }
      return {
        status: live === "connected" ? "connected" : "connecting",
        webhook_set: hook.webhook_set,
        webhook_warning: hook.webhook_warning,
      };
    }

    await persistEvolutionSocketState(this.barbershopId, "connecting");
    const raw = await evo.connectInstance(name, opts?.phone);
    const { qr, pairingCode } = evo.extractQr(raw);
    live = evo.mapEvolutionState(raw);
    const status = live === "connected" ? "connected" : "connecting";
    await persistEvolutionSocketState(this.barbershopId, status);
    return { status, qr, pairingCode, webhook_set: hook.webhook_set, webhook_warning: hook.webhook_warning };
  }

  async status(): Promise<StatusResult> {
    try {
      const raw = await evo.connectionState(this.instanceName);
      const live = evo.mapEvolutionState(raw);
      if (live === "connected") {
        if (this.row.status !== "connected") {
          await persistEvolutionSocketState(this.barbershopId, "connected");
        }
        void ensureWebhookAndSettings(this.instanceName).catch(() => {});
      } else if (live === "connecting" && this.row.status !== "connected") {
        if (this.row.status !== "connecting") {
          await persistEvolutionSocketState(this.barbershopId, "connecting");
        }
      }
      const status = this.row.status === "connected" ? "connected" : live;
      return {
        status,
        connected: live === "connected",
        qr: undefined,
        pairingCode: undefined,
        phone: this.row.whatsapp_phone,
      };
    } catch {
      return { status: this.row.status, connected: this.row.status === "connected", phone: this.row.whatsapp_phone };
    }
  }

  async disconnect(): Promise<void> {
    try {
      await evo.logoutInstance(this.instanceName);
    } finally {
      await pool.query(
        `UPDATE public.barbershop_whatsapp_connections
         SET status = 'disconnected', disconnected_at = now(), updated_at = now()
         WHERE barbershop_id = $1 AND provider = 'evolution'`,
        [this.barbershopId],
      );
    }
  }
}
