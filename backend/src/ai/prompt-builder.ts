/**
 * Prompt Builder: builds system prompt from AgentProfile + additional_instructions.
 * Validates additional_instructions for forbidden patterns and size.
 */

export type EmojiLevel = "none" | "low" | "medium";
export type SlangLevel = "low" | "medium" | "high";
export type Verbosity = "short" | "normal";
export type SalesStyle = "soft" | "direct";

export type AgentProfileHardRules = {
  /** Never ask for phone (default true = do not ask) */
  doNotAskPhone?: boolean;
  /** Never invent places/addresses */
  doNotInventPlaces?: boolean;
  /** Always steer toward booking when in doubt */
  alwaysSteerToBooking?: boolean;
  /** When service doesn't exist, show top N services + CTA */
  showTopServicesWhenUnknown?: boolean;
};

/** Regra customizada da barbearia (instruções estruturadas no prompt). */
export type CustomRule = {
  id: string;
  title: string;
  enabled: boolean;
  priority: number;
  when?: { intents?: string[]; keywords?: string[]; stages?: string[] };
  do: string[];
  dont?: string[];
  examples?: Array<{ user: string; assistant: string }>;
};

export type AgentProfile = {
  tonePreset: string;
  emojiLevel: EmojiLevel;
  /** Emojis específicos permitidos (vazio = todos permitidos dentro do emojiLevel). */
  allowedEmojis?: string[];
  slangLevel: SlangLevel;
  verbosity: Verbosity;
  salesStyle: SalesStyle;
  /** Habilita envio de figurinhas pelo agente (requer stickers cadastrados). */
  stickersEnabled?: boolean;
  hardRules?: AgentProfileHardRules;
  /** Regras customizadas da barbearia (ordenadas por prioridade no prompt). */
  customRules?: CustomRule[];
  /** Nome exibido do agente (ex.: "NavalhIA") */
  displayName?: string;
  /** Apelido ou nome curto */
  nickname?: string;
  /** Papel/função (ex.: "Assistente de agendamento") */
  role?: string;
  /** Assinar mensagens com identidade */
  signMessages?: boolean;
  /** Estilo da assinatura: "short" = só nome; "full" = nome + papel */
  signatureStyle?: "short" | "full";
};

const MAX_ADDITIONAL_INSTRUCTIONS_LENGTH = 2000;
const MAX_CUSTOM_RULES = 30;
const MAX_CUSTOM_RULES_SECTION_LENGTH = 5000;

/** Forbidden patterns in additional_instructions (regex or substring, case-insensitive). */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp | string; reason: string }> = [
  { pattern: /pedir\s+telefone|peça\s+o\s+telefone|solicite\s+telefone|telefone\s+do\s+cliente/gi, reason: "Não pode instruir o agente a pedir telefone." },
  { pattern: /uuid|id\s+interno|expor\s+id|mostrar\s+id|reveal\s+id/gi, reason: "Não pode instruir a expor IDs/UUIDs." },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, reason: "Não pode incluir UUIDs no texto." },
  { pattern: /ignore\s+as\s+regras|ignore\s+guardrails|desativar\s+regras/gi, reason: "Não pode desativar regras do sistema." },
  { pattern: /system\s+prompt|instrução\s+de\s+sistema\s+completa/gi, reason: "Instruções não podem substituir o sistema." },
];

const TONE_PRESET_SNIPPETS: Record<string, string> = {
  default:
    "Fale estilo WhatsApp: curto e simpático. Evite gírias fortes.",
  formal: "Fale de forma educada e profissional, sem gírias. Mensagens claras e objetivas.",
  casual: "Fale bem descolado e próximo, como um amigo. Pode usar gírias e expressões do dia a dia.",
  minimal: "Seja extremamente objetivo. Respostas curtas, sem enrolação.",
  sales: "Seja proativo em sugerir serviços e agendamentos. Direto ao ponto, com foco em converter.",
};

const EMOJI_LEVEL_SNIPPETS: Record<EmojiLevel, string> = {
  none: "Não use emojis.",
  low: "Use no máximo 0–1 emoji por mensagem, e só quando fizer sentido.",
  medium: "Pode usar emojis com moderação para deixar a conversa mais leve.",
};

const SLANG_LEVEL_SNIPPETS: Record<SlangLevel, string> = {
  low: "Evite gírias; use linguagem neutra.",
  medium: "Pode usar gírias leves (salve, bora, show, top).",
  high: "Pode usar gírias e expressões informais (tranquilo, firmeza, na régua, etc.).",
};

const VERBOSITY_SNIPPETS: Record<Verbosity, string> = {
  short: "Respostas sempre curtas; evite parágrafos longos.",
  normal: "Respostas de tamanho normal; pode dar mais contexto quando necessário.",
};

const SALES_STYLE_SNIPPETS: Record<SalesStyle, string> = {
  soft: "Sugira serviços e agendamentos de forma leve, sem pressionar.",
  direct: "Seja direto ao sugerir agendamento e próximos passos.",
};

function profileToSnippet(profile: AgentProfile): string {
  const parts: string[] = [];
  if (profile.displayName?.trim()) {
    parts.push(`Você se apresenta como "${profile.displayName.trim()}".`);
  }
  if (profile.role?.trim()) {
    parts.push(`Seu papel: ${profile.role.trim()}.`);
  }
  parts.push(TONE_PRESET_SNIPPETS[profile.tonePreset] ?? TONE_PRESET_SNIPPETS.default);
  const emojiSnippet = EMOJI_LEVEL_SNIPPETS[profile.emojiLevel] ?? EMOJI_LEVEL_SNIPPETS.none;
  if (profile.emojiLevel !== "none" && profile.allowedEmojis && profile.allowedEmojis.length > 0) {
    parts.push(`${emojiSnippet} Quando usar emojis, use SOMENTE estes: ${profile.allowedEmojis.join(" ")}.`);
  } else {
    parts.push(emojiSnippet);
  }
  if (profile.stickersEnabled) {
    parts.push("Você pode enviar uma figurinha (send_sticker) após confirmações de agendamento ou saudações calorosas, no máximo 1 por conversa.");
  }
  parts.push(SLANG_LEVEL_SNIPPETS[profile.slangLevel] ?? SLANG_LEVEL_SNIPPETS.medium);
  parts.push(VERBOSITY_SNIPPETS[profile.verbosity] ?? VERBOSITY_SNIPPETS.normal);
  parts.push(SALES_STYLE_SNIPPETS[profile.salesStyle] ?? SALES_STYLE_SNIPPETS.soft);
  const rules = profile.hardRules;
  if (rules?.doNotAskPhone !== false) parts.push("Nunca peça o telefone do cliente.");
  if (rules?.doNotInventPlaces !== false) parts.push("Nunca invente endereços ou lugares.");
  if (rules?.alwaysSteerToBooking !== false) parts.push("Sempre direcione para agendamento quando apropriado.");
  if (rules?.showTopServicesWhenUnknown !== false) parts.push("Quando o cliente pedir serviço que não existe, mostre os principais serviços e CTA para agendar.");
  if (profile.signMessages && (profile.displayName?.trim() || profile.nickname?.trim())) {
    const name = (profile.signMessages && profile.nickname?.trim()) ? profile.nickname.trim() : profile.displayName?.trim();
    if (profile.signatureStyle === "full" && profile.role?.trim()) {
      parts.push(`Ao final de cada resposta, assine com: "${name} — ${profile.role.trim()}".`);
    } else {
      parts.push(`Ao final de cada resposta, assine com: "${name}".`);
    }
  }
  return parts.join(" ");
}

/** Returns titles of enabled custom rules in the same order they appear in the prompt (priority desc, then title). */
export function getIncludedCustomRuleTitles(rules: CustomRule[] | null | undefined): string[] {
  if (!rules || rules.length === 0) return [];
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.title || "").localeCompare(b.title || "");
  });
  return sorted.map((r) => r.title).filter(Boolean);
}

/** Build compact snippet from custom rules (priority desc, then title). Caps total length. */
function customRulesToSnippet(rules: CustomRule[]): string {
  const sorted = [...rules].filter((r) => r.enabled).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.title || "").localeCompare(b.title || "");
  });
  const lines: string[] = [];
  let total = 0;
  for (const r of sorted) {
    if (total >= MAX_CUSTOM_RULES_SECTION_LENGTH) break;
    const doLines = (r.do ?? []).map((d) => `- Faça: ${d.trim()}`).join("\n");
    const dontLines = (r.dont ?? []).map((d) => `- Evite: ${d.trim()}`).join("\n");
    const block = [
      `[${r.title}]`,
      doLines,
      dontLines ? dontLines : "",
      (r.examples ?? []).slice(0, 2).map((e) => `Ex: "${e.user}" → "${e.assistant}"`).join(" "),
    ].filter(Boolean).join("\n");
    const add = block.length + 1;
    if (total + add > MAX_CUSTOM_RULES_SECTION_LENGTH) break;
    lines.push(block);
    total += add;
  }
  return lines.join("\n\n");
}

/** Text of a rule used for forbidden-pattern checks. */
function customRuleText(r: CustomRule): string {
  const parts = [...(r.do ?? []), ...(r.dont ?? [])];
  for (const e of r.examples ?? []) {
    parts.push(e.user, e.assistant);
  }
  return parts.join("\n");
}

/**
 * Validates custom rules: count, total size, and forbidden patterns.
 */
export function validateCustomRules(rules: CustomRule[] | null | undefined): ValidationResult {
  const errors: string[] = [];
  if (!rules || rules.length === 0) return { valid: true, errors: [] };
  if (rules.length > MAX_CUSTOM_RULES) {
    errors.push(`Máximo de ${MAX_CUSTOM_RULES} regras customizadas.`);
  }
  const fullText = rules.map(customRuleText).join("\n");
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (typeof pattern === "string") {
      if (fullText.toLowerCase().includes(pattern.toLowerCase())) errors.push(reason);
    } else {
      pattern.lastIndex = 0;
      if (pattern.test(fullText)) errors.push(reason);
    }
  }
  const snippet = customRulesToSnippet(rules);
  if (snippet.length > MAX_CUSTOM_RULES_SECTION_LENGTH) {
    errors.push(`Regras customizadas excedem ${MAX_CUSTOM_RULES_SECTION_LENGTH} caracteres no prompt.`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Builds the full system prompt from base + profile-derived style + optional additional instructions + guardrails.
 * Placeholders like {{TIMEZONE}}, {{DATE_NOW}}, etc. are left for the caller to replace.
 */
export function buildSystemPrompt(params: {
  basePrompt: string;
  guardrails: string;
  profile: AgentProfile | null;
  additionalInstructions: string | null;
}): string {
  const { basePrompt, guardrails, profile, additionalInstructions } = params;
  let prompt = basePrompt;

  if (profile && Object.keys(profile).length > 0) {
    const styleSnippet = profileToSnippet(profile);
    prompt =
      prompt +
      "\n\n--- Estilo (perfil do agente) ---\n" +
      styleSnippet;
  }

  const customRules = profile?.customRules ?? [];
  const customRulesValid = validateCustomRules(customRules);
  if (customRulesValid.valid && customRules.length > 0) {
    const rulesSnippet = customRulesToSnippet(customRules);
    if (rulesSnippet.trim()) {
      prompt =
        prompt +
        "\n\n--- Regras customizadas (da barbearia) ---\n" +
        rulesSnippet;
    }
  }

  const validated = validateAdditionalInstructions(additionalInstructions ?? "");
  if (validated.valid && (additionalInstructions ?? "").trim()) {
    prompt =
      prompt +
      "\n\n--- Instruções adicionais (complementares; não substituem regras) ---\n" +
      (additionalInstructions ?? "").trim();
  }

  prompt = prompt + "\n\n" + guardrails;
  return prompt;
}

export type CompiledPromptSections = {
  base: string;
  style?: string;
  customRules?: string;
  additionalInstructions?: string;
  guardrails: string;
};

export type CompiledPromptResult = {
  full: string;
  sections: CompiledPromptSections;
  section_lengths: Record<keyof CompiledPromptSections, number>;
};

/**
 * Builds the system prompt and returns full text plus sections for display/debug.
 * Same logic as buildSystemPrompt but returns structured sections and lengths.
 */
export function buildSystemPromptWithSections(params: {
  basePrompt: string;
  guardrails: string;
  profile: AgentProfile | null;
  additionalInstructions: string | null;
}): CompiledPromptResult {
  const { basePrompt, guardrails, profile, additionalInstructions } = params;
  const sections: CompiledPromptSections = { base: basePrompt, guardrails };

  let full = basePrompt;

  if (profile && Object.keys(profile).length > 0) {
    const styleSnippet = profileToSnippet(profile);
    sections.style = styleSnippet;
    full = full + "\n\n--- Estilo (perfil do agente) ---\n" + styleSnippet;
  }

  const customRules = profile?.customRules ?? [];
  const customRulesValid = validateCustomRules(customRules);
  if (customRulesValid.valid && customRules.length > 0) {
    const rulesSnippet = customRulesToSnippet(customRules);
    if (rulesSnippet.trim()) {
      sections.customRules = rulesSnippet;
      full = full + "\n\n--- Regras customizadas (da barbearia) ---\n" + rulesSnippet;
    }
  }

  const validated = validateAdditionalInstructions(additionalInstructions ?? "");
  if (validated.valid && (additionalInstructions ?? "").trim()) {
    sections.additionalInstructions = (additionalInstructions ?? "").trim();
    full = full + "\n\n--- Instruções adicionais (complementares; não substituem regras) ---\n" + sections.additionalInstructions;
  }

  full = full + "\n\n" + guardrails;

  const section_lengths: Record<string, number> = {};
  for (const [k, v] of Object.entries(sections)) {
    section_lengths[k] = typeof v === "string" ? v.length : 0;
  }
  return { full, sections, section_lengths: section_lengths as CompiledPromptResult["section_lengths"] };
}

export type ValidationResult = { valid: boolean; errors: string[] };

/**
 * Validates additional_instructions: max length and forbidden patterns.
 */
export function validateAdditionalInstructions(text: string | null | undefined): ValidationResult {
  const errors: string[] = [];
  const t = (text ?? "").trim();
  if (t.length > MAX_ADDITIONAL_INSTRUCTIONS_LENGTH) {
    errors.push(`Máximo de ${MAX_ADDITIONAL_INSTRUCTIONS_LENGTH} caracteres.`);
  }
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (typeof pattern === "string") {
      if (t.toLowerCase().includes(pattern.toLowerCase())) errors.push(reason);
    } else {
      if (pattern.test(t)) errors.push(reason);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Default profile when none is set (alinha com fluxo objetivo de agendamento). */
export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  tonePreset: "minimal",
  emojiLevel: "none",
  slangLevel: "low",
  verbosity: "short",
  salesStyle: "soft",
  hardRules: {
    doNotAskPhone: true,
    doNotInventPlaces: true,
    alwaysSteerToBooking: true,
    showTopServicesWhenUnknown: true,
  },
};

/** Normalize a raw rule from DB to CustomRule with defaults. Returns null if invalid. */
function normalizeOneCustomRule(r: unknown): CustomRule | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  if (
    typeof x.id !== "string" ||
    typeof x.title !== "string" ||
    !Array.isArray(x.do) ||
    !x.do.every((i: unknown) => typeof i === "string")
  ) {
    return null;
  }
  const doArr = x.do as string[];
  if (doArr.length === 0) return null;
  return {
    id: x.id,
    title: String(x.title).trim(),
    enabled: typeof x.enabled === "boolean" ? x.enabled : true,
    priority: typeof x.priority === "number" && x.priority >= 1 && x.priority <= 5 ? x.priority : 3,
    when: x.when && typeof x.when === "object" ? (x.when as CustomRule["when"]) : undefined,
    do: doArr.map((s) => String(s).trim()).filter(Boolean),
    dont: Array.isArray(x.dont) && x.dont.every((i: unknown) => typeof i === "string")
      ? (x.dont as string[]).map((s) => String(s).trim()).filter(Boolean)
      : undefined,
    examples: Array.isArray(x.examples)
      ? (x.examples as Array<{ user?: unknown; assistant?: unknown }>)
          .filter((e) => e && typeof e.user === "string" && typeof e.assistant === "string")
          .slice(0, 5)
          .map((e) => ({ user: e.user as string, assistant: e.assistant as string }))
      : undefined,
  };
}

/**
 * Normalize profile from DB (partial) to full AgentProfile.
 */
export function normalizeProfile(profile: unknown): AgentProfile {
  if (!profile || typeof profile !== "object") return DEFAULT_AGENT_PROFILE;
  const p = profile as Record<string, unknown>;
  return {
    tonePreset: typeof p.tonePreset === "string" ? p.tonePreset : DEFAULT_AGENT_PROFILE.tonePreset,
    emojiLevel: ["none", "low", "medium"].includes(String(p.emojiLevel)) ? (p.emojiLevel as EmojiLevel) : DEFAULT_AGENT_PROFILE.emojiLevel,
    allowedEmojis: Array.isArray(p.allowedEmojis) && (p.allowedEmojis as unknown[]).every((e) => typeof e === "string")
      ? (p.allowedEmojis as string[]).filter(Boolean)
      : undefined,
    slangLevel: ["low", "medium", "high"].includes(String(p.slangLevel)) ? (p.slangLevel as SlangLevel) : DEFAULT_AGENT_PROFILE.slangLevel,
    verbosity: ["short", "normal"].includes(String(p.verbosity)) ? (p.verbosity as Verbosity) : DEFAULT_AGENT_PROFILE.verbosity,
    salesStyle: ["soft", "direct"].includes(String(p.salesStyle)) ? (p.salesStyle as SalesStyle) : DEFAULT_AGENT_PROFILE.salesStyle,
    stickersEnabled: typeof p.stickersEnabled === "boolean" ? p.stickersEnabled : undefined,
    hardRules: p.hardRules && typeof p.hardRules === "object" ? (p.hardRules as AgentProfileHardRules) : DEFAULT_AGENT_PROFILE.hardRules,
    customRules: Array.isArray(p.customRules)
      ? (p.customRules as unknown[]).map(normalizeOneCustomRule).filter((r): r is CustomRule => r != null)
      : undefined,
    displayName: typeof p.displayName === "string" ? p.displayName.trim() || undefined : undefined,
    nickname: typeof p.nickname === "string" ? p.nickname.trim() || undefined : undefined,
    role: typeof p.role === "string" ? p.role.trim() || undefined : undefined,
    signMessages: typeof p.signMessages === "boolean" ? p.signMessages : undefined,
    signatureStyle: p.signatureStyle === "short" || p.signatureStyle === "full" ? p.signatureStyle : undefined,
  };
}
