import { existsSync } from "node:fs";

const REQUEST_TIMEOUT_MS = 25_000;

function getBaseUrl(): string {
  let base = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("EVOLUTION_API_URL is required for Evolution client");
  try {
    const url = new URL(base);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (localHost && existsSync("/.dockerenv")) {
      url.hostname = "host.docker.internal";
      base = url.toString().replace(/\/$/, "");
    }
  } catch {
    // keep the raw value
  }
  return base;
}

function getApiKey(): string {
  const key = process.env.EVOLUTION_API_KEY ?? "";
  if (!key) throw new Error("EVOLUTION_API_KEY is required for Evolution client");
  return key;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`Evolution não respondeu a tempo (${timeoutMs / 1000}s). Verifique EVOLUTION_API_URL e rede.`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetchWithTimeout(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: getApiKey(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Evolution ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function extractEvolutionMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const any = payload as Record<string, unknown>;
  const key = any.key && typeof any.key === "object" ? (any.key as Record<string, unknown>) : null;
  const nested =
    any.data && typeof any.data === "object" ? (any.data as Record<string, unknown>) : null;
  const nestedKey =
    nested?.key && typeof nested.key === "object" ? (nested.key as Record<string, unknown>) : null;
  const candidates = [
    key?.id,
    nestedKey?.id,
    any.messageId,
    any.id,
    any.providerMessageId,
    nested?.id,
    nested?.messageId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number") return String(c);
  }
  return null;
}

export async function pingEvolution(): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const base = getBaseUrl();
    const res = await fetchWithTimeout(`${base}/`, {
      method: "GET",
      headers: { apikey: getApiKey() },
      timeoutMs: 8000,
    });
    return { ok: res.ok || res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createInstance(instanceName: string): Promise<unknown> {
  return request("POST", "/instance/create", {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  });
}

export async function connectionState(instanceName: string): Promise<unknown> {
  return request("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
}

export async function connectInstance(instanceName: string, phone?: string): Promise<unknown> {
  const qs = phone ? `?number=${encodeURIComponent(phone.replace(/\D/g, ""))}` : "";
  return request("GET", `/instance/connect/${encodeURIComponent(instanceName)}${qs}`);
}

export async function logoutInstance(instanceName: string): Promise<void> {
  try {
    await request("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  } catch {
    await request("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }
}

export async function restartInstance(instanceName: string): Promise<unknown> {
  try {
    return await request("PUT", `/instance/restart/${encodeURIComponent(instanceName)}`);
  } catch {
    return request("POST", `/instance/restart/${encodeURIComponent(instanceName)}`);
  }
}

export async function findInstanceWebhook(instanceName: string): Promise<unknown> {
  return request("GET", `/webhook/find/${encodeURIComponent(instanceName)}`);
}

export async function setInstanceSettings(instanceName: string): Promise<unknown> {
  const body = {
    rejectCall: true,
    groupsIgnore: true,
    alwaysOnline: true,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
  };
  try {
    return await request("POST", `/settings/set/${encodeURIComponent(instanceName)}`, body);
  } catch {
    return request("POST", `/settings/set/${encodeURIComponent(instanceName)}`, { settings: body });
  }
}

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"];

export async function setInstanceWebhook(instanceName: string, url: string): Promise<unknown> {
  try {
    return await request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: false,
        events: WEBHOOK_EVENTS,
      },
    });
  } catch {
    return request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
      url,
      enabled: true,
      webhook_by_events: false,
      webhook_base64: false,
      events: WEBHOOK_EVENTS,
    });
  }
}

export async function sendText(instanceName: string, number: string, text: string): Promise<unknown> {
  const normalized = number.replace(/\D/g, "");
  return request("POST", `/message/sendText/${encodeURIComponent(instanceName)}`, {
    number: normalized,
    text,
    delay: 800,
  });
}

export async function sendLocation(
  instanceName: string,
  params: { number: string; name: string; address: string; latitude: number; longitude: number },
): Promise<unknown> {
  const normalized = params.number.replace(/\D/g, "");
  return request("POST", `/message/sendLocation/${encodeURIComponent(instanceName)}`, {
    number: normalized,
    name: params.name,
    address: params.address,
    latitude: params.latitude,
    longitude: params.longitude,
    locationMessage: {
      name: params.name,
      address: params.address,
      latitude: params.latitude,
      longitude: params.longitude,
    },
    delay: 800,
  });
}

export async function sendSticker(instanceName: string, number: string, url: string): Promise<unknown> {
  const normalized = number.replace(/\D/g, "");
  return request("POST", `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
    number: normalized,
    mediatype: "sticker",
    mimetype: "image/webp",
    media: url,
    fileName: "sticker.webp",
  });
}

export async function getBase64FromMediaMessage(
  instanceName: string,
  providerEventId: string,
): Promise<{ base64: string; mimetype?: string }> {
  const raw = await request("POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
    message: { key: { id: providerEventId } },
    convertToMp4: false,
  });
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const nested = rec?.base64 && typeof rec.base64 === "object" ? (rec.base64 as Record<string, unknown>) : rec;
  const b64 = String(nested?.base64 ?? rec?.base64 ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!b64) throw new Error("Evolution não devolveu o áudio em base64");
  const mimetype = String(nested?.mimetype ?? rec?.mimetype ?? "audio/ogg");
  return { base64: b64, mimetype };
}

/** WhatsApp profile photo URL for a number. Null when the contact has no public photo. */
export async function fetchProfilePictureUrl(instanceName: string, number: string): Promise<string | null> {
  const digits = number.replace(/\D/g, "");
  if (!digits) return null;
  try {
    const raw = await request(
      "POST",
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
      { number: digits },
    );
    const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const url = rec?.profilePictureUrl ?? rec?.profilePicUrl ?? rec?.url;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\b404\b/.test(msg)) return null;
    throw e;
  }
}

export function mapEvolutionState(raw: unknown): "disconnected" | "connecting" | "connected" {
  if (!raw || typeof raw !== "object") return "disconnected";
  const obj = raw as Record<string, unknown>;
  const inst = obj.instance && typeof obj.instance === "object" ? (obj.instance as Record<string, unknown>) : obj;
  const state = String(inst.state ?? inst.status ?? obj.state ?? "").toLowerCase();
  if (state === "open" || state === "connected") return "connected";
  if (state === "connecting" || state === "qr" || state === "pair") return "connecting";
  return "disconnected";
}

export function extractQr(raw: unknown): { qr?: string; pairingCode?: string } {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const nested = obj.qrcode && typeof obj.qrcode === "object" ? (obj.qrcode as Record<string, unknown>) : obj;
  const base64 = nested.base64 ?? nested.qr ?? obj.base64 ?? obj.qr;
  const pairing = nested.pairingCode ?? nested.pairingcode ?? obj.pairingCode ?? obj.code;
  const qr =
    typeof base64 === "string" && base64.trim()
      ? base64.startsWith("data:")
        ? base64
        : `data:image/png;base64,${base64}`
      : undefined;
  return {
    qr,
    pairingCode: typeof pairing === "string" && pairing.trim() && pairing.length <= 16 ? pairing.trim() : undefined,
  };
}
