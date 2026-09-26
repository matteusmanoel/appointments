import { pool } from "../db.js";
import { brPhoneMatchKeys, phoneForStorage } from "../lib/phone-match.js";
import { loadConnection } from "../integrations/whatsapp/index.js";
import { fetchProfilePictureUrl } from "../integrations/whatsapp/evolution-client.js";

/** Busca a foto do WhatsApp só quando o cliente ainda não tem photo_url. Não lança. */
export async function syncClientPhotoIfMissing(barbershopId: string, phone: string): Promise<string | null> {
  const stored = phoneForStorage(phone);
  if (!stored) return null;
  const keys = brPhoneMatchKeys(stored);
  if (keys.length === 0) return null;

  const existing = await pool.query<{ photo_url: string | null }>(
    `SELECT photo_url
     FROM public.clients
     WHERE barbershop_id = $1
       AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])
     LIMIT 1`,
    [barbershopId, keys],
  );
  const row = existing.rows[0];
  if (!row || row.photo_url) return row?.photo_url ?? null;

  const conn = await loadConnection(barbershopId, "evolution");
  const instanceName = conn?.evolution_instance_name;
  if (!instanceName || conn.status !== "connected") return null;

  let url: string | null;
  try {
    url = await fetchProfilePictureUrl(instanceName, stored);
  } catch (e) {
    console.warn("[client-photo] fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
  if (!url) return null;

  await pool.query(
    `UPDATE public.clients
     SET photo_url = $3, updated_at = now()
     WHERE barbershop_id = $1
       AND photo_url IS NULL
       AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($2::text[])`,
    [barbershopId, keys, url],
  );
  return url;
}

/** Não bloqueia o turno do WhatsApp. */
export function scheduleClientPhotoSync(barbershopId: string, phone: string): void {
  void syncClientPhotoIfMissing(barbershopId, phone).catch((e) => {
    console.warn("[client-photo] sync failed:", e instanceof Error ? e.message : e);
  });
}
