/**
 * Troca a instância Uazapi de um tenant. Não lê nem edita .env.
 * Nunca imprime token, URL com credenciais ou headers.
 */
import { pool } from "../../db.js";
import { assertLocalDatabaseUrl } from "../../db/local-database-url.js";
import { isLocalDatabaseUrl } from "../../db/local-database-url.js";
import { config } from "../../config.js";
import { encrypt } from "../encryption.js";
import { instanceStatus, setWebhook, type InstanceStatusResult } from "../uazapi/client.js";
import { assertSafeOutboundUrl, type HostLookup } from "../uazapi/safe-url.js";
import { isValidUuid } from "../../lib/uuid.js";

export type RotateUazapiOptions = {
  tenant: string;
  /** URL do servidor Uazapi (sem credenciais). */
  uazapiUrl: string;
  token: string;
  instanceName?: string;
  webhookUrl?: string;
  /** Só imprime os passos; não grava banco nem chama a API. */
  dryRun?: boolean;
  /** Alvo AWS: só imprime os passos, não grava nada. */
  remote?: boolean;
  /** Libera HTTP em localhost e host privado na URL da Uazapi. O webhook continua https público. */
  allowLocal?: boolean;
  lookup?: HostLookup;
  fetchImpl?: typeof fetch;
  print?: (line: string) => void;
};

export type RotateUazapiResult = {
  dryRun: boolean;
  remote: boolean;
  tenant: string;
  barbershopId?: string;
  wroteDatabase: boolean;
  webhookSet: boolean;
  instanceState?: string;
  envNamesToChange: string[];
  notes: string[];
};

export function sanitizePublicUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/[?#].*$/, "").replace(/\/\/[^@/]+@/, "//");
  }
}

function requireEncryptionKey(): string {
  const key = (process.env.APP_ENCRYPTION_KEY ?? "").trim() || config.appEncryptionKey;
  if (!key) throw new Error("APP_ENCRYPTION_KEY é necessária para gravar o token da instância (o valor não é impresso).");
  return key;
}

export function mapInstanceState(raw: InstanceStatusResult | undefined): "disconnected" | "connecting" | "connected" | "unknown" {
  if (!raw) return "unknown";
  const valid = new Set(["disconnected", "connecting", "connected"]);
  const s = raw.instance && typeof raw.instance === "object" ? raw.instance.status : undefined;
  if (typeof s === "string" && valid.has(s)) return s as "disconnected" | "connecting" | "connected";
  if (typeof raw.status === "string" && valid.has(raw.status)) return raw.status as "disconnected" | "connecting" | "connected";
  if (typeof raw.state === "string" && valid.has(raw.state)) return raw.state as "disconnected" | "connecting" | "connected";
  return "unknown";
}

export function remoteRotateSteps(params: { webhookUrl?: string }): string[] {
  return [
    "Modo --remote: nada será gravado (nem no banco, nem na Uazapi).",
    "Se a URL do servidor Uazapi mudou, altere a variável de ambiente UAZAPI_BASE_URL (Terraform: uazapi_base_url; Lambda da API e dos workers). Depois redeploy/reinício da Lambda — essa variável é lida no processo, não por mensagem.",
    "Mantenha WHATSAPP_PROVIDER=uazapi no ambiente (Terraform: whatsapp_provider) para conexões novas. O provider da conexão já existente fica no banco (coluna provider).",
    "O token da instância, o nome e o id da instância moram no banco (barbershop_whatsapp_connections: uazapi_instance_token_encrypted, uazapi_instance_name, uazapi_instance_id). Não vá no .env. APP_ENCRYPTION_KEY precisa ser a mesma da API para criptografar o token.",
    params.webhookUrl
      ? `Registre o webhook da instância nova com POST /webhook (header token da instância, body enabled, url, events messages/messages_update/connection, excludeMessages wasSentByApi) para ${sanitizePublicUrl(params.webhookUrl)}?token=<segredo NavalhIA>. A Uazapi não tem campo de cabeçalho na entrega; não cole o valor real. O backend recebe em POST /api/webhooks/uazapi.`
      : "Registre o webhook da instância nova com POST /webhook (header token da instância; body enabled, url, events messages/messages_update/connection, excludeMessages wasSentByApi) apontando para UAZAPI_WEBHOOK_PUBLIC_URL?token=<segredo NavalhIA> (deve terminar em /api/webhooks/uazapi). A Uazapi não tem campo de cabeçalho na entrega; não cole o valor real.",
    "Confira: GET /instance/status (header token) deve vir connected; um evento de teste deve aparecer no log da API; depois fale no número de teste do Mateus ou use o simulador local.",
    "Para gravar o tenant, rode este comando contra o Postgres local (sem --remote) e replique o procedimento no Neon com aprovação — este modo não escreve em banco remoto.",
  ];
}

async function resolveTenant(tenant: string): Promise<{ id: string; name: string; slug: string | null }> {
  const key = tenant.trim();
  if (!key) throw new Error("Informe --tenant com o slug ou o id da barbearia.");
  if (isValidUuid(key)) {
    const byId = await pool.query<{ id: string; name: string; slug: string | null }>(
      `SELECT id, name, slug FROM public.barbershops WHERE id = $1`,
      [key],
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const bySlug = await pool.query<{ id: string; name: string; slug: string | null }>(
    `SELECT id, name, slug FROM public.barbershops WHERE slug = $1`,
    [key],
  );
  if (bySlug.rows[0]) return bySlug.rows[0];
  throw new Error("Barbearia não encontrada.");
}

export async function rotateUazapiInstance(options: RotateUazapiOptions): Promise<RotateUazapiResult> {
  const print = options.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  const dryRun = options.dryRun === true;
  const remote = options.remote === true;
  if (!options.uazapiUrl?.trim()) throw new Error("Informe a URL do servidor Uazapi (sem credenciais).");
  if (!options.token?.trim()) throw new Error("Informe o token da instância (digitado sem eco; o valor não é impresso).");
  const parsedBase = await assertSafeOutboundUrl(options.uazapiUrl, {
    allowLocal: options.allowLocal,
    lookup: options.lookup,
  });
  const baseUrl = sanitizePublicUrl(parsedBase.toString());
  let webhookUrl = "";
  if (options.webhookUrl?.trim()) {
    const parsedHook = await assertSafeOutboundUrl(options.webhookUrl, {
      httpsOnly: true,
      lookup: options.lookup,
    });
    webhookUrl = sanitizePublicUrl(parsedHook.toString());
  }

  const envNamesToChange: string[] = [];
  const currentBase = sanitizePublicUrl(process.env.UAZAPI_BASE_URL ?? "");
  if (currentBase && currentBase !== baseUrl) {
    envNamesToChange.push("UAZAPI_BASE_URL");
  }
  if ((process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase() !== "uazapi") {
    envNamesToChange.push("WHATSAPP_PROVIDER");
  }

  const notes: string[] = [];
  if (envNamesToChange.length) {
    notes.push(
      `O processo atual lê ${envNamesToChange.join(", ")} do ambiente (não do banco). Este comando não edita o .env. Atualize esses nomes no Docker local ou no Terraform/Lambda e reinicie o processo.`,
    );
  } else {
    notes.push("A URL do servidor no ambiente já coincide. Não é preciso mexer no .env só por causa desta troca de instância.");
  }
  notes.push(
    "Token, nome e id da instância e o provider da conexão ficam no banco. getWhatsApp lê a conexão a cada mensagem — não é preciso reiniciar o container só para o token novo.",
  );

  if (remote) {
    for (const line of remoteRotateSteps({ webhookUrl: webhookUrl || undefined })) print(line);
    return {
      dryRun: true,
      remote: true,
      tenant: options.tenant,
      wroteDatabase: false,
      webhookSet: false,
      envNamesToChange,
      notes,
    };
  }

  if (!isLocalDatabaseUrl(process.env.DATABASE_URL ?? "")) {
    throw new Error("DATABASE_URL não é local. Use --remote para só imprimir os passos da AWS; este comando não grava em banco remoto.");
  }
  assertLocalDatabaseUrl();

  if (dryRun) {
    print(`Dry-run: atualizaria o tenant ${options.tenant} no banco local (provider=uazapi, token criptografado). Nada foi gravado nem enviado.`);
    if (webhookUrl) print(`Dry-run: registraria o webhook em ${webhookUrl}.`);
    else print("Dry-run: sem --webhook-url, o registro do webhook seria pulado.");
    for (const n of notes) print(n);
    return {
      dryRun: true,
      remote: false,
      tenant: options.tenant,
      wroteDatabase: false,
      webhookSet: false,
      envNamesToChange,
      notes,
    };
  }

  const shop = await resolveTenant(options.tenant);
  const encKey = requireEncryptionKey();
  const encrypted = encrypt(options.token.trim(), encKey);

  const httpOpts = {
    baseUrl,
    fetchImpl: options.fetchImpl,
    allowLocal: options.allowLocal,
    lookup: options.lookup,
  };
  const status = await instanceStatus(options.token.trim(), httpOpts);
  const state = mapInstanceState(status);
  const instanceName =
    options.instanceName?.trim() ||
    (typeof status.instance?.name === "string" ? status.instance.name : "") ||
    (typeof (status.instance as { instanceName?: string } | undefined)?.instanceName === "string"
      ? (status.instance as { instanceName: string }).instanceName
      : "") ||
    `navalhia-${shop.id.replace(/-/g, "").slice(0, 12)}`;
  const instanceIdRaw = status.instance && typeof status.instance === "object"
    ? (status.instance as { id?: unknown; instanceId?: unknown })
    : undefined;
  const instanceId =
    instanceIdRaw?.id != null
      ? String(instanceIdRaw.id)
      : instanceIdRaw?.instanceId != null
        ? String(instanceIdRaw.instanceId)
        : null;

  await pool.query(
    `INSERT INTO public.barbershop_whatsapp_connections
       (barbershop_id, provider, uazapi_instance_name, uazapi_instance_id, uazapi_instance_token_encrypted, status, last_error, updated_at)
     VALUES ($1, 'uazapi', $2, $3, $4, $5, NULL, now())
     ON CONFLICT (barbershop_id, provider) DO UPDATE SET
       uazapi_instance_name = COALESCE(EXCLUDED.uazapi_instance_name, barbershop_whatsapp_connections.uazapi_instance_name),
       uazapi_instance_id = COALESCE(EXCLUDED.uazapi_instance_id, barbershop_whatsapp_connections.uazapi_instance_id),
       uazapi_instance_token_encrypted = EXCLUDED.uazapi_instance_token_encrypted,
       status = EXCLUDED.status,
       last_error = NULL,
       updated_at = now()`,
    [shop.id, instanceName, instanceId, encrypted, state === "unknown" ? "disconnected" : state],
  );

  let webhookSet = false;
  if (webhookUrl) {
    await setWebhook({ token: options.token.trim(), url: webhookUrl, ...httpOpts });
    webhookSet = true;
  } else {
    notes.push("Sem --webhook-url: o webhook não foi registrado. Informe a URL pública do backend terminando em /api/webhooks/uazapi.");
  }

  print(`Tenant ${shop.slug ?? shop.id}: conexão uazapi atualizada no banco local. Status da instância: ${state}.`);
  if (webhookSet) print(`Webhook registrado em ${webhookUrl}.`);
  for (const n of notes) print(n);

  return {
    dryRun: false,
    remote: false,
    tenant: options.tenant,
    barbershopId: shop.id,
    wroteDatabase: true,
    webhookSet,
    instanceState: state,
    envNamesToChange,
    notes,
  };
}
