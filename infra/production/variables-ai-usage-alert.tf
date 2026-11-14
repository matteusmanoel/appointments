# Variáveis do aviso de 80% de uso da IA (B-06). Arquivo próprio para o merge não colidir em variables.tf.

variable "ai_usage_alert_enabled" {
  type        = bool
  description = "Liga o aviso por e-mail ao dono quando o uso mensal da IA chega ao limiar do plano (AI_USAGE_ALERT_ENABLED). Padrão true (B-06). Para desligar: false. O envio exige FROM_EMAIL verificado no SES."
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

variable "ai_hard_cap_customer_message" {
  type        = string
  description = "Texto curto enviado ao cliente final no teto de uso da IA (2x o limite), 1x por conversa e mês (AI_HARD_CAP_CUSTOMER_MESSAGE, até 500 caracteres). Vazio = texto padrão neutro do código, AGUARDANDO APROVAÇÃO do Mateus. Só é enviado com ai_usage_alert_enabled = true."
  default     = ""

  validation {
    condition     = length(var.ai_hard_cap_customer_message) <= 500
    error_message = "ai_hard_cap_customer_message deve ter até 500 caracteres."
  }
}
