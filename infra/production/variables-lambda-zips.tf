# Variáveis do tema sqs-trigger. Ficam em arquivo próprio para o merge com os outros temas não colidir em variables.tf (sem rebase).

variable "lambda_zip_paths" {
  type        = map(string)
  description = "Zip por função: chaves api, worker_ai, worker_scheduled, worker_knowledge (saída de `cd backend && npm run bundle:lambdas`). Chave ausente cai em lambda_zip_path."
  default     = {}
  validation {
    condition     = alltrue([for k in keys(var.lambda_zip_paths) : contains(["api", "worker_ai", "worker_scheduled", "worker_knowledge"], k)])
    error_message = "Chaves válidas de lambda_zip_paths: api, worker_ai, worker_scheduled, worker_knowledge."
  }
}

variable "allow_placeholder_deploy" {
  type        = bool
  description = "TRAVA: sem zip real (lambda_zip_path/lambda_zip_paths) o apply trocaria o código das Lambdas por um placeholder e derrubaria a API. Só use true em plan/validate ou no primeiro apply de uma conta vazia."
  default     = false
}

variable "ai_jobs_queue_max_concurrency" {
  type        = number
  description = "Máximo de invocações simultâneas do worker de IA disparadas pela fila SQS (mín. 2 pela AWS). Respeite o limite de concorrência da conta e o pool de conexões do banco."
  default     = 2
  validation {
    condition     = var.ai_jobs_queue_max_concurrency >= 2 && var.ai_jobs_queue_max_concurrency <= 1000
    error_message = "Entre 2 e 1000."
  }
}
