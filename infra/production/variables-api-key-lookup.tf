# Pepper do lookup de API keys (HMAC-SHA256). Arquivo próprio para o merge não colidir em variables.tf.

variable "api_key_lookup_pepper" {
  type        = string
  description = "Pepper (segredo de servidor) do HMAC-SHA256 do lookup de API keys (env API_KEY_LOOKUP_PEPPER). Mínimo 32 caracteres, ex.: openssl rand -hex 32. Nunca commitar o valor. Vazio faz a API não subir em produção (fail closed). Trocar o valor invalida os lookups gravados: ver docs/RUNBOOK.md, 'API keys de tools'."
  sensitive   = true
  default     = ""

  validation {
    condition     = var.api_key_lookup_pepper == "" || length(var.api_key_lookup_pepper) >= 32
    error_message = "api_key_lookup_pepper deve ter pelo menos 32 caracteres (ou ficar vazio no plan)."
  }
}
