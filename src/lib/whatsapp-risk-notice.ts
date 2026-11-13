/**
 * Aviso de uso responsável do WhatsApp (lp-correcoes §16.5, parecer B-05). Aceite obrigatório ANTES de pagar.
 * `WHATSAPP_RISK_NOTICE_VERSION` precisa mudar sempre que o texto mudar (vai ao servidor e fica no metadata do Stripe).
 */
export const WHATSAPP_RISK_NOTICE_VERSION = "2026-11-13";

export const WHATSAPP_RISK_NOTICE_TEXT =
  "A NavalhIA se conecta ao seu WhatsApp por QR code, sem a API oficial do WhatsApp, e não é parceira nem endossada pela Meta. " +
  "O WhatsApp pode restringir ou banir números que usam automação não autorizada. Esse risco existe mesmo sem spam e recai sobre o seu número. " +
  "Use um número exclusivo e só fale com quem é seu cliente.";

export const WHATSAPP_RISK_CHECKBOX_LABEL = "Li e aceito este aviso.";
export const WHATSAPP_RISK_REQUIRED_MESSAGE = "Marque o aceite do aviso sobre o WhatsApp para continuar.";
