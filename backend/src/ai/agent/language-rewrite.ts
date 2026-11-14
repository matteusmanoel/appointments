/**
 * A linguagem sai de uma fala-modelo (template). O LLM pode reescrever com
 * tom simpático, mas a saída passa pela checagem de fatos (horários e
 * serviços citados precisam ser os do template) e, no agente, pelo
 * ai_exposure. Se não passar, usa o template puro.
 *
 * Flag AI_AGENT_LANGUAGE_REWRITE (ou RunAgentOptions.languageRewrite).
 * Default: desligada — template puro, sem custo extra.
 */
export type LanguageRewriter = (template: string) => Promise<string | null>;

export function isLanguageRewriteEnabled(override?: boolean): boolean {
  if (override === true) return true;
  if (override === false) return false;
  const raw = String(process.env.AI_AGENT_LANGUAGE_REWRITE ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Relógios citados no texto, no formato HH:mm. Espelha citedClockHHmm do agente. */
export function citedTemplateClocks(text: string): string[] {
  const found: string[] = [];
  const re = /(?:às|as)\s+(\d{1,2})(?::(\d{2}))?\s*h?\b|\b(\d{1,2})\s*h\b|\b(\d{2}):(\d{2})\b/gi;
  for (const m of text.matchAll(re)) {
    const hour = Number(m[1] ?? m[3] ?? m[4]);
    const minute = m[2] ?? m[5] ?? "00";
    if (!Number.isFinite(hour) || hour > 23) continue;
    found.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fold(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function catalogNamesMentioned(text: string, names: string[]): string[] {
  const foldedText = fold(text);
  const hits: string[] = [];
  const sorted = [...names].filter((n) => fold(n).length >= 3).sort((a, b) => fold(b).length - fold(a).length);
  for (const name of sorted) {
    const n = fold(name);
    if (!n) continue;
    if (new RegExp(`\\b${escapeRegExp(n)}\\b`, "i").test(foldedText) || foldedText.includes(n)) {
      hits.push(name);
    }
  }
  return hits;
}

/**
 * Horários e serviços citados na reescrita precisam ser subconjunto dos do template.
 * Se o template não cita relógio, a reescrita também não pode inventar um.
 */
export function templateFactsPreserved(template: string, reply: string, catalogServices: string[] = []): boolean {
  if (!reply || !reply.trim()) return false;
  const templateClocks = new Set(citedTemplateClocks(template));
  const replyClocks = citedTemplateClocks(reply);
  if (replyClocks.some((clock) => !templateClocks.has(clock))) return false;
  if (templateClocks.size === 0 && replyClocks.length > 0) return false;
  if (catalogServices.length) {
    const allowed = new Set(catalogNamesMentioned(template, catalogServices).map((n) => fold(n)));
    const cited = catalogNamesMentioned(reply, catalogServices);
    if (cited.some((name) => !allowed.has(fold(name)))) return false;
  }
  return true;
}

export async function rewriteFromTemplate(
  template: string,
  rewriter: LanguageRewriter,
): Promise<string | null> {
  if (!template.trim()) return null;
  try {
    const rewritten = await rewriter(template);
    const text = typeof rewritten === "string" ? rewritten.trim() : "";
    return text || null;
  } catch {
    return null;
  }
}
