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

export function citedTemplateDates(text: string): string[] {
  const found = new Set<string>();
  const folded = fold(text);
  if (/\bhoje\b/.test(folded)) found.add("hoje");
  if (/\bamanha\b/.test(folded)) found.add("amanha");
  for (const day of ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"]) {
    if (new RegExp(`\\b${day}\\b`).test(folded)) found.add(day);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
    found.add(`${String(m[1]).padStart(2, "0")}/${String(m[2]).padStart(2, "0")}`);
  }
  return [...found];
}

export function citedTemplatePrices(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/R\$\s*(\d{1,5})(?:[,.](\d{2}))?/gi)) {
    found.push(`${m[1]},${m[2] ?? "00"}`);
  }
  return found;
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
 * Horários, serviços, datas, preços e barbeiros citados na reescrita
 * precisam ser subconjunto dos do template. Se o template não cita
 * relógio, a reescrita também não pode inventar um.
 */
export function templateFactsPreserved(
  template: string,
  reply: string,
  catalogServices: string[] = [],
  catalogBarbers: string[] = [],
): boolean {
  if (!reply || !reply.trim()) return false;
  const templateClocks = new Set(citedTemplateClocks(template));
  const replyClocks = citedTemplateClocks(reply);
  if (replyClocks.some((clock) => !templateClocks.has(clock))) return false;
  if (templateClocks.size === 0 && replyClocks.length > 0) return false;
  const templateDates = new Set(citedTemplateDates(template));
  if (citedTemplateDates(reply).some((d) => !templateDates.has(d))) return false;
  const templatePrices = new Set(citedTemplatePrices(template));
  if (citedTemplatePrices(reply).some((p) => !templatePrices.has(p))) return false;
  if (catalogServices.length) {
    const allowed = new Set(catalogNamesMentioned(template, catalogServices).map((n) => fold(n)));
    const cited = catalogNamesMentioned(reply, catalogServices);
    if (cited.some((name) => !allowed.has(fold(name)))) return false;
  }
  if (catalogBarbers.length) {
    const allowed = new Set(catalogNamesMentioned(template, catalogBarbers).map((n) => fold(n)));
    const cited = catalogNamesMentioned(reply, catalogBarbers);
    if (cited.some((name) => !allowed.has(fold(name)))) return false;
  }
  return true;
}

export function rewriteLooksLikeSafeFallback(reply: string, forbidden: string[]): boolean {
  const folded = fold(reply);
  return forbidden.some((item) => fold(item) && fold(item) === folded);
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
