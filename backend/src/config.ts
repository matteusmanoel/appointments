import { assertApiKeyLookupPepperConfigured } from "./lib/api-key-pepper.js";
import { DEFAULT_AI_JOB_PROCESSING_TIMEOUT_SECONDS, resolveAiJobProcessingTimeoutSeconds } from "./lib/ai-job-timing.js";

const required = (key: string): string => {
  const v = process.env[key];
  if (v == null || v === "") throw new Error(`Missing env: ${key}`);
  return v;
};

const optional = (key: string, def: string): string => process.env[key] ?? def;
const optionalNull = (key: string): string | null => (process.env[key] ?? null) || null;

// Fail closed: em produção, sem API_KEY_LOOKUP_PEPPER o processo não sobe (o valor nunca é exposto em config).
assertApiKeyLookupPepperConfigured();

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),
  databaseUrl: required("DATABASE_URL"),
  // Conexão DIRETA (sem pooler de transação). Obrigatória para quem usa advisory lock de sessão
  // (workers/sweeps) e para migrations. Se não definida, cai para DATABASE_URL (ok em Postgres local/Supabase session mode).
  databaseUrlDirect: optional("DATABASE_URL_DIRECT", "") || required("DATABASE_URL"),
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
  evolutionApiUrl: optional("EVOLUTION_API_URL", ""),
  evolutionApiKey: optional("EVOLUTION_API_KEY", ""),
  evolutionWebhookPublicUrl: optional("EVOLUTION_WEBHOOK_PUBLIC_URL", ""),
  whatsappProvider: optional("WHATSAPP_PROVIDER", "evolution"),
  whatsappInstancePrefix: optional("WHATSAPP_INSTANCE_PREFIX", "navalhia"),
  appEncryptionKey: optional("APP_ENCRYPTION_KEY", ""),
  n8nChatTriggerUrl: optional("N8N_CHAT_TRIGGER_URL", ""),
  /** Timeout (ms) for POST ao n8n quando NATIVE_AI_DISABLED + N8N_CHAT_TRIGGER_URL. */
  n8nChatTimeoutMs: parseInt(optional("N8N_CHAT_TIMEOUT_MS", "120000"), 10),
  // AI agent (OpenAI)
  openaiApiKey: optionalNull("OPENAI_API_KEY"),
  /** When true, ai-worker never calls runAgent; use n8n se N8N_CHAT_TRIGGER_URL estiver definida. */
  nativeAiDisabled: optional("NATIVE_AI_DISABLED", "").toLowerCase() === "true",
  aiWorkerConcurrency: parseInt(optional("AI_WORKER_CONCURRENCY", "5"), 10),
  aiJobMaxAttempts: parseInt(optional("AI_JOB_MAX_ATTEMPTS", "5"), 10),
  aiJobBackoffBaseSeconds: parseInt(optional("AI_JOB_BACKOFF_BASE_SECONDS", "2"), 10),
  /** Padrão 240 s = timeout da Lambda worker_ai (180 s) + 60 s (lib/ai-job-timing.ts). ai_jobs em `processing` há mais que isto voltam à fila (ou vão a dead-letter se esgotaram tentativas). */
  aiJobProcessingTimeoutSeconds: resolveAiJobProcessingTimeoutSeconds(
    parseInt(optional("AI_JOB_PROCESSING_TIMEOUT_SECONDS", String(DEFAULT_AI_JOB_PROCESSING_TIMEOUT_SECONDS)), 10),
  ),
  /** Intervalo mínimo entre execuções do reaper em cada processo do worker. */
  aiJobReaperIntervalSeconds: parseInt(optional("AI_JOB_REAPER_INTERVAL_SECONDS", "60"), 10),
  /** Quiet window after the last user bubble before the worker flushes the turn. */
  aiInboundQuietSeconds: parseInt(optional("AI_INBOUND_QUIET_SECONDS", "8"), 10),
  // n8n outbound events (optional)
  n8nEventsWebhookUrl: optional("N8N_EVENTS_WEBHOOK_URL", ""),
  n8nEventsSecret: optional("N8N_EVENTS_SECRET", ""),
  // Knowledge (S3 + RAG)
  knowledgeS3Bucket: optionalNull("KNOWLEDGE_S3_BUCKET"),
  knowledgeS3Prefix: optional("KNOWLEDGE_S3_PREFIX", "knowledge"),
  awsRegion: optional("AWS_REGION", "us-east-1"),
} as const;
