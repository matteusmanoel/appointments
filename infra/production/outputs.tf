output "account_id" {
  value       = data.aws_caller_identity.current.account_id
  description = "Deve ser 214976551341."
}

output "cloudfront_domain" {
  value       = aws_cloudfront_distribution.app.domain_name
  description = "CNAME Cloudflare de app (e apex com flattening) até attach_custom_domains=true."
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.app.id
}

output "api_gateway_url" {
  value       = aws_apigatewayv2_api.http.api_endpoint
  description = "URL da API sem domínio customizado."
}

output "api_custom_domain_target" {
  value       = try(aws_apigatewayv2_domain_name.api[0].domain_name_configuration[0].target_domain_name, null)
  description = "CNAME de api.navalhia.com na Cloudflare (após attach_custom_domains)."
}

output "static_bucket" {
  value = aws_s3_bucket.static.bucket
}

output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "knowledge_bucket" {
  value = aws_s3_bucket.knowledge.bucket
}

output "lambda_api_name" {
  value = aws_lambda_function.api.function_name
}

output "health_url" {
  value = "${aws_apigatewayv2_api.http.api_endpoint}/health"
}

output "cloudflare_acm_validation_cdn" {
  description = "Registros DNS na Cloudflare para emitir o certificado do CloudFront (us-east-1). null/vazio quando attach_custom_domains=false."
  value = flatten([
    for cert in aws_acm_certificate.cdn : [
      for dvo in cert.domain_validation_options : {
        name  = dvo.resource_record_name
        type  = dvo.resource_record_type
        value = dvo.resource_record_value
      }
    ]
  ])
}

output "cloudflare_acm_validation_api" {
  description = "Registros DNS na Cloudflare para emitir o certificado da API (us-east-2). null/vazio quando attach_custom_domains=false."
  value = flatten([
    for cert in aws_acm_certificate.api : [
      for dvo in cert.domain_validation_options : {
        name  = dvo.resource_record_name
        type  = dvo.resource_record_type
        value = dvo.resource_record_value
      }
    ]
  ])
}

output "ses_dkim_tokens" {
  description = "CNAMEs DKIM do SES (us-east-2) para colar na Cloudflare. null quando attach_custom_domains=false."
  value       = try(aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens, null)
}

output "ses_sender_identity" {
  description = "Identidade SES de e-mail criada quando attach_custom_domains=false e ses_sender_email está preenchido. Confirme o link no inbox. Em sandbox, destinatários não verificados ficam pendentes."
  value       = try(aws_sesv2_email_identity.sender[0].email_identity, null)
}

output "app_url" {
  description = "APP_URL efetivo (domínio customizado ou app_public_url)."
  value       = local.app_url
}

output "webhook_public_urls" {
  description = "URLs públicas dos webhooks. Vazias no 1º apply até preencher api_public_url com api_gateway_url."
  value = {
    uazapi    = local.uazapi_webhook_public_url
    evolution = local.evolution_webhook_public_url
  }
}

output "custom_domain_resource_counts" {
  description = "Contagens esperadas com o flag atual (0 quando attach_custom_domains=false)."
  value = {
    attach_custom_domains = var.attach_custom_domains
    acm_cdn               = local.acm_cdn_count
    acm_api               = local.acm_api_count
    ses_domain_identity   = local.ses_domain_identity_count
    ses_sender_identity   = local.ses_sender_identity_count
    apigw_custom_domain   = local.apigw_custom_domain_count
  }
}

output "budget_name" {
  value = aws_budgets_budget.monthly.name
}

output "sns_alarms_topic" {
  value       = aws_sns_topic.alarms.arn
  description = "Confirme a inscrição por e-mail em mateusmanoelfr@gmail.com."
}
