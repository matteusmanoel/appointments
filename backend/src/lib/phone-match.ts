/**
 * Normalização e match tolerante de telefone BR para inbox WhatsApp.
 * Permite igualar números com/sem DDI 55 e com/sem nono dígito (10 vs 11 dígitos nacionais).
 */

/** Apenas dígitos. */
export function normalizeDigits(v: string | null | undefined): string {
  if (!v) return "";
  return v.replace(/\D/g, "");
}

/**
 * Gera formas equivalentes para match (BR).
 * Ex.: "554588230845" → ["554588230845", "45988230845", "4588230845"]
 * Ex.: "45988230845" → ["45988230845", "4588230845", "554588230845"]
 */
export function brPhoneMatchKeys(digits: string): string[] {
  const d = normalizeDigits(digits);
  if (d.length < 8) return d ? [d] : [];

  const keys = new Set<string>();

  let national = d;
  if (d.length === 12 && d.startsWith("55")) {
    national = d.slice(2); // 10 dígitos
  } else if (d.length === 13 && d.startsWith("55")) {
    national = d.slice(2); // 11 dígitos
  }

  if (national.length === 11 && national.charAt(2) === "9") {
    // DDD + 9 + 8 dígitos
    keys.add(national);
    keys.add("55" + national);
    const without9 = national.slice(0, 2) + national.slice(3); // 10 dígitos
    keys.add(without9);
    keys.add("55" + without9);
  } else if (national.length === 10) {
    // DDD + 8 dígitos (sem nono)
    keys.add(national);
    keys.add("55" + national);
    const with9 = national.slice(0, 2) + "9" + national.slice(2); // 11 dígitos
    keys.add(with9);
    keys.add("55" + with9);
  } else {
    keys.add(d);
    if (d.length >= 10 && !d.startsWith("55")) keys.add("55" + d);
  }

  return [...keys];
}

/** Retorna true se dois números são o mesmo contato no sentido BR (DDI/nono tolerante). */
export function brPhonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = brPhoneMatchKeys(a ?? "");
  const kb = brPhoneMatchKeys(b ?? "");
  return ka.some((k) => kb.includes(k));
}

/**
 * Canoniza número BR para chave única: sempre "55" + DDD + número (com nono dígito quando móvel).
 * Usar como external_thread_id e em lookups para evitar conversas duplicadas (459... vs 5545...).
 * - Entrada: string qualquer (com ou sem 55, com ou sem nono).
 * - Saída: "55" + 11 dígitos (móvel) ou "55" + 10 dígitos (fixo), ou null se inválido.
 */
export function canonicalizeBrPhoneDigits(v: string | null | undefined): string | null {
  const d = normalizeDigits(v ?? "");
  if (d.length < 10) return null;

  let national = d;
  if (d.length >= 12 && d.startsWith("55")) {
    national = d.slice(2);
  } else if (d.length === 11 && d.startsWith("55")) {
    national = d.slice(2);
  }

  if (national.length === 11 && national.charAt(2) === "9") {
    return "55" + national;
  }
  if (national.length === 10) {
    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);
    const firstDigit = subscriber.charAt(0);
    // Assinante começando em 6–9: tratar como móvel e inserir nono dígito.
    if (firstDigit >= "6" && firstDigit <= "9") {
      return "55" + ddd + "9" + subscriber;
    }
    return "55" + national;
  }
  if (national.length === 11) {
    return "55" + national;
  }
  return d.length >= 10 ? "55" + national : null;
}
