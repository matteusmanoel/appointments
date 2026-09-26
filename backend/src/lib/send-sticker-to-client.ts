import { pool } from "../db.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";

/**
 * Sorteia uma figurinha ativa da barbearia e envia ao cliente pelo WhatsApp.
 */
export async function sendStickerToClient(
  barbershopId: string,
  clientPhone: string,
): Promise<{ ok: true; message: string } | { error: string }> {
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits) return { error: "Telefone do cliente é obrigatório" };

  let mediaUrl: string;
  try {
    const r = await pool.query<{ media_url: string }>(
      `SELECT media_url FROM public.barbershop_stickers
       WHERE barbershop_id = $1 AND is_active = true
       ORDER BY RANDOM() LIMIT 1`,
      [barbershopId],
    );
    if (!r.rows[0]?.media_url) {
      return { error: "Nenhuma figurinha ativa cadastrada para esta barbearia." };
    }
    mediaUrl = r.rows[0].media_url;
  } catch {
    return { error: "Tabela de figurinhas ainda não existe ou sem dados." };
  }

  const session = await getWhatsAppOrNull(barbershopId);
  if (!session?.sendSticker) {
    return { error: "WhatsApp não conectado; não é possível enviar a figurinha." };
  }

  await session.sendSticker(digits, mediaUrl);
  return { ok: true, message: "Figurinha enviada." };
}
