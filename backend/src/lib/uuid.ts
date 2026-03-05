const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidUuid(s: string): boolean {
  return typeof s === "string" && UUID_REGEX.test(s.trim());
}

/** Retorna apenas os IDs que são UUIDs válidos. */
export function filterValidUuids(ids: string[]): string[] {
  return (ids ?? []).filter((id) => isValidUuid(String(id)));
}

/**
 * Se algum ID não for UUID válido, retorna mensagem de erro para o LLM.
 * Caso contrário retorna null.
 */
export function validateUuidIds(ids: string[], label: string): string | null {
  const invalid = (ids ?? []).filter((id) => !isValidUuid(String(id)));
  if (invalid.length === 0) return null;
  return `${label} inválido(s): use list_services e passe os IDs retornados (UUID). Recebido: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`;
}
