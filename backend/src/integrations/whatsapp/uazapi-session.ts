import {
  adminCreateInstance,
  instanceConnect,
  instanceDisconnect,
  instanceStatus,
  sendLocation as uazapiSendLocation,
  sendPixRequest,
  sendSticker as uazapiSendSticker,
  sendText as uazapiSendText,
  setWebhook,
} from "../uazapi/client.js";
import type { InstanceStatusResult } from "../uazapi/client.js";
import { encrypt } from "../encryption.js";
import { pool } from "../../db.js";
import { config } from "../../config.js";
import type {
  ConnectResult,
  ConnectionRow,
  SendLocationParams,
  SendResult,
  StatusResult,
  WhatsAppSession,
} from "./types.js";

function mapUazapiState(
  raw: InstanceStatusResult | undefined,
  fallback: StatusResult["status"],
): StatusResult["status"] {
  if (!raw) return fallback;
  const valid = new Set(["disconnected", "connecting", "connected"]);
  if (raw.instance && typeof raw.instance === "object") {
    const s = (raw.instance as Record<string, unknown>).status;
    if (typeof s === "string" && valid.has(s)) return s as StatusResult["status"];
  }
  if (typeof raw.state === "string" && valid.has(raw.state)) return raw.state as StatusResult["status"];
  if (typeof raw.status === "string" && valid.has(raw.status)) return raw.status as StatusResult["status"];
  if (raw.status && typeof raw.status === "object" && "connected" in (raw.status as Record<string, unknown>)) {
    return Boolean((raw.status as Record<string, unknown>).connected) ? "connected" : "disconnected";
  }
  return fallback;
}

function extractQr(raw: InstanceStatusResult | undefined): { qr?: string; pairingCode?: string } {
  if (!raw) return {};
  const inst = raw.instance;
  const qr = (typeof inst?.qrcode === "string" && inst.qrcode) || (typeof raw.qr === "string" ? raw.qr : undefined);
  const pairingCode =
    (typeof inst?.paircode === "string" && inst.paircode) ||
    (typeof raw.pairingCode === "string" ? raw.pairingCode : undefined);
  return { qr, pairingCode };
}

function extractMessageId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return `uazapi-${Date.now()}`;
  const any = payload as Record<string, unknown>;
  const candidates = [
    any.id,
    any.messageId,
    any.message_id,
    any.key && typeof any.key === "object" ? (any.key as Record<string, unknown>).id : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return `uazapi-${Date.now()}`;
}

export class UazapiSession implements WhatsAppSession {
  readonly provider = "uazapi" as const;

  constructor(
    private readonly barbershopId: string,
    private token: string,
    private readonly row: ConnectionRow,
  ) {}

  async sendText(to: string, text: string): Promise<SendResult> {
    const sent = await uazapiSendText({ token: this.token, number: to, text });
    return { providerMessageId: extractMessageId(sent) };
  }

  async sendLocation(to: string, params: SendLocationParams): Promise<SendResult> {
    const sent = await uazapiSendLocation({
      token: this.token,
      number: to,
      name: params.name,
      address: params.address,
      latitude: params.lat,
      longitude: params.lng,
    });
    return { providerMessageId: extractMessageId(sent) };
  }

  async sendSticker(to: string, url: string): Promise<SendResult> {
    const sent = await uazapiSendSticker({ token: this.token, number: to, url });
    return { providerMessageId: extractMessageId(sent) };
  }

  async sendPixRequest(params: {
    to: string;
    amount: number;
    description: string;
    pixKey: string;
    name: string;
    city: string;
  }): Promise<void> {
    await sendPixRequest({
      token: this.token,
      number: params.to,
      amount: params.amount,
      description: params.description,
      pixKey: params.pixKey,
      name: params.name,
      city: params.city,
    });
  }

  async connect(opts?: { phone?: string }): Promise<ConnectResult> {
    const webhookUrl = config.uazapiWebhookPublicUrl;
    let webhook_set = false;
    let webhook_warning: string | undefined;
    if (webhookUrl) {
      try {
        await setWebhook({ token: this.token, url: webhookUrl });
        webhook_set = true;
      } catch (e) {
        webhook_warning = e instanceof Error ? e.message : String(e);
        if (config.uazapiRequireWebhook) throw e;
      }
    }
    const raw = (await instanceConnect({
      token: this.token,
      phone: opts?.phone,
    })) as InstanceStatusResult;
    const status = mapUazapiState(raw, "connecting");
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = $1, last_error = $2, updated_at = now(),
           connected_at = CASE WHEN $1 = 'connected' THEN COALESCE(connected_at, now()) ELSE connected_at END
       WHERE barbershop_id = $3 AND provider = 'uazapi'`,
      [status, webhook_warning ?? null, this.barbershopId],
    );
    const { qr, pairingCode } = extractQr(raw);
    return { status, qr, pairingCode, webhook_set, webhook_warning };
  }

  async status(): Promise<StatusResult> {
    const raw = await instanceStatus(this.token);
    const status = mapUazapiState(raw, this.row.status);
    const { qr, pairingCode } = extractQr(raw);
    return { status, connected: status === "connected", qr, pairingCode, phone: this.row.whatsapp_phone };
  }

  async disconnect(): Promise<void> {
    await instanceDisconnect(this.token);
    await pool.query(
      `UPDATE public.barbershop_whatsapp_connections
       SET status = 'disconnected', disconnected_at = now(), updated_at = now()
       WHERE barbershop_id = $1 AND provider = 'uazapi'`,
      [this.barbershopId],
    );
  }
}

export async function createUazapiToken(barbershopId: string, instanceName: string): Promise<{ token: string; instanceId?: string }> {
  const created = await adminCreateInstance({
    name: instanceName,
    adminField01: barbershopId,
  });
  const encKey = config.appEncryptionKey;
  if (!encKey) throw new Error("APP_ENCRYPTION_KEY is required for WhatsApp connection");
  const encrypted = encrypt(created.token, encKey);
  const instanceId = created.name ?? created.token?.slice(0, 12);
  await pool.query(
    `INSERT INTO public.barbershop_whatsapp_connections
       (barbershop_id, provider, uazapi_instance_name, uazapi_instance_id, uazapi_instance_token_encrypted, status, updated_at)
     VALUES ($1, 'uazapi', $2, $3, $4, 'disconnected', now())
     ON CONFLICT (barbershop_id, provider) DO UPDATE SET
       uazapi_instance_name = COALESCE(EXCLUDED.uazapi_instance_name, barbershop_whatsapp_connections.uazapi_instance_name),
       uazapi_instance_id = COALESCE(EXCLUDED.uazapi_instance_id, barbershop_whatsapp_connections.uazapi_instance_id),
       uazapi_instance_token_encrypted = EXCLUDED.uazapi_instance_token_encrypted,
       updated_at = now()`,
    [barbershopId, instanceName, instanceId ?? null, encrypted],
  );
  return { token: created.token, instanceId };
}
