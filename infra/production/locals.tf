locals {
  project     = "navalhia"
  environment = "production"
  account_id  = "214976551341"

  app_fqdn = "${var.app_subdomain}.${var.domain_name}"
  api_fqdn = "${var.api_subdomain}.${var.domain_name}"
  apex     = var.domain_name

  cdn_aliases = var.attach_custom_domains ? [local.app_fqdn, local.apex] : []
  api_aliases = var.attach_custom_domains ? [local.api_fqdn] : []

  # Contagens (iguais aos `count` dos recursos). Use no `terraform console` para provar
  # que, com attach_custom_domains=false, ACM / identidade SES de domínio / domínio da API = 0.
  acm_cdn_count             = var.attach_custom_domains ? 1 : 0
  acm_api_count             = var.attach_custom_domains ? 1 : 0
  ses_domain_identity_count = var.attach_custom_domains ? 1 : 0
  # Com o flag false, ses_sender_email é obrigatório (validation); a identidade de e-mail sempre é criada.
  ses_sender_identity_count = var.attach_custom_domains ? 0 : 1
  apigw_custom_domain_count = var.attach_custom_domains ? 1 : 0

  # Sem domínio próprio: APP_URL vem de app_public_url (Vercel). Não cair no FQDN customizado.
  app_url = var.attach_custom_domains ? "https://${local.app_fqdn}" : trimsuffix(var.app_public_url, "/")
  # URL pública da API: domínio customizado, ou override opcional, ou o api_endpoint do HTTP API.
  # aws_apigatewayv2_api.http não depende da Lambda (a integration é que depende das duas),
  # então referenciar api_endpoint no env da Lambda não forma ciclo. Sem isso, EVOLUTION_WEBHOOK_PUBLIC_URL
  # vazio faz o backend cair em APP_URL (Vercel) no 1º apply.
  api_public_base = var.attach_custom_domains ? "https://${local.api_fqdn}" : trimsuffix(
    var.api_public_url != "" ? var.api_public_url : aws_apigatewayv2_api.http.api_endpoint,
    "/",
  )

  cors_origin = var.cors_origin

  uazapi_webhook_public_url    = "${local.api_public_base}/api/webhooks/uazapi"
  evolution_webhook_public_url = "${local.api_public_base}/api/webhooks/evolution"

  # Sem domínio: remetente = identidade de e-mail individual (obrigatória).
  from_email = var.attach_custom_domains ? var.from_email : var.ses_sender_email

  ses_identity_arns = compact(concat(
    local.ses_domain_identity_count == 1 ? [aws_sesv2_email_identity.domain[0].arn] : [],
    local.ses_sender_identity_count == 1 ? [aws_sesv2_email_identity.sender[0].arn] : [],
    ["arn:aws:ses:${var.aws_region}:${local.account_id}:identity/${local.from_email}"]
  ))

  lambda_functions = ["api", "worker_ai", "worker_scheduled", "worker_knowledge"]

  # Zip por função: lambda_zip_paths[fn] → lambda_zip_path (zip único legado) → placeholder.
  lambda_zip_real = { for fn in local.lambda_functions : fn => lookup(var.lambda_zip_paths, fn, var.lambda_zip_path) }
  lambda_is_real  = { for fn, z in local.lambda_zip_real : fn => z != "" }
  lambda_zip      = { for fn, z in local.lambda_zip_real : fn => z != "" ? z : data.archive_file.placeholder.output_path }
  lambda_hash     = { for fn, z in local.lambda_zip_real : fn => z != "" ? filebase64sha256(z) : data.archive_file.placeholder.output_base64sha256 }

  common_env_base = {
    NODE_ENV                        = "production"
    DATABASE_URL                    = var.database_url
    DATABASE_SSL                    = "true"
    JWT_SECRET                      = var.jwt_secret
    JWT_EXPIRES_IN                  = "7d"
    APP_ENCRYPTION_KEY              = var.app_encryption_key
    API_KEY_LOOKUP_PEPPER           = var.api_key_lookup_pepper
    APP_URL                         = local.app_url
    CORS_ORIGIN                     = local.cors_origin
    FROM_EMAIL                      = local.from_email
    WHATSAPP_PROVIDER               = var.whatsapp_provider
    WHATSAPP_INSTANCE_PREFIX        = var.whatsapp_instance_prefix
    UAZAPI_BASE_URL                 = var.uazapi_base_url
    UAZAPI_ADMIN_TOKEN              = var.uazapi_admin_token
    UAZAPI_WEBHOOK_PUBLIC_URL       = local.uazapi_webhook_public_url
    OPENAI_API_KEY                  = var.openai_api_key
    NATIVE_AI_DISABLED              = "false"
    STRIPE_SECRET_KEY               = var.stripe_secret_key
    STRIPE_WEBHOOK_SECRET           = var.stripe_webhook_secret
    STRIPE_PRICE_ID                 = var.stripe_price_id
    STRIPE_PRICE_ID_ESSENTIAL       = var.stripe_price_id_essential
    STRIPE_PRICE_ID_PRO             = var.stripe_price_id_pro
    STRIPE_PRICE_ID_PREMIUM         = var.stripe_price_id_premium
    STRIPE_PRICE_ID_EXTRA_NUMBER    = var.stripe_price_id_extra_number
    STRIPE_PRICE_ID_FOLLOWUP_CREDIT = var.stripe_price_id_followup_credit
    KNOWLEDGE_S3_BUCKET             = aws_s3_bucket.knowledge.bucket
    KNOWLEDGE_S3_PREFIX             = "knowledge"
    EVOLUTION_API_URL               = var.evolution_api_url
    EVOLUTION_API_KEY               = var.evolution_api_key
    EVOLUTION_WEBHOOK_PUBLIC_URL    = local.evolution_webhook_public_url
    N8N_CHAT_TRIGGER_URL            = ""
    TOOLS_API_KEY                   = ""
    BILLING_NOTIFY_PAYMENT_FAILED   = tostring(var.billing_notify_payment_failed)
    AI_USAGE_ALERT_ENABLED          = tostring(var.ai_usage_alert_enabled)
    AI_USAGE_ALERT_THRESHOLD_PCT    = tostring(var.ai_usage_alert_threshold_pct)
    AI_USAGE_OWNER_EMAIL_ENABLED    = tostring(var.ai_usage_owner_email_enabled)
  }

  # Segredos dos webhooks de WhatsApp (valores vêm de variáveis sem default útil; ver docs/RUNBOOK_WEBHOOK_SECRET.md).
  common_env = merge(local.common_env_base, {
    WHATSAPP_WEBHOOK_SECRET          = var.whatsapp_webhook_secret
    WHATSAPP_WEBHOOK_SECRET_PREVIOUS = var.whatsapp_webhook_secret_previous
    WHATSAPP_APP_SECRET              = var.whatsapp_app_secret
    WHATSAPP_VERIFY_TOKEN            = var.whatsapp_verify_token
  })
}
