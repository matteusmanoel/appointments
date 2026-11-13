# Variáveis do tema billing-enforcement. Ficam em arquivo próprio para o merge com os outros temas não colidir em variables.tf (sem rebase).

variable "billing_notify_payment_failed" {
  type        = bool
  description = "Liga o aviso por e-mail ao dono quando a cobrança da assinatura falha (BILLING_NOTIFY_PAYMENT_FAILED). Padrão false. Para ligar: FROM_EMAIL precisa ser uma identidade verificada no SES. Sem FROM_EMAIL o envio falha e é tentado de novo (nada é marcado como enviado)."
  default     = false
}
