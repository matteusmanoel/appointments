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
  description = "Registros DNS na Cloudflare para emitir o certificado do CloudFront (us-east-1)."
  value = [
    for dvo in aws_acm_certificate.cdn.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "cloudflare_acm_validation_api" {
  description = "Registros DNS na Cloudflare para emitir o certificado da API (us-east-2)."
  value = [
    for dvo in aws_acm_certificate.api.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "ses_dkim_tokens" {
  description = "CNAMEs DKIM do SES (us-east-2) para colar na Cloudflare."
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}

output "budget_name" {
  value = aws_budgets_budget.monthly.name
}

output "sns_alarms_topic" {
  value       = aws_sns_topic.alarms.arn
  description = "Confirme a inscrição por e-mail em mateusmanoelfr@gmail.com."
}
