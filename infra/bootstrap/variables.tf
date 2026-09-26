variable "aws_region" {
  type        = string
  description = "Região do bucket de state. Deve ser us-east-2 nesta conta Free Plan."
  default     = "us-east-2"

  validation {
    condition     = var.aws_region == "us-east-2"
    error_message = "A conta Free Plan só permite S3 de aplicação em us-east-2."
  }
}

variable "state_bucket_name" {
  type        = string
  description = "Nome globalmente único do bucket de state."
  default     = "navalhia-tfstate-214976551341"
}
