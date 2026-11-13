import type { WhatsAppProviderName } from "./types.js";

type Env = Record<string, string | undefined>;

/**
 * Provider de WhatsApp. Ordem: WHATSAPP_PROVIDER explícito → evolution (padrão).
 * (Antes, sem env nenhuma, caía em uazapi, e o Terraform fixava "uazapi" com EVOLUTION_API_URL vazio.)
 */
export function resolveWhatsAppProvider(env: Env = process.env): WhatsAppProviderName {
  const explicit = (env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "evolution" || explicit === "uazapi") return explicit;
  return "evolution";
}

/** Prefixo das instâncias criadas pela NavalhIA no host de WhatsApp (isola de outros apps no mesmo host). */
export function instancePrefix(env: Env = process.env): string {
  const raw = (env.WHATSAPP_INSTANCE_PREFIX ?? "navalhia").trim().toLowerCase();
  const clean = raw.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  return clean || "navalhia";
}

/** Nome de instância novo: `<prefixo>-<16 hex do barbershop_id>`. Instâncias antigas (`nh-...`) seguem valendo via banco. */
export function evolutionInstanceNameFor(barbershopId: string, existing?: string | null, env: Env = process.env): string {
  if (existing && existing.trim()) return existing.trim();
  return `${instancePrefix(env)}-${barbershopId.replace(/-/g, "").slice(0, 16)}`;
}

/** Instância criada por esta aplicação (prefixo atual ou legado `nh-`)? Use para nunca agir em instância alheia do mesmo host. */
export function isOwnInstanceName(name: string, env: Env = process.env): boolean {
  return name.startsWith(`${instancePrefix(env)}-`) || name.startsWith("nh-");
}

/**
 * Aviso de MUDANÇA DE PADRÃO: antes, sem WHATSAPP_PROVIDER o código caía em "uazapi"; agora cai em "evolution".
 * Quem rodava sem a variável (e usa Uazapi) precisa defini-la explicitamente, senão novas conexões nascem na Evolution.
 * Retorna null quando a variável está definida e válida.
 */
export function providerDefaultNotice(env: Env = process.env): string | null {
  const explicit = (env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "evolution" || explicit === "uazapi") return null;
  return (
    `WHATSAPP_PROVIDER ${explicit ? `inválido ("${explicit}")` : "não definido"}: usando o padrão "evolution". ` +
    `ATENÇÃO: o padrão anterior era "uazapi". Se esta instalação usa Uazapi, defina WHATSAPP_PROVIDER=uazapi explicitamente ` +
    `(Terraform: variável whatsapp_provider); conexões já existentes mantêm o provedor gravado no banco.`
  );
}

/**
 * Problemas de configuração do provider escolhido (para log de startup; não lança).
 * Os segredos de webhook (WHATSAPP_WEBHOOK_SECRET / WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN) são exigidos pelos webhooks:
 * sem eles respondem 503 (fail closed) e nenhuma mensagem chega. A ordem de merge fica só em docs/WHATSAPP_PROVIDER.md.
 */
export function whatsappConfigProblems(env: Env = process.env): string[] {
  const provider = resolveWhatsAppProvider(env);
  const out: string[] = [];
  if (provider === "evolution") {
    if (!env.EVOLUTION_API_URL) out.push("WHATSAPP_PROVIDER=evolution mas EVOLUTION_API_URL está vazio (não há como falar com a Evolution)");
    if (!env.EVOLUTION_API_KEY) {
      out.push("WHATSAPP_PROVIDER=evolution mas EVOLUTION_API_KEY está vazio: a Evolution recusa envio/criação de instância (a chave só autentica a chamada à API, não o webhook)");
    }
    if (!env.EVOLUTION_WEBHOOK_PUBLIC_URL && !env.APP_URL) out.push("Sem EVOLUTION_WEBHOOK_PUBLIC_URL nem APP_URL: a Evolution não saberá para onde chamar");
  } else {
    if (!env.UAZAPI_BASE_URL) out.push("WHATSAPP_PROVIDER=uazapi mas UAZAPI_BASE_URL está vazio");
    if (!env.UAZAPI_ADMIN_TOKEN) out.push("WHATSAPP_PROVIDER=uazapi mas UAZAPI_ADMIN_TOKEN está vazio");
  }
  if (!(env.WHATSAPP_WEBHOOK_SECRET ?? "").trim()) {
    out.push(
      "WHATSAPP_WEBHOOK_SECRET vazio: os webhooks Uazapi/Evolution respondem 503 (fail closed) e nenhuma mensagem chega; " +
        "o EVOLUTION_API_KEY NÃO serve de segredo de webhook"
    );
  }
  const metaInUse = Boolean((env.WHATSAPP_ACCESS_TOKEN ?? "").trim() || (env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim());
  if (metaInUse) {
    if (!(env.WHATSAPP_APP_SECRET ?? "").trim()) out.push("Meta Cloud API configurada mas WHATSAPP_APP_SECRET vazio: POST /api/webhooks/whatsapp responde 503 (fail closed)");
    if (!(env.WHATSAPP_VERIFY_TOKEN ?? "").trim()) out.push("Meta Cloud API configurada mas WHATSAPP_VERIFY_TOKEN vazio: o handshake GET do webhook falha");
  }
  return out;
}

/** Linhas de log de startup (aviso de padrão + problemas); compartilhado por index.ts e lambda.ts. */
export function startupWhatsappWarnings(env: Env = process.env): string[] {
  const provider = resolveWhatsAppProvider(env);
  const lines: string[] = [];
  const notice = providerDefaultNotice(env);
  if (notice) lines.push(`[startup] whatsapp: ${notice}`);
  for (const p of whatsappConfigProblems(env)) lines.push(`[startup] whatsapp(${provider}): ${p}`);
  return lines;
}
