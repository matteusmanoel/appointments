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
