# Variáveis do aviso de 80% de uso da IA (B-06). Arquivo próprio para o merge não colidir em variables.tf.

variable "ai_usage_alert_enabled" {
  type        = bool
  description = "Liga o aviso por e-mail ao dono quando o uso mensal da IA chega ao limiar do plano (AI_USAGE_ALERT_ENABLED). Padrão true (B-06). Para desligar: false. O envio exige FROM_EMAIL verificado no SES. No teto, o agente do WhatsApp fica em silêncio com o cliente; o painel admin mostra um badge de alerta."
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
