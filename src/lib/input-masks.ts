/**
 * Formata apenas dígitos como telefone BR: (11) 98765-4321 ou (11) 3456-7890
 */
export function formatPhoneBR(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Retorna só os dígitos do telefone (para salvar/validar)
 */
export function parsePhoneBR(value: string): string {
  return value.replace(/\D/g, "");
}

/** Formata dígitos como CNPJ: XX.XXX.XXX/XXXX-XX */
export function formatCNPJ(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Retorna só os dígitos do CNPJ */
export function parseCNPJ(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Formata número como moeda BR para exibição: 1.234,56
 */
export function formatCurrencyBR(value: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  const fixed = Math.round(value * 100) / 100;
  return fixed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A partir dos dígitos digitados (centavos), retorna o valor em reais.
 * Ex: "123456" -> 1234.56
 */
export function parseCurrencyDigitsToNumber(digits: string): number {
  const d = digits.replace(/\D/g, "");
  if (d.length === 0) return 0;
  return Number(d) / 100;
}

/**
 * Formata string de dígitos como exibição de moeda BR (ex: "123456" -> "1.234,56")
 */
export function formatCurrencyDigits(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 0) return "";
  const intPart = d.slice(0, -2) || "0";
  const decPart = d.slice(-2).padStart(2, "0");
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted},${decPart}`;
}

/**
 * De um valor em reais (number), retorna a string de dígitos (centavos) para edição.
 */
export function numberToCurrencyDigits(value: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return Math.round(value * 100).toString();
}
