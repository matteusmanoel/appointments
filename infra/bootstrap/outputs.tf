output "state_bucket_name" {
  description = "Bucket S3 para o backend do stack production."
  value       = aws_s3_bucket.state.bucket
}

output "state_bucket_arn" {
  description = "ARN do bucket de state."
  value       = aws_s3_bucket.state.arn
}

output "backend_snippet" {
  description = "Bloco backend para infra/production/backend.tf após o bootstrap."
  value       = <<-EOT
    terraform {
      backend "s3" {
        bucket       = "${aws_s3_bucket.state.bucket}"
        key          = "production/terraform.tfstate"
        region       = "${var.aws_region}"
        encrypt      = true
        use_lockfile = true
      }
    }
  EOT
}
