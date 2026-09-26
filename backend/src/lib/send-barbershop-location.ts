import { pool } from "../db.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";

/**
 * Envia o pin de localização da barbearia para o cliente no WhatsApp.
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

  const session = await getWhatsAppOrNull(barbershopId);
  if (!session) {
    return { error: "WhatsApp não conectado; não é possível enviar a localização." };
  }

  try {
    await session.sendLocation(digits, {
      name: displayName,
      address: addressText,
      lat: row.latitude,
      lng: row.longitude,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[send-barbershop-location] sendLocation failed barbershopId=%s: %s", barbershopId, msg);
    return { error: "Falha ao enviar a localização no WhatsApp." };
  }

  return { ok: true, message: "Localização enviada pelo WhatsApp." };
}
