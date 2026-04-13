/**
 * Feature flag: UI do agente de IA nativo (Cérebro, Publicar, Notificações, Atendimento/inbox).
 * Build com VITE_NATIVE_AI_UI=false para releases focados em API + n8n sem expor essas telas.
 * Default: habilitado (omitir env ou qualquer valor exceto a string "false").
 */
export const nativeAiUiEnabled = import.meta.env.VITE_NATIVE_AI_UI !== "false";

/** Steps do WhatsAppSetupStepper ocultos quando nativeAiUiEnabled é false */
export const NATIVE_AI_ONLY_STEPS = ["brain", "preview", "notifications"] as const;
