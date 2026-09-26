export type WhatsAppProviderName = "uazapi" | "evolution";

export type WhatsAppConnectionStatus = "disconnected" | "connecting" | "connected";

export type SendLocationParams = {
  lat: number;
  lng: number;
  name: string;
  address: string;
};

export type ConnectResult = {
  status: WhatsAppConnectionStatus;
  qr?: string;
  pairingCode?: string;
  webhook_set?: boolean;
  webhook_warning?: string;
};

export type StatusResult = {
  status: WhatsAppConnectionStatus;
  connected: boolean;
  qr?: string;
  pairingCode?: string;
  phone?: string | null;
};

export type SendResult = {
  providerMessageId: string;
};

export interface WhatsAppSession {
  readonly provider: WhatsAppProviderName;
  sendText(to: string, text: string): Promise<SendResult>;
  sendLocation(to: string, params: SendLocationParams): Promise<SendResult>;
  sendSticker?(to: string, url: string): Promise<SendResult>;
  sendPixRequest?(params: {
    to: string;
    amount: number;
    description: string;
    pixKey: string;
    name: string;
    city: string;
  }): Promise<void>;
  /** Creates/ensures instance, sets webhook, returns QR / pairing. */
  connect(opts?: { phone?: string }): Promise<ConnectResult>;
  status(): Promise<StatusResult>;
  disconnect(): Promise<void>;
}

export type ConnectionRow = {
  id: string;
  barbershop_id: string;
  provider: WhatsAppProviderName;
  whatsapp_phone: string | null;
  uazapi_instance_name: string | null;
  uazapi_instance_id: string | null;
  uazapi_instance_token_encrypted: string | null;
  evolution_instance_name: string | null;
  status: WhatsAppConnectionStatus;
  connected_at: string | null;
  disconnected_at: string | null;
  last_error: string | null;
};

export class WhatsAppNotConnectedError extends Error {
  constructor(message = "WhatsApp não conectado") {
    super(message);
    this.name = "WhatsAppNotConnectedError";
  }
}
