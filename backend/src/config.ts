const required = (key: string): string => {
  const v = process.env[key];
  if (v == null || v === "") throw new Error(`Missing env: ${key}`);
  return v;
};

const optional = (key: string, def: string): string => process.env[key] ?? def;
const optionalNull = (key: string): string | null => (process.env[key] ?? null) || null;

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "7d"),
  toolsApiKey: optional("TOOLS_API_KEY", ""),
  barbershopId: optionalNull("BARBERSHOP_ID"),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:3002,http://localhost:8080"),
  // Billing (Stripe + SES)
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET", ""),
  stripeSecretKey: optional("STRIPE_SECRET_KEY", ""),
  stripePriceId: optional("STRIPE_PRICE_ID", ""),
  stripePriceIdEssential: optional("STRIPE_PRICE_ID_ESSENTIAL", ""),
  stripePriceIdPro: optional("STRIPE_PRICE_ID_PRO", ""),
  stripePriceIdPremium: optional("STRIPE_PRICE_ID_PREMIUM", ""),
  stripePriceIdExtraNumber: optional("STRIPE_PRICE_ID_EXTRA_NUMBER", ""),
  stripePriceIdFollowupCredit: optional("STRIPE_PRICE_ID_FOLLOWUP_CREDIT", ""),
  fromEmail: optional("FROM_EMAIL", ""),
  appUrl: optional("APP_URL", "http://localhost:3002"),
  // Uazapi (WhatsApp)
  uazapiBaseUrl: optional("UAZAPI_BASE_URL", ""),
  uazapiAdminToken: optional("UAZAPI_ADMIN_TOKEN", ""),
  uazapiWebhookPublicUrl: optional("UAZAPI_WEBHOOK_PUBLIC_URL", ""),
  uazapiRequireWebhook: optional("UAZAPI_REQUIRE_WEBHOOK", "").toLowerCase() === "true",
  appEncryptionKey: optional("APP_ENCRYPTION_KEY", ""),
  n8nChatTriggerUrl: optional("N8N_CHAT_TRIGGER_URL", ""),
  // AI agent (OpenAI)
  openaiApiKey: optionalNull("OPENAI_API_KEY"),
  aiWorkerConcurrency: parseInt(optional("AI_WORKER_CONCURRENCY", "5"), 10),
  aiJobMaxAttempts: parseInt(optional("AI_JOB_MAX_ATTEMPTS", "5"), 10),
  aiJobBackoffBaseSeconds: parseInt(optional("AI_JOB_BACKOFF_BASE_SECONDS", "2"), 10),
  // n8n outbound events (optional)
  n8nEventsWebhookUrl: optional("N8N_EVENTS_WEBHOOK_URL", ""),
  n8nEventsSecret: optional("N8N_EVENTS_SECRET", ""),
} as const;
