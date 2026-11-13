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

/** Problemas de configuração do provider escolhido (para log de startup; não lança). */
export function whatsappConfigProblems(env: Env = process.env): string[] {
  const provider = resolveWhatsAppProvider(env);
  const out: string[] = [];
  if (provider === "evolution") {
    if (!env.EVOLUTION_API_URL) out.push("WHATSAPP_PROVIDER=evolution mas EVOLUTION_API_URL está vazio");
    if (!env.EVOLUTION_API_KEY) out.push("WHATSAPP_PROVIDER=evolution mas EVOLUTION_API_KEY está vazio (envio e webhook falham fechados)");
    if (!env.EVOLUTION_WEBHOOK_PUBLIC_URL && !env.APP_URL) out.push("Sem EVOLUTION_WEBHOOK_PUBLIC_URL nem APP_URL: a Evolution não saberá para onde chamar");
  } else {
    if (!env.UAZAPI_BASE_URL) out.push("WHATSAPP_PROVIDER=uazapi mas UAZAPI_BASE_URL está vazio");
    if (!env.UAZAPI_ADMIN_TOKEN) out.push("WHATSAPP_PROVIDER=uazapi mas UAZAPI_ADMIN_TOKEN está vazio");
  }
  return out;
}
