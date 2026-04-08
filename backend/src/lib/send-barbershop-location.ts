import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendLocation } from "../integrations/uazapi/client.js";

/**
 * Envia o pin de localização da barbearia para o cliente no WhatsApp (UAZAPI).
 * Exige latitude, longitude e token de instância conectada.
 */
export async function sendBarbershopLocationToClient(
  barbershopId: string,
  clientPhone: string,
): Promise<{ ok: true; message: string } | { error: string }> {
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits) return { error: "Telefone do cliente é obrigatório" };

  const shop = await pool.query<{
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    `SELECT name, address, latitude, longitude FROM public.barbershops WHERE id = $1`,
    [barbershopId],
  );
  const row = shop.rows[0];
  if (!row) return { error: "Barbearia não encontrada" };
  if (row.latitude == null || row.longitude == null) {
    return {
      error:
        "Coordenadas não cadastradas. Informe latitude e longitude em Configurações para enviar o pin no WhatsApp.",
    };
  }
  const displayName = (row.name ?? "Barbearia").trim() || "Barbearia";
  const addressText = (row.address ?? "").trim() || displayName;

  const tok = await pool.query<{ uazapi_instance_token_encrypted: string | null }>(
    `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
     WHERE barbershop_id = $1 AND provider = 'uazapi' AND status = 'connected' AND uazapi_instance_token_encrypted IS NOT NULL`,
    [barbershopId],
  );
  const enc = tok.rows[0]?.uazapi_instance_token_encrypted;
  if (!enc || !config.appEncryptionKey) {
    return { error: "WhatsApp não conectado; não é possível enviar a localização." };
  }
  const token = decrypt(enc, config.appEncryptionKey);

  await sendLocation({
    token,
    number: digits,
    name: displayName,
    address: addressText,
    latitude: row.latitude,
    longitude: row.longitude,
  });

  return { ok: true, message: "Localização enviada pelo WhatsApp." };
}
