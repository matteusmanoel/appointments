import { brPhoneMatchKeys } from "./phone-match.js";

export type ParsedPhone = { ok: true; digits: string; bucketKey: string } | { ok: false; reason: string };

/**
 * Valida o telefone informado num formulário público.
 *  - aceita máscaras comuns: espaços, "(", ")", "-", "." e "+" no início;
 *  - Brasil (padrão): [55] + DDD (11–99) + número de 8 dígitos (fixo, começa 2–5) ou 9 dígitos (celular, começa 9);
 *  - internacional só com "+" explícito e DDI diferente de 55: 8 a 15 dígitos (E.164);
 *  - rejeita letras, tamanhos impossíveis e sequências repetidas (11111111111).
 * `digits` é o que o produto já grava hoje (só dígitos, sem tirar o 55 digitado); `bucketKey` é uma forma
 * canônica (mesma para com/sem 55 e com/sem nono dígito) usada para o rate limit por telefone.
 */
export function parsePublicPhone(raw: unknown): ParsedPhone {
  if (typeof raw !== "string") return { ok: false, reason: "Telefone inválido" };
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 25) return { ok: false, reason: "Telefone inválido" };
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return { ok: false, reason: "Telefone inválido: use apenas números, DDD incluído" };
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(digits)) return { ok: false, reason: "Telefone inválido" };

  const isBr = !hasPlus || digits.startsWith("55");
  if (!isBr) {
    if (digits.length < 8 || digits.length > 15) return { ok: false, reason: "Telefone inválido" };
    return { ok: true, digits, bucketKey: `intl:${digits}` };
  }

  let national = digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) national = digits.slice(2);
  if (national.length !== 10 && national.length !== 11) {
    return { ok: false, reason: "Telefone inválido: informe DDD + número (ex.: (45) 98823-0845)" };
  }
  const ddd = Number(national.slice(0, 2));
  if (ddd < 11 || ddd > 99) return { ok: false, reason: "Telefone inválido: DDD inválido" };
  const first = national.charAt(2);
  if (national.length === 11 && first !== "9") return { ok: false, reason: "Telefone inválido: celular deve começar com 9 após o DDD" };
  if (national.length === 10 && !/[2-9]/.test(first)) return { ok: false, reason: "Telefone inválido" };
  const keys = brPhoneMatchKeys(national).slice().sort();
  return { ok: true, digits, bucketKey: `br:${keys[0] ?? national}` };
}
