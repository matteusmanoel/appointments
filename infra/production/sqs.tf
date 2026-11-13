# ---------------------------------------------------------------------------
# Gatilho por evento do worker de IA (SQS → Lambda worker_ai)
#
# Antes: só EventBridge rate(1 minute) → resposta do agente levava até ~1 min + janela de silêncio.
# Agora: o webhook grava o ai_job e envia uma mensagem com DelaySeconds = janela de silêncio; o SQS acorda
# o worker_ai quando o job fica elegível. O EventBridge continua como rede de segurança (retries/backoff).
# ---------------------------------------------------------------------------

resource "aws_sqs_queue" "ai_jobs_dlq" {
  name                      = "${local.project}-ai-jobs-dlq-${local.environment}"
  message_retention_seconds = 1209600 # 14 dias para investigar
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "ai_jobs" {
  name = "${local.project}-ai-jobs-${local.environment}"

  # AWS recomenda visibilidade >= 6x o timeout da função consumidora (worker_ai: 180 s).
  visibility_timeout_seconds = 1080
  message_retention_seconds  = 345600 # 4 dias
  receive_wait_time_seconds  = 0
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ai_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

# Só a fila principal pode redirecionar para a DLQ.
resource "aws_sqs_queue_redrive_allow_policy" "ai_jobs_dlq" {
  queue_url = aws_sqs_queue.ai_jobs_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.ai_jobs.arn]
  })
}

# Privilégio mínimo: o worker só consome; a API só envia.
resource "aws_iam_role_policy" "worker_ai_sqs" {
  name = "${local.project}-worker-ai-sqs-policy"
  role = aws_iam_role.worker_ai.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
      Resource = aws_sqs_queue.ai_jobs.arn
    }]
  })
}

resource "aws_iam_role_policy" "api_sqs_send" {
  name = "${local.project}-api-sqs-send-policy"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = aws_sqs_queue.ai_jobs.arn
    }]
  })
}

resource "aws_lambda_event_source_mapping" "worker_ai_sqs" {
  event_source_arn = aws_sqs_queue.ai_jobs.arn
  function_name    = aws_lambda_function.worker_ai.arn

  # Um ciclo do worker processa todos os jobs elegíveis; lote pequeno e sem espera extra.
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.ai_jobs_queue_max_concurrency
  }

  depends_on = [aws_iam_role_policy.worker_ai_sqs]
}

output "ai_jobs_queue_url" {
  value       = aws_sqs_queue.ai_jobs.url
  description = "Fila do gatilho por evento do worker de IA (injetada como AI_JOBS_QUEUE_URL na API)."
}

output "ai_jobs_dlq_url" {
  value       = aws_sqs_queue.ai_jobs_dlq.url
  description = "DLQ: mensagens que falharam 3x. Sem alarme configurado ainda (pendência do dono)."
}
