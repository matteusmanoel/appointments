/**
 * Política do comando de teste «deletar» (apaga cliente, agendamentos e conversa do telefone).
 * Só vale fora de produção E para telefones explicitamente listados em TEST_WIPE_PHONES
 * (dígitos separados por vírgula). Em produção, ou sem allowlist, «deletar» é texto comum.
 */
export function isTestWipeAllowed(
  phone: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") return false;
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return false;
  const allow = (env.TEST_WIPE_PHONES ?? "")
    .split(",")
    .map((p) => p.replace(/\D/g, ""))
    .filter(Boolean);
  return allow.includes(digits);
}
