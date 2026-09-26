terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
}

provider "aws" {
  region = var.aws_region

  allowed_account_ids = [
    "214976551341"
  ]

  default_tags {
    tags = {
      Project     = "appointments"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
