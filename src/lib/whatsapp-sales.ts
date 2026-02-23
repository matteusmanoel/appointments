const WHATSAPP_NUMBER = import.meta.env.VITE_SALES_WHATSAPP_NUMBER || "";
const WHATSAPP_MESSAGE =
  import.meta.env.VITE_SALES_WHATSAPP_MESSAGE ||
  "Olá! Gostaria de saber mais sobre o NavalhIA para meu estabelecimento.";

/** Número do suporte para "Tirar dúvidas via WhatsApp" (DDD 45). */
const SUPPORT_NUMBER = "5545988230845";
const SUPPORT_MESSAGE =
  "Olá, vim pelo site da NavalhIA e gostaria de tirar dúvidas.";

export function getWhatsAppSalesUrl(): string | null {
  if (!WHATSAPP_NUMBER || WHATSAPP_NUMBER === "5511999999999") return null;
  const number = WHATSAPP_NUMBER.replace(/\D/g, "");
  const text = encodeURIComponent(WHATSAPP_MESSAGE);
  return `https://wa.me/${number}${text ? `?text=${text}` : ""}`;
}

/** URL para abrir chat com suporte (número fixo 45 98823-0845) com mensagem pré-definida. */
export function getWhatsAppSupportUrl(): string {
  const text = encodeURIComponent(SUPPORT_MESSAGE);
  return `https://wa.me/${SUPPORT_NUMBER}?text=${text}`;
}
