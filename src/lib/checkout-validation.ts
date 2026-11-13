export type CheckoutForm = {
  barbershop_name: string;
  cnpj: string;
  phone: string;
  email: string;
  contact_name?: string;
};
export type CheckoutField = "barbershop_name" | "cnpj" | "phone" | "email";

/** Ordem em que os campos aparecem no formulário (para focar o primeiro inválido). */
export const CHECKOUT_FIELD_ORDER: CheckoutField[] = ["barbershop_name", "cnpj", "phone", "email"];

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
const digits = (v: string) => v.replace(/\D/g, "");

export function validateCheckoutField(field: CheckoutField, form: CheckoutForm): string {
  switch (field) {
    case "barbershop_name":
      return form.barbershop_name.trim() ? "" : "Informe o nome da barbearia";
    case "email":
      if (!form.email.trim()) return "Informe seu e-mail";
      return isValidEmail(form.email) ? "" : "E-mail inválido. Confira se tem @ e o domínio (ex.: nome@email.com)";
    case "phone": {
      const n = digits(form.phone).length;
      return n === 10 || n === 11 ? "" : "Telefone deve ter DDD + número (10 ou 11 dígitos)";
    }
    case "cnpj": {
      const n = digits(form.cnpj).length;
      return n === 0 || n === 14 ? "" : "CNPJ deve ter 14 dígitos (ou deixe em branco)";
    }
  }
}

export function validateCheckoutForm(form: CheckoutForm): Partial<Record<CheckoutField, string>> {
  const errors: Partial<Record<CheckoutField, string>> = {};
  for (const f of CHECKOUT_FIELD_ORDER) {
    const msg = validateCheckoutField(f, form);
    if (msg) errors[f] = msg;
  }
  return errors;
}

export function firstInvalidField(errors: Partial<Record<CheckoutField, string>>): CheckoutField | null {
  return CHECKOUT_FIELD_ORDER.find((f) => errors[f]) ?? null;
}

export const CHECKOUT_FALLBACK_ERROR =
  "Não foi possível iniciar o pagamento. Tente de novo ou fale com a gente no WhatsApp.";

/**
 * Erro do servidor nunca aparece cru ("Internal Server Error", texto em inglês, stack).
 * Só passam mensagens curtas em português que o backend escreve de propósito para o usuário.
 */
export function checkoutErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.length > 140) return CHECKOUT_FALLBACK_ERROR;
  if (/^(failed|network|internal|bad gateway|service unavailable|gateway|invalid|unauthorized|not found|request failed|load failed)/i.test(msg)) {
    return CHECKOUT_FALLBACK_ERROR;
  }
  if (!/[áàâãéêíóôõúç]|\b(não|nao|já|ja|por favor|tente|informe|inválid|e-mail|telefone|barbearia|plano|pagamento)\b/i.test(msg)) {
    return CHECKOUT_FALLBACK_ERROR;
  }
  return msg;
}
