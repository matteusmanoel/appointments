locals {
  project     = "navalhia"
  environment = "production"
  account_id  = "214976551341"

  app_fqdn = "${var.app_subdomain}.${var.domain_name}"
  api_fqdn = "${var.api_subdomain}.${var.domain_name}"
  apex     = var.domain_name

  cdn_aliases = var.attach_custom_domains ? [local.app_fqdn, local.apex] : []
  api_aliases = var.attach_custom_domains ? [local.api_fqdn] : []

  app_url        = "https://${local.app_fqdn}"
  api_url_custom = "https://${local.api_fqdn}"

  cors_origin = var.cors_origin

  uazapi_webhook_public_url = "${local.api_url_custom}/api/webhooks/uazapi"

  lambda_zip  = var.lambda_zip_path != "" ? var.lambda_zip_path : data.archive_file.placeholder.output_path
  lambda_hash = var.lambda_zip_path != "" ? filebase64sha256(var.lambda_zip_path) : data.archive_file.placeholder.output_base64sha256

  common_env = {
    NODE_ENV                        = "production"
    DATABASE_URL                    = var.database_url
    DATABASE_SSL                    = "true"
    JWT_SECRET                      = var.jwt_secret
    JWT_EXPIRES_IN                  = "7d"
    APP_ENCRYPTION_KEY              = var.app_encryption_key
    APP_URL                         = local.app_url
    CORS_ORIGIN                     = local.cors_origin
    FROM_EMAIL                      = var.from_email
    WHATSAPP_PROVIDER               = "uazapi"
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
    EVOLUTION_API_URL               = ""
    EVOLUTION_API_KEY               = ""
    N8N_CHAT_TRIGGER_URL            = ""
    TOOLS_API_KEY                   = ""
  }
}
