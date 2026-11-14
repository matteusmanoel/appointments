/**
 * Opt-out de mensagens promocionais por WhatsApp (lp-correcoes §16.6).
 *
 * Só vale a mensagem INTEIRA igual a uma palavra de opt-out (depois de tirar acentos, pontuação, emoji e espaços
 * extras): «PARAR», «Parar.», «sair!», «Não quero receber». Frases com a palavra no meio («vou parar aí às 18h»,
 * «pode parar na frente?», «sair às 18h?») NÃO são opt-out: seguem para o agente, que pode confirmar a intenção.
 */
const OPT_OUT_PHRASES = new Set([
  "parar",
  "pare",
  "sair",
  "stop",
  "remover",
  "optout",
  "opt out",
  "sair da lista",
  "parar de receber",
  "nao receber mais",
  "nao quero receber",
  "nao quero mais receber",
  "cancelar inscricao",
]);

export function normalizeOptOutText(text: string): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOptOutMessage(text: string): boolean {
  const n = normalizeOptOutText(text);
  return n.length > 0 && OPT_OUT_PHRASES.has(n);
}

/** Resposta enviada ao cliente que pediu para sair (não promete lembretes que o sistema pode não enviar). */
export const OPT_OUT_ACK_MESSAGE =
  "Tudo certo: não vamos mais enviar mensagens promocionais para este número. Se foi sem querer, é só avisar a barbearia por aqui.";

export const OPT_OUT_SOURCE_WHATSAPP = "whatsapp_keyword";
