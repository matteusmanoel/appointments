import * as evo from "./evolution-client.js";
import { withEvolutionInstance } from "./evolution-flight.js";

const TTL_MS = 20_000;

type Cached = { qr?: string; pairingCode?: string; at: number };

const cache = new Map<string, Cached>();

export function clearPairing(instanceName: string): void {
  cache.delete(instanceName);
}

/** QR já gerado neste processo, sem abrir outro login na Evolution. */
export function peekPairing(instanceName: string): { qr?: string; pairingCode?: string } | null {
  return fresh(instanceName);
}

function fresh(instanceName: string): { qr?: string; pairingCode?: string } | null {
  const hit = cache.get(instanceName);
  if (!hit || Date.now() - hit.at >= TTL_MS) return null;
  if (!hit.qr && !hit.pairingCode) return null;
  return { qr: hit.qr, pairingCode: hit.pairingCode };
}

/** QR atual da instância. Reusa o último por 20s para o painel não abrir outro login a cada poll. */
export async function fetchPairing(
  instanceName: string,
  phone?: string,
): Promise<{ qr?: string; pairingCode?: string }> {
  const cached = fresh(instanceName);
  if (cached) return cached;
  return withEvolutionInstance(instanceName, async () => {
    const again = fresh(instanceName);
    if (again) return again;
    const raw = await evo.connectInstance(instanceName, phone);
    const extracted = evo.extractQr(raw);
    if (extracted.qr || extracted.pairingCode) {
      cache.set(instanceName, { ...extracted, at: Date.now() });
    }
    return extracted;
  });
}
