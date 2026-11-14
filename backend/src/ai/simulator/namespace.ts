/**
 * Namespace próprio do simulador: nunca reutiliza conversa WhatsApp, cliente
 * existente, nem entra na contagem de uso (is_sandbox=true, channel=simulator).
 */
import { createHash } from "node:crypto";

export const SIMULATOR_CHANNEL = "simulator";
export const SIMULATOR_THREAD_PREFIX = "sim:";

export function simulatorThreadId(phoneDigits: string): string {
  const digits = (phoneDigits ?? "").replace(/\D/g, "");
  return `${SIMULATOR_THREAD_PREFIX}${digits || "0000000000001"}`;
}

/**
 * Telefone interno após canonicalização (só dígitos) que não colide com
 * um número real (BR começa em 55). Prefixo 000 + hash estável.
 */
export function simulatorClientPhone(barbershopId: string, phoneDigits: string): string {
  const digits = (phoneDigits ?? "").replace(/\D/g, "") || "0000000000001";
  const digest = createHash("sha256").update(`sim:${barbershopId}:${digits}`).digest("hex");
  // 13 dígitos 55 + DDD 00 (inexistente) + 9 + 8 dígitos: sobrevive à canonização BR
  // e não colide com um celular real.
  const n = BigInt(`0x${digest.slice(0, 8)}`).toString().padStart(8, "0").slice(-8);
  return `55009${n}`;
}

export function isSimulatorThreadId(threadId: string | null | undefined): boolean {
  return Boolean(threadId && threadId.startsWith(SIMULATOR_THREAD_PREFIX));
}
