# Variáveis do tema whatsapp-provider-config. Ficam em arquivo próprio para o merge com os outros temas não colidir em variables.tf (sem rebase).

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
