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
  description = "true somente depois dos CNAMEs de validação ACM existirem na Cloudflare e os certificados estarem ISSUED. false (padrão): não cria ACM (cdn/api), identidade SES de domínio, nem domínio customizado no API Gateway."
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
  description = "Remetente SES quando attach_custom_domains=true (endereço @domain_name após DKIM). Sem domínio próprio, FROM_EMAIL usa ses_sender_email se este não for vazio."
  default     = "no-reply@navalhia.com"
}

variable "ses_sender_email" {
  type        = string
  description = "Identidade SES de e-mail (verificação individual, não de domínio). Sem default de propósito: informe no tfvars (vazio = não cria a identidade). Usada quando attach_custom_domains=false. Em sandbox, só destinatários também verificados recebem; os demais ficam pendentes."

  validation {
    condition     = var.ses_sender_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.ses_sender_email))
    error_message = "ses_sender_email deve ser vazio ou um endereço de e-mail."
  }
}

variable "app_public_url" {
  type        = string
  description = "URL pública do front quando attach_custom_domains=false (ex.: https://appointments-psi-five.vercel.app). Vazio com o flag false deixa APP_URL vazio (não cai em app.navalhia.com). Com o flag true, é ignorada."
  default     = ""
}

variable "api_public_url" {
  type        = string
  description = "URL pública da API quando attach_custom_domains=false. Preencha APÓS o primeiro apply com o output api_gateway_url. Não referencie aws_apigatewayv2_api.http.api_endpoint neste módulo: ciclo API Gateway ↔ Lambda. Com o flag true, é ignorada."
  default     = ""
}

variable "cors_origin" {
  type        = string
  description = "Origens CORS da API, separadas por vírgula. Sem domínio próprio: URL de produção da Vercel; depois do 1º apply, acrescente https://<cloudfront_domain>."
  default     = "https://appointments-psi-five.vercel.app"
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
  description = "Zip único (legado) usado por TODAS as funções. Prefira lambda_zip_paths (um zip por função, gerado por `npm run bundle:lambdas`). Vazio + lambda_zip_paths vazio = placeholder (só plan/validate)."
  default     = ""
}
