/**
 * Reconfigura o webhook das instâncias de WhatsApp EXISTENTES (Evolution e/ou Uazapi) para o segredo atual
 * (WHATSAPP_WEBHOOK_SECRET). Runbook: docs/RUNBOOK_WEBHOOK_SECRET.md.
 *
 * DRY-RUN POR PADRÃO: sem --apply nada é enviado a nenhuma instância (só lista o que faria, com segredo mascarado).
 * Para aplicar de verdade:  CONFIRM_RECONFIGURE=yes npx tsx scripts/reconfigure-whatsapp-webhooks.ts --apply
 *
 * Opções:
 *   --apply                 envia as chamadas (exige CONFIRM_RECONFIGURE=yes)
 *   --provider evolution|uazapi   limita a um provedor
 *   --barbershop <uuid>     limita a uma barbearia (use na 1ª execução para testar numa instância só)
 *   --only-own              só instâncias com o prefixo da NavalhIA (padrão; nunca toca instância alheia do mesmo host)
 *   --include-foreign       desliga o filtro de prefixo (não recomendado)
 *   --limit <n>             máximo de instâncias nesta execução
 */
import "../src/load-env.js";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";
import { decrypt } from "../src/integrations/encryption.js";
import { setWebhook } from "../src/integrations/uazapi/client.js";
import { setInstanceWebhook, buildInstanceWebhookBody } from "../src/integrations/whatsapp/evolution-client.js";
import { evolutionWebhookUrl } from "../src/integrations/whatsapp/evolution-session.js";
import { getWebhookSecret, maskWebhookSecret, redactWebhookSecrets, webhookErrorText, withWebhookToken } from "../src/integrations/whatsapp/webhook-auth.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

// Independente de provider-config.ts (que chega no PR #7): nome gravado no banco, ou o nome legado derivado do id.
const instancePrefix = (process.env.WHATSAPP_INSTANCE_PREFIX ?? "navalhia").trim().toLowerCase() || "navalhia";
const evolutionInstanceNameFor = (barbershopId: string, existing?: string | null): string =>
  existing && existing.trim() ? existing.trim() : `nh-${barbershopId.replace(/-/g, "").slice(0, 16)}`;
const isOwnInstanceName = (name: string): boolean => name.startsWith(`${instancePrefix}-`) || name.startsWith("nh-");

const mask = maskWebhookSecret;

type Row = {
  barbershop_id: string;
  provider: "evolution" | "uazapi";
  evolution_instance_name: string | null;
  uazapi_instance_token_encrypted: string | null;
};

async function main(): Promise<void> {
  const apply = flag("--apply");
  const secret = getWebhookSecret("evolution");
  if (!secret) {
    console.error("WHATSAPP_WEBHOOK_SECRET está vazio neste ambiente: nada a configurar. Abortando.");
    process.exit(2);
  }
  if (apply && process.env.CONFIRM_RECONFIGURE !== "yes") {
    console.error("--apply exige CONFIRM_RECONFIGURE=yes. Abortando sem enviar nada.");
    process.exit(2);
  }
  const onlyProvider = opt("--provider");
  const onlyShop = opt("--barbershop");
  const includeForeign = flag("--include-foreign");
  const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;

  const params: unknown[] = [];
  let where = "WHERE 1=1";
  if (onlyProvider) {
    params.push(onlyProvider);
    where += ` AND provider = $${params.length}`;
  }
  if (onlyShop) {
    params.push(onlyShop);
    where += ` AND barbershop_id = $${params.length}`;
  }
  const r = await pool.query<Row>(
    `SELECT barbershop_id, provider, evolution_instance_name, uazapi_instance_token_encrypted
       FROM public.barbershop_whatsapp_connections ${where} ORDER BY barbershop_id`,
    params
  );

  console.log(`[${apply ? "APPLY" : "DRY-RUN"}] segredo atual: ${mask(secret)}; ${r.rows.length} conexão(ões) encontrada(s)`);
  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of r.rows) {
    if (done >= limit) break;
    try {
      if (row.provider === "evolution") {
        const name = evolutionInstanceNameFor(row.barbershop_id, row.evolution_instance_name);
        if (!includeForeign && !isOwnInstanceName(name)) {
          console.log(`  - ${row.barbershop_id} evolution ${name}: IGNORADA (prefixo não é da NavalhIA)`);
          skipped++;
          continue;
        }
        const url = evolutionWebhookUrl();
        const body = buildInstanceWebhookBody(url).webhook;
        const shown = { ...body, headers: body.headers ? { apikey: mask(secret) } : undefined };
        console.log(`  - ${row.barbershop_id} evolution ${name}: POST /webhook/set/${name} ${JSON.stringify(shown)}`);
        if (apply) await setInstanceWebhook(name, url);
        done++;
      } else {
        const enc = row.uazapi_instance_token_encrypted;
        if (!enc) {
          console.log(`  - ${row.barbershop_id} uazapi: sem token de instância; ignorada`);
          skipped++;
          continue;
        }
        const target = config.uazapiWebhookPublicUrl;
        if (!target) throw new Error("UAZAPI_WEBHOOK_PUBLIC_URL vazio");
        const shownUrl = withWebhookToken(target.replace(/\/$/, ""), mask(secret));
        console.log(`  - ${row.barbershop_id} uazapi: setWebhook url=${shownUrl}`);
        if (apply) await setWebhook({ token: decrypt(enc, config.appEncryptionKey), url: target });
        done++;
      }
    } catch (e) {
      failed++;
      console.error(`  ! ${row.barbershop_id} ${row.provider}: ${webhookErrorText(e)}`);
    }
  }
  console.log(`${apply ? "Aplicadas" : "Simuladas"}: ${done}; ignoradas: ${skipped}; falhas: ${failed}.`);
  if (!apply) console.log("Nada foi enviado. Para aplicar: CONFIRM_RECONFIGURE=yes ... --apply (ver docs/RUNBOOK_WEBHOOK_SECRET.md).");
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(webhookErrorText(e));
  process.exit(1);
});
