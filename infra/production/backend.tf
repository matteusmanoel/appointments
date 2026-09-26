# Backend remoto — só funciona depois do bootstrap.
# Até lá: terraform init -backend=false
#
# Após criar o bucket:
#   terraform init -migrate-state
#
# Autenticação: AWS_PROFILE=personal (não coloque Access Key aqui).

terraform {
  backend "s3" {
    bucket       = "navalhia-tfstate-214976551341"
    key          = "production/terraform.tfstate"
    region       = "us-east-2"
    encrypt      = true
    use_lockfile = true
  }
}
