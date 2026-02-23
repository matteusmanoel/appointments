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

export type AgentProfile = {
  tonePreset: string;
  emojiLevel: EmojiLevel;
  slangLevel: SlangLevel;
  verbosity: Verbosity;
  salesStyle: SalesStyle;
  hardRules?: AgentProfileHardRules;
};

const MAX_ADDITIONAL_INSTRUCTIONS_LENGTH = 2000;

/** Forbidden patterns in additional_instructions (regex or substring, case-insensitive). */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp | string; reason: string }> = [
  { pattern: /pedir\s+telefone|peça\s+o\s+telefone|solicite\s+telefone|telefone\s+do\s+cliente/gi, reason: "Não pode instruir o agente a pedir telefone." },
  { pattern: /uuid|id\s+interno|expor\s+id|mostrar\s+id|reveal\s+id/gi, reason: "Não pode instruir a expor IDs/UUIDs." },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, reason: "Não pode incluir UUIDs no texto." },
  { pattern: /ignore\s+as\s+regras|ignore\s+guardrails|desativar\s+regras/gi, reason: "Não pode desativar regras do sistema." },
  { pattern: /system\s+prompt|instrução\s+de\s+sistema\s+completa/gi, reason: "Instruções não podem substituir o sistema." },
];

const TONE_PRESET_SNIPPETS: Record<string, string> = {
  default: "Fale estilo WhatsApp: curto, simpático, descolado. Use gírias leves. Emojis só quando fizer sentido.",
  formal: "Fale de forma educada e profissional, sem gírias. Mensagens claras e objetivas.",
  casual: "Fale bem descolado e próximo, como um amigo. Pode usar gírias e expressões do dia a dia.",
  minimal: "Seja extremamente objetivo. Respostas curtas, sem enrolação. Mínimo de emojis.",
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
  parts.push(TONE_PRESET_SNIPPETS[profile.tonePreset] ?? TONE_PRESET_SNIPPETS.default);
  parts.push(EMOJI_LEVEL_SNIPPETS[profile.emojiLevel] ?? EMOJI_LEVEL_SNIPPETS.medium);
  parts.push(SLANG_LEVEL_SNIPPETS[profile.slangLevel] ?? SLANG_LEVEL_SNIPPETS.medium);
  parts.push(VERBOSITY_SNIPPETS[profile.verbosity] ?? VERBOSITY_SNIPPETS.normal);
  parts.push(SALES_STYLE_SNIPPETS[profile.salesStyle] ?? SALES_STYLE_SNIPPETS.soft);
  const rules = profile.hardRules;
  if (rules?.doNotAskPhone !== false) parts.push("Nunca peça o telefone do cliente.");
  if (rules?.doNotInventPlaces !== false) parts.push("Nunca invente endereços ou lugares.");
  if (rules?.alwaysSteerToBooking !== false) parts.push("Sempre direcione para agendamento quando apropriado.");
  if (rules?.showTopServicesWhenUnknown !== false) parts.push("Quando o cliente pedir serviço que não existe, mostre os principais serviços e CTA para agendar.");
  return parts.join(" ");
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

/** Default profile when none is set. */
export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  tonePreset: "default",
  emojiLevel: "medium",
  slangLevel: "medium",
  verbosity: "normal",
  salesStyle: "soft",
  hardRules: {
    doNotAskPhone: true,
    doNotInventPlaces: true,
    alwaysSteerToBooking: true,
    showTopServicesWhenUnknown: true,
  },
};

/**
 * Normalize profile from DB (partial) to full AgentProfile.
 */
export function normalizeProfile(profile: unknown): AgentProfile {
  if (!profile || typeof profile !== "object") return DEFAULT_AGENT_PROFILE;
  const p = profile as Record<string, unknown>;
  return {
    tonePreset: typeof p.tonePreset === "string" ? p.tonePreset : DEFAULT_AGENT_PROFILE.tonePreset,
    emojiLevel: ["none", "low", "medium"].includes(String(p.emojiLevel)) ? (p.emojiLevel as EmojiLevel) : DEFAULT_AGENT_PROFILE.emojiLevel,
    slangLevel: ["low", "medium", "high"].includes(String(p.slangLevel)) ? (p.slangLevel as SlangLevel) : DEFAULT_AGENT_PROFILE.slangLevel,
    verbosity: ["short", "normal"].includes(String(p.verbosity)) ? (p.verbosity as Verbosity) : DEFAULT_AGENT_PROFILE.verbosity,
    salesStyle: ["soft", "direct"].includes(String(p.salesStyle)) ? (p.salesStyle as SalesStyle) : DEFAULT_AGENT_PROFILE.salesStyle,
    hardRules: p.hardRules && typeof p.hardRules === "object" ? (p.hardRules as AgentProfileHardRules) : DEFAULT_AGENT_PROFILE.hardRules,
  };
}
