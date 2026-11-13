# Variáveis do tema webhook-auth. Ficam em arquivo próprio para o merge com os outros temas não colidir em variables.tf (sem rebase).

# --- Segredos dos webhooks de WhatsApp (declarados SEM valor; informe via TF_VAR_* / cofre, nunca no repositório) ---
variable "whatsapp_webhook_secret" {
  type        = string
  description = "Segredo exigido nos webhooks Uazapi/Evolution (WHATSAPP_WEBHOOK_SECRET). Vazio = os webhooks respondem 503 (fail closed). Ver docs/RUNBOOK_WEBHOOK_SECRET.md."
  default     = ""
  sensitive   = true

  # Trava: publicar o zip real (lambda_zip_path) com o segredo vazio derrubaria a entrada de mensagens (503 em todos os
  # webhooks). Avaliada no `terraform plan`/`apply` (o `validate` não vê valores); o plan só com o placeholder segue livre.
  validation {
    condition     = var.lambda_zip_path == "" || length(var.whatsapp_webhook_secret) >= 16
    error_message = "whatsapp_webhook_secret está vazio ou curto (< 16 caracteres) e lambda_zip_path está definido: os webhooks de WhatsApp responderiam 503. Gere com `openssl rand -hex 32` e informe via TF_VAR_whatsapp_webhook_secret. Ver docs/RUNBOOK_WEBHOOK_SECRET.md (ordem e janela de indisponibilidade)."
  }

  validation {
    condition     = var.whatsapp_webhook_secret_previous == "" || var.whatsapp_webhook_secret_previous != var.whatsapp_webhook_secret
    error_message = "whatsapp_webhook_secret_previous não pode ser igual ao segredo atual (use vazio fora de rotação)."
  }
}

variable "whatsapp_webhook_secret_previous" {
  type        = string
  description = "Segredo anterior, aceito só durante a rotação (WHATSAPP_WEBHOOK_SECRET_PREVIOUS). Deixe vazio fora de rotação."
  default     = ""
  sensitive   = true
}

variable "whatsapp_app_secret" {
  type        = string
  description = "App Secret do app Meta (WHATSAPP_APP_SECRET): valida X-Hub-Signature-256. Vazio = POST do webhook da Meta responde 503 (aceitável enquanto o provedor da Meta não é usado: produção usa Uazapi)."
  default     = ""
  sensitive   = true
}

variable "whatsapp_verify_token" {
  type        = string
  description = "Token do handshake GET do webhook da Meta (WHATSAPP_VERIFY_TOKEN)."
  default     = ""
  sensitive   = true
}
