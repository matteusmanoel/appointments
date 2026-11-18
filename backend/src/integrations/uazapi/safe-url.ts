import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Resolve o host para endereços. IP literal devolve o próprio endereço, sem DNS. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeOutboundUrlError";
  }
}

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog"]);

export async function defaultLookup(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const value = ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
  return value;
}

function unwrapMapped(address: string): { v4: string | null; v6: string } {
  const ip = address.trim().toLowerCase();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return { v4: mapped[1]!, v6: ip };
  if (ip.includes(".")) return { v4: ip, v6: ip };
  return { v4: null, v6: ip };
}

function ipv4Private(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n == null) return true;
  const a = n >>> 24;
  const b = (n >>> 16) & 0xff;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function ipv6Private(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true;
  const headText = ip.startsWith("::") ? "0" : (ip.split(":")[0] ?? "0");
  const head = Number.parseInt(headText || "0", 16);
  if (!Number.isFinite(head)) return true;
  if (head >= 0xfc00 && head <= 0xfdff) return true;
  if (head >= 0xfe80 && head <= 0xfebf) return true;
  return false;
}

function isPrivateAddress(address: string): boolean {
  const { v4, v6 } = unwrapMapped(address);
  if (v4) return ipv4Private(v4);
  return ipv6Private(v6);
}

function isLoopbackAddress(address: string): boolean {
  const { v4, v6 } = unwrapMapped(address);
  if (v4) {
    const n = ipv4ToInt(v4);
    return n != null && (n >>> 24) === 127;
  }
  return v6 === "::1";
}

function isMetadataAddress(address: string): boolean {
  const { v4 } = unwrapMapped(address);
  return v4 === "169.254.169.254";
}

function isLocalhostName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

export type SafeUrlOptions = {
  /** Libera host privado e HTTP em localhost. O webhook público não usa esta flag. */
  allowLocal?: boolean;
  /** Webhook: só https, e o host tem que resolver para endereço público. */
  httpsOnly?: boolean;
  lookup?: HostLookup;
};

/**
 * Confere o destino antes do fetch. Resolve o DNS primeiro e só então classifica
 * cada endereço. Redirect não é tratado aqui.
 */
export async function assertSafeOutboundUrl(raw: string, opts: SafeUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeOutboundUrlError("URL inválida.");
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError("A URL não pode trazer usuário ou senha.");
  }
  if (url.search || url.hash) {
    throw new UnsafeOutboundUrlError("A URL não pode ter query nem fragmento.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) throw new UnsafeOutboundUrlError("URL inválida.");
  if (METADATA_HOSTS.has(host)) {
    throw new UnsafeOutboundUrlError("Host de metadata recusado.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeOutboundUrlError("A URL precisa ser https.");
  }

  let addresses: string[];
  try {
    addresses = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    throw new UnsafeOutboundUrlError("Não foi possível resolver o host.");
  }
  if (!addresses.length) throw new UnsafeOutboundUrlError("Não foi possível resolver o host.");
  if (addresses.some((address) => isMetadataAddress(address))) {
    throw new UnsafeOutboundUrlError("Host de metadata recusado.");
  }

  const nameIsLocal = isLocalhostName(host);
  const anyPrivate = nameIsLocal || addresses.some((address) => isPrivateAddress(address));
  const allLoopback = addresses.every((address) => isLoopbackAddress(address));
  const mixed = addresses.some((address) => isPrivateAddress(address)) && addresses.some((address) => !isPrivateAddress(address));
  if (mixed || (nameIsLocal && !allLoopback)) {
    throw new UnsafeOutboundUrlError("O host resolve para endereços mistos. Recusado.");
  }

  if (opts.httpsOnly) {
    if (url.protocol !== "https:") {
      throw new UnsafeOutboundUrlError("A URL do webhook precisa ser https.");
    }
    if (anyPrivate) throw new UnsafeOutboundUrlError("Host interno ou privado recusado.");
    return url;
  }

  if (url.protocol === "http:") {
    if (!opts.allowLocal || !allLoopback) {
      throw new UnsafeOutboundUrlError("HTTP só é aceito em localhost com --allow-http.");
    }
    return url;
  }

  if (anyPrivate && !opts.allowLocal) {
    throw new UnsafeOutboundUrlError("Host interno ou privado recusado.");
  }
  return url;
}
