/**
 * Guarda da DATABASE_URL do simulador CLI e dos testes.
 * Recusa host não local antes de qualquer conexão, no espírito do LouFlow #66:
 * só localhost, 127.0.0.1, ::1 ou socket Unix. Mensagens nunca incluem a URL
 * nem credenciais.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);

export const LOCAL_DATABASE_URL_ERROR =
  "DATABASE_URL recusada: o host não é local (apenas localhost, 127.0.0.1, ::1 ou socket Unix).";

export type DatabaseUrlTarget =
  | { kind: "tcp"; host: string }
  | { kind: "socket"; path: string };

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function parseKeyValue(url: string): URL | null {
  if (!/^[a-z_]+=/i.test(url.trim())) return null;
  const params = new URLSearchParams();
  for (const part of url.trim().split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    params.set(part.slice(0, eq), stripQuotes(part.slice(eq + 1)));
  }
  const fake = new URL("postgresql://localhost/db");
  const host = params.get("host") ?? params.get("hostaddr");
  if (host) fake.hostname = host.startsWith("/") ? "" : host;
  if (host?.startsWith("/")) fake.searchParams.set("host", host);
  const port = params.get("port");
  if (port) fake.port = port;
  const db = params.get("dbname") ?? params.get("database");
  if (db) fake.pathname = `/${db}`;
  return fake;
}

function asUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(LOCAL_DATABASE_URL_ERROR);
  const candidates = [trimmed];
  if (/^postgres(?:ql)?:\/\//i.test(trimmed) && /@\//.test(trimmed)) {
    candidates.push(trimmed.replace(/^(postgres(?:ql)?:\/\/[^/?]*@)\//i, "$1localhost/"));
  }
  for (const candidate of candidates) {
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return new URL(candidate);
    } catch {
      // tenta o próximo candidato ou o formato chave=valor
    }
  }
  const kv = parseKeyValue(trimmed);
  if (kv) return kv;
  throw new Error("DATABASE_URL recusada: valor inválido.");
}

export function inspectDatabaseUrl(url: string): DatabaseUrlTarget {
  const parsed = asUrl(url);
  const queryHost = parsed.searchParams.get("host") ?? "";
  if (queryHost.startsWith("/") || parsed.pathname.startsWith("/%2F") || parsed.pathname.startsWith("/%2f")) {
    return { kind: "socket", path: queryHost || decodeURIComponent(parsed.pathname) };
  }
  const host = (parsed.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!host && (queryHost.startsWith("/") || parsed.host === "")) {
    return { kind: "socket", path: queryHost || parsed.pathname || "" };
  }
  if (!host) throw new Error("DATABASE_URL recusada: valor inválido.");
  return { kind: "tcp", host };
}

export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const target = inspectDatabaseUrl(url);
    if (target.kind === "socket") return target.path.startsWith("/");
    const host = target.host;
    if (LOCAL_HOSTS.has(host)) return true;
    if (host.startsWith("::ffff:")) {
      return LOCAL_HOSTS.has(host.slice("::ffff:".length));
    }
    return false;
  } catch {
    return false;
  }
}

export function assertLocalDatabaseUrl(url = process.env.DATABASE_URL): string {
  if (!url || !url.trim()) {
    throw new Error("DATABASE_URL recusada: valor ausente.");
  }
  const target = inspectDatabaseUrl(url);
  if (target.kind === "socket") {
    if (target.path.startsWith("/")) return url;
    throw new Error(LOCAL_DATABASE_URL_ERROR);
  }
  const host = target.host;
  if (LOCAL_HOSTS.has(host) || (host.startsWith("::ffff:") && LOCAL_HOSTS.has(host.slice("::ffff:".length)))) {
    return url;
  }
  throw new Error(LOCAL_DATABASE_URL_ERROR);
}
