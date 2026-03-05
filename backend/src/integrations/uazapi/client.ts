const optional = (key: string, def: string): string => process.env[key] ?? def;

const UAZAPI_REQUEST_TIMEOUT_MS = 25_000;

function getBaseUrl(): string {
  const base = optional("UAZAPI_BASE_URL", "").replace(/\/$/, "");
  if (!base) throw new Error("UAZAPI_BASE_URL is required for Uazapi client");
  return base;
}

/** Verifica se o servidor Uazapi está acessível (qualquer resposta HTTP = alcançável). */
export async function pingUazapi(): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const base = getBaseUrl();
    const res = await fetchWithTimeout(`${base}/instance/status`, {
      method: "GET",
      headers: { token: "ping" },
      timeoutMs: 8000,
    });
    return { ok: true, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = UAZAPI_REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    return res;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`Uazapi não respondeu a tempo (${timeoutMs / 1000}s). Verifique UAZAPI_BASE_URL e rede.`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export type CreateInstanceResult = {
  token: string;
  name?: string;
  [k: string]: unknown;
};

export async function adminCreateInstance(params: {
  name: string;
  adminField01?: string;
  adminField02?: string;
}): Promise<CreateInstanceResult> {
  const base = getBaseUrl();
  const adminToken = optional("UAZAPI_ADMIN_TOKEN", "");
  if (!adminToken) throw new Error("UAZAPI_ADMIN_TOKEN is required to create instance");

  const res = await fetchWithTimeout(`${base}/instance/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      admintoken: adminToken,
    },
    body: JSON.stringify({
      name: params.name,
      adminField01: params.adminField01,
      adminField02: params.adminField02,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uazapi instance/init failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as CreateInstanceResult;
  if (!data.token) throw new Error("Uazapi instance/init did not return token");
  return data;
}

export async function instanceConnect(params: { token: string; phone?: string }): Promise<unknown> {
  const base = getBaseUrl();
  const res = await fetchWithTimeout(`${base}/instance/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: params.token,
    },
    body: JSON.stringify(params.phone ? { phone: params.phone } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uazapi instance/connect failed: ${res.status} ${text}`);
  }

  return res.json();
}

export type InstanceStatusResult = {
  state?: string;
  // Algumas instalações retornam `status` como string, outras como objeto
  // ex.: { connected: false, jid: null, loggedIn: false }.
  status?: unknown;
  // uazapiGO v2 costuma retornar os dados úteis dentro de `instance`
  instance?: {
    status?: string; // "connecting" | "connected" | "disconnected"
    paircode?: string;
    qrcode?: string; // normalmente já vem como data URL: data:image/png;base64,...
    [k: string]: unknown;
  };
  qr?: string;
  pairingCode?: string;
  [k: string]: unknown;
};

export async function instanceStatus(token: string): Promise<InstanceStatusResult> {
  const base = getBaseUrl();
  const res = await fetchWithTimeout(`${base}/instance/status`, {
    method: "GET",
    headers: { token },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uazapi instance/status failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<InstanceStatusResult>;
}

export async function sendText(params: {
  token: string;
  number: string;
  text: string;
}): Promise<unknown> {
  const base = getBaseUrl();
  const normalized = params.number.replace(/\D/g, "");
  const res = await fetchWithTimeout(`${base}/send/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: params.token,
    },
    body: JSON.stringify({ number: normalized, text: params.text }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uazapi send/text failed: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Set webhook URL for the instance.
 * A API Uazapi (ex.: severo.uazapi.com) pode usar path/método diferentes conforme a instalação.
 * Tentamos várias combinações; se todas retornarem 405, falhamos com mensagem clara.
 */
export async function setWebhook(params: { token: string; url: string }): Promise<unknown> {
  const base = getBaseUrl();
  const url = params.url.replace(/\/$/, "");
  const body = JSON.stringify({ url, enabled: true });
  const token = params.token;

  const attempts: { method: string; path: string; headers: Record<string, string>; body: string }[] = [
    { method: "PUT", path: "/webhook/set", headers: { "Content-Type": "application/json", token }, body },
    { method: "POST", path: "/webhook/set", headers: { "Content-Type": "application/json", token }, body },
    { method: "PATCH", path: "/webhook/set", headers: { "Content-Type": "application/json", token }, body },
    { method: "POST", path: "/webhook", headers: { "Content-Type": "application/json", token }, body },
    { method: "PUT", path: "/webhook", headers: { "Content-Type": "application/json", token }, body },
    { method: "POST", path: "/instance/webhook", headers: { "Content-Type": "application/json", token }, body },
    { method: "PUT", path: "/instance/webhook", headers: { "Content-Type": "application/json", token }, body },
    { method: "POST", path: "/instance/webhook/set", headers: { "Content-Type": "application/json", token }, body },
  ];

  for (const { method, path, headers, body: b } of attempts) {
    const res = await fetchWithTimeout(`${base}${path}`, {
      method: method as "GET" | "POST" | "PUT" | "PATCH",
      headers,
      body: b,
    });
    if (res.ok) {
      return res.json().catch(() => ({}));
    }
    if (res.status !== 405) {
      const text = await res.text();
      throw new Error(`Uazapi webhook failed (${method} ${path}): ${res.status} ${text}`);
    }
  }

  throw new Error(
    "Uazapi retornou 405 (Method Not Allowed) em todos os endpoints de webhook testados. " +
      "Configure o webhook manualmente no painel da Uazapi (ex.: severo.uazapi.com) para esta instância, " +
      "apontando para: " +
      url
  );
}

/** Body for POST /message/find (buscar mensagens em um chat). */
export type FindMessagesParams = {
  token: string;
  chatid: string;
  limit?: number;
  offset?: number;
  id?: string;
  track_source?: string;
  track_id?: string;
};

/** Resposta típica: lista de mensagens com id, from, body, fromMe, etc. */
export type FindMessagesResult = {
  messages?: Array<{
    id?: string;
    from?: string;
    body?: string;
    fromMe?: boolean;
    timestamp?: number;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

export async function findMessages(params: FindMessagesParams): Promise<FindMessagesResult> {
  const base = getBaseUrl();
  const body: Record<string, unknown> = {
    chatid: params.chatid,
    limit: params.limit ?? 100,
    offset: params.offset ?? 0,
  };
  if (params.id != null) body.id = params.id;
  if (params.track_source != null) body.track_source = params.track_source;
  if (params.track_id != null) body.track_id = params.track_id;
  const res = await fetchWithTimeout(`${base}/message/find`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: params.token,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uazapi message/find failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<FindMessagesResult>;
}

export async function instanceDisconnect(token: string): Promise<unknown> {
  const base = getBaseUrl();
  const res = await fetchWithTimeout(`${base}/instance/disconnect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uazapi instance/disconnect failed: ${res.status} ${text}`);
  }

  return res.json();
}
