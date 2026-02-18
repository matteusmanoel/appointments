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
  fromEmail: optional("FROM_EMAIL", ""),
  appUrl: optional("APP_URL", "http://localhost:3002"),
} as const;
