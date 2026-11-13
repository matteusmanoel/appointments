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

variable "whatsapp_provider" {
  type        = string
  description = "Provider de WhatsApp: \"evolution\" ou \"uazapi\". SEM padrão: com zip real (lambda_zip_path) a escolha é obrigatória, porque antes deste tema o Terraform fixava uazapi e um padrão silencioso trocaria o provedor de produção. Decisão do dono do projeto."
  default     = ""

  validation {
    condition     = var.whatsapp_provider == "" || contains(["evolution", "uazapi"], var.whatsapp_provider)
    error_message = "whatsapp_provider deve ser \"evolution\" ou \"uazapi\"."
  }

  # Avaliada no `terraform plan`/`apply` (o `validate` não executa validações com valores). Só o plan com o placeholder
  # (lambda_zip_path vazio) segue livre.
  validation {
    condition     = var.lambda_zip_path == "" || var.whatsapp_provider != ""
    error_message = "whatsapp_provider não foi definido e lambda_zip_path está definido: informe TF_VAR_whatsapp_provider (evolution ou uazapi) conforme o que produção usa hoje. Antes deste tema o Terraform fixava uazapi. Ver docs/WHATSAPP_PROVIDER.md."
  }
}

variable "evolution_api_url" {
  type        = string
  description = "URL base da Evolution API (host externo, sempre ligado). Obrigatória (https://...) quando whatsapp_provider = evolution com zip real. Nada é provisionado aqui."
  default     = ""

  validation {
    condition     = var.lambda_zip_path == "" || var.whatsapp_provider != "evolution" || can(regex("^https?://[^ ]+$", var.evolution_api_url))
    error_message = "whatsapp_provider = evolution com lambda_zip_path definido exige evolution_api_url (http/https). Sem ela a Lambda não fala com a Evolution."
  }
}

variable "evolution_api_key" {
  type        = string
  description = "API key da Evolution (só autentica a chamada à API; não é segredo de webhook). Obrigatória quando whatsapp_provider = evolution com zip real. Nunca commitar o valor real."
  default     = ""
  sensitive   = true

  validation {
    condition     = var.lambda_zip_path == "" || var.whatsapp_provider != "evolution" || var.evolution_api_key != ""
    error_message = "whatsapp_provider = evolution com lambda_zip_path definido exige evolution_api_key (TF_VAR_evolution_api_key). Sem ela a Evolution recusa envio e criação de instância."
  }
}

variable "whatsapp_instance_prefix" {
  type        = string
  description = "Prefixo das instâncias da NavalhIA no host de WhatsApp (isola de outros apps no mesmo host)."
  default     = "navalhia"
}
