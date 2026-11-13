variable "aws_region" {
  type        = string
  description = "Região de compute. Nesta conta Free Plan deve ser us-east-2."
  default     = "us-east-2"

  validation {
    condition     = var.aws_region == "us-east-2"
    error_message = "A conta Free Plan só permite Lambda/API/S3 de app em us-east-2."
  }
}

variable "domain_name" {
  type        = string
  description = "Apex do domínio na Cloudflare (sem www)."
  default     = "navalhia.com"
}

variable "app_subdomain" {
  type        = string
  description = "Hostname do SPA."
  default     = "app"
}

variable "api_subdomain" {
  type        = string
  description = "Hostname da API."
  default     = "api"
}

variable "attach_custom_domains" {
  type        = bool
  description = "true somente depois dos CNAMEs de validação ACM existirem na Cloudflare e os certificados estarem ISSUED."
  default     = false
}

variable "budget_email" {
  type        = string
  description = "E-mail do AWS Budget e dos alarmes SNS."
  default     = "mateusmanoelfr@gmail.com"
}

variable "budget_limit_usd" {
  type        = string
  description = "Limite mensal de custo AWS (USD)."
  default     = "30"
}

variable "from_email" {
  type        = string
  description = "Remetente SES. Deve ser um endereço @domain_name após a verificação DKIM."
  default     = "no-reply@navalhia.com"
}

variable "cors_origin" {
  type        = string
  description = "Origens CORS da API, separadas por vírgula."
  default     = "https://app.navalhia.com,https://navalhia.com"
}

variable "log_retention_days" {
  type        = number
  description = "Retenção finita dos logs (custo)."
  default     = 14
}

variable "database_url" {
  type        = string
  description = "Postgres Supabase (pooler + SSL). Nunca commitar o valor real."
  sensitive   = true
  default     = ""
}

variable "database_url_direct" {
  type        = string
  description = "Postgres SEM pooler (conexão direta, SSL) para os workers: advisory locks de sessão e jobs longos. Declarada sem valor; informe via TF_VAR_database_url_direct. Vazio só é aceito se DATABASE_URL NÃO for um pooler (ou se allow_workers_on_pooler=true). Ver docs/DB_CONEXOES_NEON.md."
  sensitive   = true
  default     = ""

  # Avaliada no `terraform plan`/`apply` (precisa dos valores; `terraform validate` não executa). Nunca imprime os valores.
  validation {
    condition = (
      var.database_url_direct != "" ||
      var.database_url == "" || # segredo vazio é barrado pelo guard de segredos vazios (outro tema)
      var.allow_workers_on_pooler ||
      !can(regex("(?i)(-pooler\\.|:6543/|:6543\\?|pgbouncer=true)", var.database_url))
    )
    error_message = "DATABASE_URL parece apontar para um pooler (-pooler / porta 6543 / pgbouncer) e database_url_direct está vazio: os workers usam pg_advisory_lock de SESSÃO, que vaza ou some atrás de pooler de transação. Informe TF_VAR_database_url_direct (host sem -pooler) ou, sabendo do risco, allow_workers_on_pooler=true. Ver docs/DB_CONEXOES_NEON.md."
  }

  validation {
    condition     = var.database_url_direct == "" || can(regex("^postgres(ql)?://", var.database_url_direct))
    error_message = "database_url_direct deve começar com postgres:// ou postgresql://."
  }

  validation {
    condition     = var.database_url_direct == "" || !can(regex("(?i)(-pooler\\.|:6543/|:6543\\?|pgbouncer=true)", var.database_url_direct))
    error_message = "database_url_direct NÃO pode ser um pooler (-pooler / porta 6543 / pgbouncer=true): precisa ser a conexão direta (ep-xxxx sem -pooler)."
  }
}

variable "allow_workers_on_pooler" {
  type        = bool
  description = "Escape consciente: permite database_url_direct vazio mesmo com DATABASE_URL de pooler (advisory locks de sessão podem vazar; ver docs/DB_CONEXOES_NEON.md). Padrão false."
  default     = false
}

variable "jwt_secret" {
  type        = string
  description = "Segredo JWT. Nunca commitar o valor real."
  sensitive   = true
  default     = ""
}

variable "app_encryption_key" {
  type        = string
  description = "Chave de criptografia dos tokens Uazapi (32+ chars ou 64 hex)."
  sensitive   = true
  default     = ""
}

variable "uazapi_base_url" {
  type        = string
  description = "Base da Uazapi paga (não usar free.uazapi.com em produção)."
  default     = ""
  sensitive   = true
}

variable "uazapi_admin_token" {
  type        = string
  description = "Token admin Uazapi."
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  type        = string
  description = "Chave OpenAI do worker de IA. Vazia desliga o modelo, não o worker."
  default     = ""
  sensitive   = true
}

variable "stripe_secret_key" {
  type        = string
  description = "Stripe da conta de testes. Vazio desliga checkout."
  default     = ""
  sensitive   = true
}

variable "stripe_webhook_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "stripe_price_id" {
  type    = string
  default = ""
}

variable "stripe_price_id_essential" {
  type    = string
  default = ""
}

variable "stripe_price_id_pro" {
  type    = string
  default = ""
}

variable "stripe_price_id_premium" {
  type    = string
  default = ""
}

variable "stripe_price_id_extra_number" {
  type    = string
  default = ""
}

variable "stripe_price_id_followup_credit" {
  type    = string
  default = ""
}

variable "lambda_zip_path" {
  type        = string
  description = "Zip real do backend (dist + node_modules). Vazio usa placeholder só para plan/validate."
  default     = ""
}
