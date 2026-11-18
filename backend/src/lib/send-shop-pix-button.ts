import { pool } from "../db.js";
import { getWhatsAppOrNull } from "../integrations/whatsapp/index.js";

export type ShopPixButtonResult = { sent: true } | { sent: false; reason: "no_key" | "unsupported" | "failed" };

/** One copy choice. A reply button mixed in makes WhatsApp Web hide the menu. */
export function shopPixCopyChoice(pixKey: string): string {
  return `Copiar chave|copy:${pixKey.trim()}`;
}

/**
 * Shop PIX as a copy button. The key is pasted in the bank app. A refusal leaves the caller
 * to send the key as plain text.
 */
export async function sendShopPixCopy(
  barbershopId: string,
  clientPhone: string,
  params: { text: string; pixKey: string; footerText?: string },
): Promise<ShopPixButtonResult> {
  const digits = clientPhone.replace(/\D/g, "");
  const key = params.pixKey.trim();
  if (!digits || !key) return { sent: false, reason: "no_key" };

  const session = await getWhatsAppOrNull(barbershopId);
  if (!session?.sendMenu) return { sent: false, reason: "unsupported" };

  try {
    await session.sendMenu({
      to: digits,
      text: params.text,
      choices: [shopPixCopyChoice(key)],
      footerText: params.footerText,
    });
    return { sent: true };
  } catch (e) {
    console.warn(
      "[shop-pix-copy] menu refused",
      e instanceof Error ? e.message : "failed",
    );
    return { sent: false, reason: "failed" };
  }
}

/**
 * Botão de pagamento PIX nativo com a chave da barbearia. Quem chama mantém o texto com a chave
 * quando o botão não sai: provedor sem suporte, servidor que recusa ou chave ausente.
 */
export async function sendShopPixButton(
  barbershopId: string,
  clientPhone: string,
  params: { amount: number; description: string },
): Promise<ShopPixButtonResult> {
  const digits = clientPhone.replace(/\D/g, "");
  if (!digits || !(params.amount > 0)) return { sent: false, reason: "no_key" };

  const shop = await pool.query<{ name: string; address: string | null; pix_key: string | null }>(
    `SELECT name, address, pix_key FROM public.barbershops WHERE id = $1`,
    [barbershopId],
  );
  const row = shop.rows[0];
  const pixKey = (row?.pix_key ?? "").trim();
  if (!row || !pixKey) return { sent: false, reason: "no_key" };

  const session = await getWhatsAppOrNull(barbershopId);
  if (!session?.sendPixRequest) return { sent: false, reason: "unsupported" };

  try {
    await session.sendPixRequest({
      to: digits,
      amount: params.amount,
      description: params.description,
      pixKey,
      name: (row.name ?? "").trim() || "Barbearia",
      city: (row.address ?? "").split(",").pop()?.trim() || "Brasil",
    });
    return { sent: true };
  } catch (e) {
    console.warn(
      "[shop-pix-button] sendPixRequest failed barbershopId=%s: %s",
      barbershopId,
      e instanceof Error ? e.message : String(e),
    );
    return { sent: false, reason: "failed" };
  }
}
