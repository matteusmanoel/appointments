data "aws_caller_identity" "current" {}

data "archive_file" "placeholder" {
  type        = "zip"
  source_dir  = "${path.module}/placeholder"
  output_path = "${path.module}/.placeholder.zip"
}

# ---------------------------------------------------------------------------
# S3 — artifacts, SPA, knowledge
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.project}-artifacts-prod-${local.account_id}"
}

resource "aws_s3_bucket" "static" {
  bucket = "${local.project}-static-prod-${local.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "knowledge" {
  bucket = "${local.project}-knowledge-prod-${local.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "all" {
  for_each = {
    artifacts = aws_s3_bucket.artifacts.id
    static    = aws_s3_bucket.static.id
    knowledge = aws_s3_bucket.knowledge.id
  }

  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "all" {
  for_each = {
    artifacts = aws_s3_bucket.artifacts.id
    static    = aws_s3_bucket.static.id
    knowledge = aws_s3_bucket.knowledge.id
  }

  bucket = each.value
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "all" {
  for_each = {
    artifacts = aws_s3_bucket.artifacts.id
    static    = aws_s3_bucket.static.id
    knowledge = aws_s3_bucket.knowledge.id
  }

  bucket = each.value
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "all" {
  for_each = {
    artifacts = aws_s3_bucket.artifacts.id
    static    = aws_s3_bucket.static.id
    knowledge = aws_s3_bucket.knowledge.id
  }

  bucket = each.value

  rule {
    id     = "abort-mpu-and-old-versions"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# ---------------------------------------------------------------------------
# ACM — CDN em us-east-1; API regional em us-east-2
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "cdn" {
  provider          = aws.us_east_1
  domain_name       = local.apex
  validation_method = "DNS"
  subject_alternative_names = [
    local.app_fqdn,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "api" {
  domain_name       = local.api_fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# CloudFront + OAC
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "static" {
  name                              = "${local.project}-static-${local.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "NavalhIA SPA"
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  aliases             = local.cdn_aliases

  origin {
    domain_name              = aws_s3_bucket.static.bucket_regional_domain_name
    origin_id                = "s3-static"
    origin_access_control_id = aws_cloudfront_origin_access_control.static.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.attach_custom_domains ? false : true
    acm_certificate_arn            = var.attach_custom_domains ? aws_acm_certificate.cdn.arn : null
    ssl_support_method             = var.attach_custom_domains ? "sni-only" : null
    minimum_protocol_version       = var.attach_custom_domains ? "TLSv1.2_2021" : "TLSv1"
  }
}

resource "aws_s3_bucket_policy" "static" {
  bucket = aws_s3_bucket.static.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOac"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.static.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.app.arn
          }
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# IAM + logs + Lambdas
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.project}-api-${local.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role" "worker_ai" {
  name               = "${local.project}-worker-ai-${local.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role" "worker_scheduled" {
  name               = "${local.project}-worker-scheduled-${local.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role" "worker_knowledge" {
  name               = "${local.project}-worker-knowledge-${local.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.project}-api-${local.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker_ai" {
  name              = "/aws/lambda/${local.project}-worker-ai-${local.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker_scheduled" {
  name              = "/aws/lambda/${local.project}-worker-scheduled-${local.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker_knowledge" {
  name              = "/aws/lambda/${local.project}-worker-knowledge-${local.environment}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role_policy" "api" {
  name = "${local.project}-api-policy"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = aws_cloudwatch_log_group.api.arn
      },
      {
        Effect = "Allow"
        Action = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = [
          aws_sesv2_email_identity.domain.arn,
          "arn:aws:ses:${var.aws_region}:${local.account_id}:identity/${var.from_email}"
        ]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
        Resource = [
          "${aws_s3_bucket.knowledge.arn}/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.knowledge.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "worker_ai" {
  name = "${local.project}-worker-ai-policy"
  role = aws_iam_role.worker_ai.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = aws_cloudwatch_log_group.worker_ai.arn
    }]
  })
}

resource "aws_iam_role_policy" "worker_scheduled" {
  name = "${local.project}-worker-scheduled-policy"
  role = aws_iam_role.worker_scheduled.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = aws_cloudwatch_log_group.worker_scheduled.arn
    }]
  })
}

resource "aws_iam_role_policy" "worker_knowledge" {
  name = "${local.project}-worker-knowledge-policy"
  role = aws_iam_role.worker_knowledge.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = aws_cloudwatch_log_group.worker_knowledge.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.knowledge.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.knowledge.arn
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.project}-api-${local.environment}"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs20.x"
  handler          = "dist/lambda.handler"
  filename         = local.lambda_zip
  source_code_hash = local.lambda_hash
  timeout          = 30
  memory_size      = 256

  environment {
    variables = merge(local.common_env, {
      DATABASE_POOL_MAX = "5"
      PORT              = "3000"
    })
  }

  depends_on = [aws_iam_role_policy.api, aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function" "worker_ai" {
  function_name    = "${local.project}-worker-ai-${local.environment}"
  role             = aws_iam_role.worker_ai.arn
  runtime          = "nodejs20.x"
  handler          = "dist/workers/lambda-ai.handler"
  filename         = local.lambda_zip
  source_code_hash = local.lambda_hash
  timeout          = 180
  memory_size      = 512

  environment {
    variables = merge(local.common_env, {
      DATABASE_POOL_MAX           = "2"
      AI_WORKER_CONCURRENCY       = "1"
      AI_JOB_MAX_ATTEMPTS         = "5"
      AI_JOB_BACKOFF_BASE_SECONDS = "2"
    })
  }

  depends_on = [aws_iam_role_policy.worker_ai, aws_cloudwatch_log_group.worker_ai]
}

resource "aws_lambda_function" "worker_scheduled" {
  function_name    = "${local.project}-worker-scheduled-${local.environment}"
  role             = aws_iam_role.worker_scheduled.arn
  runtime          = "nodejs20.x"
  handler          = "dist/workers/lambda-scheduled.handler"
  filename         = local.lambda_zip
  source_code_hash = local.lambda_hash
  timeout          = 60
  memory_size      = 256

  environment {
    variables = merge(local.common_env, {
      DATABASE_POOL_MAX           = "2"
      SCHEDULED_SEND_WINDOW_START = "9"
      SCHEDULED_SEND_WINDOW_END   = "20"
    })
  }

  depends_on = [aws_iam_role_policy.worker_scheduled, aws_cloudwatch_log_group.worker_scheduled]
}

resource "aws_lambda_function" "worker_knowledge" {
  function_name    = "${local.project}-worker-knowledge-${local.environment}"
  role             = aws_iam_role.worker_knowledge.arn
  runtime          = "nodejs20.x"
  handler          = "dist/workers/lambda-knowledge.handler"
  filename         = local.lambda_zip
  source_code_hash = local.lambda_hash
  timeout          = 300
  memory_size      = 512

  environment {
    variables = merge(local.common_env, {
      DATABASE_POOL_MAX = "2"
    })
  }

  depends_on = [aws_iam_role_policy.worker_knowledge, aws_cloudwatch_log_group.worker_knowledge]
}

# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.project}-${local.environment}"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "1.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

resource "aws_apigatewayv2_domain_name" "api" {
  count = var.attach_custom_domains ? 1 : 0

  domain_name = local.api_fqdn
  domain_name_configuration {
    certificate_arn = aws_acm_certificate.api.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  count = var.attach_custom_domains ? 1 : 0

  api_id      = aws_apigatewayv2_api.http.id
  domain_name = aws_apigatewayv2_domain_name.api[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

# ---------------------------------------------------------------------------
# EventBridge workers
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "worker_ai" {
  name                = "${local.project}-worker-ai-${local.environment}"
  description         = "AI worker every minute"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_rule" "worker_scheduled" {
  name                = "${local.project}-worker-scheduled-${local.environment}"
  description         = "Scheduled messages every 5 minutes"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_rule" "worker_knowledge" {
  name                = "${local.project}-worker-knowledge-${local.environment}"
  description         = "Knowledge worker every 5 minutes"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "worker_ai" {
  rule = aws_cloudwatch_event_rule.worker_ai.name
  arn  = aws_lambda_function.worker_ai.arn
}

resource "aws_cloudwatch_event_target" "worker_scheduled" {
  rule = aws_cloudwatch_event_rule.worker_scheduled.name
  arn  = aws_lambda_function.worker_scheduled.arn
}

resource "aws_cloudwatch_event_target" "worker_knowledge" {
  rule = aws_cloudwatch_event_rule.worker_knowledge.name
  arn  = aws_lambda_function.worker_knowledge.arn
}

resource "aws_lambda_permission" "worker_ai_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker_ai.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.worker_ai.arn
}

resource "aws_lambda_permission" "worker_scheduled_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker_scheduled.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.worker_scheduled.arn
}

resource "aws_lambda_permission" "worker_knowledge_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker_knowledge.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.worker_knowledge.arn
}

# ---------------------------------------------------------------------------
# SES (us-east-2)
# ---------------------------------------------------------------------------

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain_name
}

# ---------------------------------------------------------------------------
# Observability + budget
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alarms" {
  name = "${local.project}-alarms-${local.environment}"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.budget_email
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.project}-api-${local.environment}-errors"
  alarm_description   = "Lambda API errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_duration" {
  alarm_name          = "${local.project}-api-${local.environment}-duration"
  alarm_description   = "Lambda API duration high"
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 2
  threshold           = 25000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.project}-monthly"
  budget_type  = "COST"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
