/**
 * `connection.last_error` vem cru do provedor/servidor (inglês, técnico). O dono vê uma frase em pt-BR;
 * o texto original continua no console/logs do servidor.
 */
export function friendlyConnectionError(raw: string | null | undefined): string | null {
  const msg = (raw ?? "").trim();
  if (!msg) return null;
  if (/qr|scan|pair|expir|timeout|timed out|demor/i.test(msg)) {
    return "O QR Code expirou antes de ser lido. Clique em Conectar para gerar um novo.";
  }
  if (/logged ?out|unauthori[sz]ed|401|session|desconect|disconnect|closed|connection lost|logout/i.test(msg)) {
    return "O WhatsApp foi desconectado do aparelho. Conecte de novo lendo um novo QR Code.";
  }
  if (/banned|blocked|restrict|spam/i.test(msg)) {
    return "O WhatsApp restringiu este número. Fale com a gente para te orientarmos.";
  }
  if (/econn|enotfound|network|fetch|5\d\d|bad gateway|unavailable|server|api/i.test(msg)) {
    return "Não conseguimos falar com o WhatsApp agora. Tente de novo em instantes.";
  }
  return "Não foi possível manter a conexão com o WhatsApp. Tente conectar de novo; se continuar, fale com a gente.";
}
