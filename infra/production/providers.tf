terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

# Compute, S3 de app, Lambda, API Gateway, SES, SSM, logs: us-east-2 (Free Plan).
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

# CloudFront e certificado ACM do CDN exigem us-east-1 (serviços de partição).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

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
