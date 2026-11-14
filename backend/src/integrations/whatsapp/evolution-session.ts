import { evolutionInstanceNameFor } from "./provider-config.js";
import { pool } from "../../db.js";
import { config } from "../../config.js";
import { webhookErrorText } from "./webhook-auth.js";
import * as evo from "./evolution-client.js";
import { clearPairing, fetchPairing, peekPairing } from "./evolution-pairing.js";
import type {
  ConnectResult,
  ConnectionRow,
  SendLocationParams,
  SendResult,
  StatusResult,
  WhatsAppSession,
} from "./types.js";

function instanceNameFor(barbershopId: string, existing: string | null): string {
  return evolutionInstanceNameFor(barbershopId, existing);
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
    return { webhook_set: false, webhook_warning: webhookErrorText(e) };
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

    return this.openSocket(name, opts?.phone);
  }

  private async openSocket(name: string, phone?: string): Promise<ConnectResult> {
    const live = evo.mapEvolutionState(await evo.connectionState(name).catch(() => null));
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET evolution_instance_name = $1, updated_at = now()
       WHERE barbershop_id = $2 AND provider = 'evolution'`,
      [name, this.barbershopId],
    );

    if (live === "connected") {
      clearPairing(name);
      const hook = await ensureWebhookAndSettings(name);
      await persistEvolutionSocketState(this.barbershopId, "connected", {
        lastError: hook.webhook_warning ?? null,
      });
      return { status: "connected", webhook_set: hook.webhook_set, webhook_warning: hook.webhook_warning };
    }

    await persistEvolutionSocketState(this.barbershopId, "connecting");
    const pairing = await fetchPairing(name, phone);
    const hook = await ensureWebhookAndSettings(name);
    await persistEvolutionSocketState(this.barbershopId, "connecting", {
      lastError: hook.webhook_warning ?? null,
    });
    return {
      status: "connecting",
      qr: pairing.qr,
      pairingCode: pairing.pairingCode,
      webhook_set: hook.webhook_set,
      webhook_warning: hook.webhook_warning,
    };
  }

  async status(): Promise<StatusResult> {
    let live: "disconnected" | "connecting" | "connected" = "disconnected";
    let liveKnown = false;
    try {
      live = evo.mapEvolutionState(await evo.connectionState(this.instanceName, 8_000));
      liveKnown = true;
    } catch {
      // Sem resposta da Evolution, mantém o último estado gravado. Não promove "conectado".
      live = this.row.status === "connected" ? "connected" : "disconnected";
    }
    if (liveKnown && live !== this.row.status) {
      await persistEvolutionSocketState(this.barbershopId, live);
    }
    if (live === "connected") {
      clearPairing(this.instanceName);
      if (this.row.status !== "connected") {
        await persistEvolutionSocketState(this.barbershopId, "connected");
      }
      void ensureWebhookAndSettings(this.instanceName).catch(() => {});
      return { status: "connected", connected: true, phone: this.row.whatsapp_phone };
    }
    if (this.row.status !== "connecting") {
      return { status: "disconnected", connected: false, phone: this.row.whatsapp_phone };
    }
    const pairing = peekPairing(this.instanceName) ?? {};
    return {
      status: "connecting",
      connected: false,
      qr: pairing.qr,
      pairingCode: pairing.pairingCode,
      phone: this.row.whatsapp_phone,
    };
  }

  async disconnect(): Promise<void> {
    clearPairing(this.instanceName);
    try {
      await evo.logoutInstance(this.instanceName);
    } catch (e) {
      // A sessão local precisa fechar mesmo se a Evolution estiver fora (stack incompleta ou instância já caída).
      console.warn(
        "[evolution] logout indisponível, conexão local encerrada:",
        e instanceof Error ? e.message : e,
      );
    }
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = 'disconnected', disconnected_at = now(), updated_at = now()
       WHERE barbershop_id = $1 AND provider = 'evolution'`,
      [this.barbershopId],
    );
  }
}
