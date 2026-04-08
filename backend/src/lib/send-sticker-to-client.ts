import { pool } from "../db.js";
import { config } from "../config.js";
import { decrypt } from "../integrations/encryption.js";
import { sendSticker } from "../integrations/uazapi/client.js";

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

  const tok = await pool.query<{ uazapi_instance_token_encrypted: string | null }>(
    `SELECT uazapi_instance_token_encrypted FROM public.barbershop_whatsapp_connections
     WHERE barbershop_id = $1 AND provider = 'uazapi' AND status = 'connected' AND uazapi_instance_token_encrypted IS NOT NULL`,
    [barbershopId],
  );
  const enc = tok.rows[0]?.uazapi_instance_token_encrypted;
  if (!enc || !config.appEncryptionKey) {
    return { error: "WhatsApp não conectado; não é possível enviar a figurinha." };
  }
  const token = decrypt(enc, config.appEncryptionKey);

  await sendSticker({ token, number: digits, url: mediaUrl });

  return { ok: true, message: "Figurinha enviada." };
}
