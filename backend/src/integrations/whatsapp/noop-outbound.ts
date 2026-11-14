/**
 * Provider WhatsApp fake/noop para o simulador CLI e testes.
 * Nunca faz HTTP nem fala com Evolution/Uazapi.
 */
import type {
  ConnectResult,
  SendLocationParams,
  SendResult,
  StatusResult,
  WhatsAppSession,
} from "./types.js";

export type WhatsAppOutboundAttempt = {
  at: string;
  method: "sendText" | "sendLocation" | "sendSticker" | "sendPixRequest" | "connect" | "disconnect";
  to?: string;
  text?: string;
  url?: string;
  location?: SendLocationParams;
};

let noopMode = false;
const attempts: WhatsAppOutboundAttempt[] = [];
let seq = 0;

export function isNoopWhatsAppOutbound(): boolean {
  return noopMode;
}

export function useNoopWhatsAppOutbound(): void {
  noopMode = true;
}

export function resetWhatsAppOutbound(): void {
  noopMode = false;
  attempts.length = 0;
  seq = 0;
}

export function listWhatsAppOutboundAttempts(): WhatsAppOutboundAttempt[] {
  return attempts.map((a) => ({ ...a }));
}

function record(attempt: Omit<WhatsAppOutboundAttempt, "at">): SendResult {
  attempts.push({ at: new Date().toISOString(), ...attempt });
  seq += 1;
  return { providerMessageId: `noop-${seq}` };
}

export function createNoopWhatsAppSession(): WhatsAppSession {
  return {
    provider: "evolution",
    async sendText(to: string, text: string): Promise<SendResult> {
      return record({ method: "sendText", to, text });
    },
    async sendLocation(to: string, params: SendLocationParams): Promise<SendResult> {
      return record({ method: "sendLocation", to, location: params });
    },
    async sendSticker(to: string, url: string): Promise<SendResult> {
      return record({ method: "sendSticker", to, url });
    },
    async sendPixRequest(params): Promise<void> {
      record({ method: "sendPixRequest", to: params.to, text: params.description });
    },
    async connect(): Promise<ConnectResult> {
      record({ method: "connect" });
      return { status: "connected" };
    },
    async status(): Promise<StatusResult> {
      return { status: "connected", connected: true, phone: null };
    },
    async disconnect(): Promise<void> {
      record({ method: "disconnect" });
    },
  };
}
