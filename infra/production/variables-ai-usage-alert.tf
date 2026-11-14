# Variáveis do aviso de uso da IA (B-06). Arquivo próprio para o merge não colidir em variables.tf.

variable "ai_usage_alert_enabled" {
  type        = bool
  description = "Liga o registro do teto em ai_hard_cap_notices (AI_USAGE_ALERT_ENABLED). Padrão true. Para desligar: false. Não dispara e-mail ao dono (veja ai_usage_owner_email_enabled). No teto, o agente do WhatsApp fica em silêncio com o cliente; o painel admin mostra um badge de alerta."
  default     = true
}

variable "ai_usage_alert_threshold_pct" {
  type        = number
  description = "Percentual do limite mensal de IA que dispara o aviso (AI_USAGE_ALERT_THRESHOLD_PCT). Padrão 80. Aceito 1–99."
  default     = 80

  validation {
    condition     = var.ai_usage_alert_threshold_pct >= 1 && var.ai_usage_alert_threshold_pct <= 99
    error_message = "ai_usage_alert_threshold_pct deve estar entre 1 e 99."
  }
}

variable "ai_usage_owner_email_enabled" {
  type        = bool
  description = "Liga o e-mail ao dono em 80%, 100% e no teto de uso da IA (AI_USAGE_OWNER_EMAIL_ENABLED). Padrão false. Só true envia. O envio exige FROM_EMAIL verificado no SES."
  default     = false
}
