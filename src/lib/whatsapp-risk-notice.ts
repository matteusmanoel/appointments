/**
 * Aviso de uso responsável do WhatsApp (lp-correcoes §16.5, parecer B-05). Aceite obrigatório ANTES de pagar.
 * `WHATSAPP_RISK_NOTICE_VERSION` precisa mudar sempre que o texto mudar (vai ao servidor e fica no metadata do Stripe).
 */
export const WHATSAPP_RISK_NOTICE_VERSION = "2026-11-13b";

export const WHATSAPP_RISK_TERMS_URL = "https://navalhia.com.br/termos";

export const WHATSAPP_RISK_CHECKBOX_BEFORE = "Li e aceito os ";
export const WHATSAPP_RISK_CHECKBOX_LINK = "Termos de Uso";
export const WHATSAPP_RISK_CHECKBOX_AFTER =
  " e estou ciente de que o NavalhIA não possui integração oficial nem vínculo com a Meta, e que o uso do WhatsApp está sujeito às políticas e restrições da plataforma. Recomenda-se utilizar um número exclusivo.";

export const WHATSAPP_RISK_NOTICE_TEXT =
  WHATSAPP_RISK_CHECKBOX_BEFORE + WHATSAPP_RISK_CHECKBOX_LINK + WHATSAPP_RISK_CHECKBOX_AFTER;

export const WHATSAPP_RISK_CHECKBOX_LABEL = WHATSAPP_RISK_NOTICE_TEXT;
export const WHATSAPP_RISK_REQUIRED_MESSAGE = "Marque o aceite do aviso sobre o WhatsApp para continuar.";
