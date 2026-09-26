import { pool } from "../../db.js";
import { config } from "../../config.js";
import { decrypt } from "../encryption.js";
import { pingUazapi } from "../uazapi/client.js";
import { pingEvolution } from "./evolution-client.js";
import { EvolutionSession } from "./evolution-session.js";
import { UazapiSession, createUazapiToken } from "./uazapi-session.js";
import type {
  ConnectionRow,
  WhatsAppProviderName,
  WhatsAppSession,
} from "./types.js";
import { WhatsAppNotConnectedError } from "./types.js";

export { WhatsAppNotConnectedError } from "./types.js";
export type { WhatsAppSession, WhatsAppProviderName } from "./types.js";

const CONNECTION_SELECT = `
  SELECT id, barbershop_id, provider, whatsapp_phone,
         uazapi_instance_name, uazapi_instance_id, uazapi_instance_token_encrypted,
         evolution_instance_name, status, connected_at, disconnected_at, last_error
  FROM public.barbershop_whatsapp_connections
`;

export function defaultWhatsAppProvider(): WhatsAppProviderName {
  const explicit = (process.env.WHATSAPP_PROVIDER ?? "").toLowerCase();
  if (explicit === "evolution" || explicit === "uazapi") return explicit;
  if (process.env.EVOLUTION_API_URL) return "evolution";
  return "uazapi";
}

export async function loadConnection(
  barbershopId: string,
  provider?: WhatsAppProviderName,
): Promise<ConnectionRow | null> {
  const providerFilter = provider ? "AND provider = $2" : "";
  const params = provider ? [barbershopId, provider] : [barbershopId];
  try {
    const r = await pool.query<ConnectionRow>(
      `${CONNECTION_SELECT}
       WHERE barbershop_id = $1 ${providerFilter}
       ORDER BY CASE WHEN status = 'connected' THEN 0 WHEN status = 'connecting' THEN 1 ELSE 2 END,
                CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END,
                updated_at DESC
       LIMIT 1`,
      params,
    );
    return r.rows[0] ?? null;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42703") {
      const r = await pool.query<ConnectionRow>(
        `SELECT id, barbershop_id, provider, whatsapp_phone,
                uazapi_instance_name, uazapi_instance_id, uazapi_instance_token_encrypted,
                NULL::text AS evolution_instance_name, status, connected_at, disconnected_at, last_error
         FROM public.barbershop_whatsapp_connections
         WHERE barbershop_id = $1 ${providerFilter}
         ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`,
        params,
      );
      return r.rows[0] ?? null;
    }
    throw e;
  }
}

function sessionFromRow(row: ConnectionRow): WhatsAppSession {
  if (row.provider === "evolution") {
    const name = row.evolution_instance_name ?? `nh-${row.barbershop_id.replace(/-/g, "").slice(0, 16)}`;
    return new EvolutionSession(row.barbershop_id, name, row);
  }
  const enc = row.uazapi_instance_token_encrypted;
  if (!enc || !config.appEncryptionKey) {
    throw new WhatsAppNotConnectedError("Token Uazapi ausente");
  }
  const token = decrypt(enc, config.appEncryptionKey);
  return new UazapiSession(row.barbershop_id, token, row);
}

/**
 * Resolve the WhatsApp session for a barbershop. Callers never see instanceName/token.
 */
export async function getWhatsApp(barbershopId: string): Promise<WhatsAppSession> {
  const row = await loadConnection(barbershopId);
  if (!row) throw new WhatsAppNotConnectedError();
  return sessionFromRow(row);
}

export async function getWhatsAppOrNull(barbershopId: string): Promise<WhatsAppSession | null> {
  try {
    return await getWhatsApp(barbershopId);
  } catch (e) {
    if (e instanceof WhatsAppNotConnectedError) return null;
    throw e;
  }
}

export async function ensureWhatsAppSession(
  barbershopId: string,
  provider: WhatsAppProviderName = defaultWhatsAppProvider(),
): Promise<WhatsAppSession> {
  let row = await loadConnection(barbershopId, provider);
  if (row && row.provider === provider) return sessionFromRow(row);

  if (provider === "evolution") {
    const name = `nh-${barbershopId.replace(/-/g, "").slice(0, 16)}`;
    await pool.query(
      `INSERT INTO public.barbershop_whatsapp_connections
         (barbershop_id, provider, evolution_instance_name, status, updated_at)
       VALUES ($1, 'evolution', $2, 'disconnected', now())
       ON CONFLICT (barbershop_id, provider) DO UPDATE SET
         evolution_instance_name = COALESCE(barbershop_whatsapp_connections.evolution_instance_name, EXCLUDED.evolution_instance_name),
         updated_at = now()`,
      [barbershopId, name],
    );
    row = await loadConnection(barbershopId, "evolution");
    if (!row) throw new WhatsAppNotConnectedError("Falha ao criar conexão Evolution");
    return sessionFromRow(row);
  }

  const instanceName = `navalhia-${barbershopId.replace(/-/g, "").slice(0, 12)}`;
  await createUazapiToken(barbershopId, instanceName);
  row = await loadConnection(barbershopId, "uazapi");
  if (!row) throw new WhatsAppNotConnectedError("Falha ao criar conexão Uazapi");
  return sessionFromRow(row);
}

export async function pingDefaultProvider(): Promise<{
  api: string;
  provider: WhatsAppProviderName;
  reachable: { ok: boolean; status?: number; error?: string };
}> {
  const provider = defaultWhatsAppProvider();
  const reachable = provider === "evolution" ? await pingEvolution() : await pingUazapi();
  return { api: "ok", provider, reachable };
}
