AWS_ACCOUNT_EXPECTED := 214976551341
AWS_PROFILE ?= personal
TF_BOOTSTRAP := infra/bootstrap
TF_PROD := infra/production

.PHONY: infra-check-account infra-fmt infra-validate infra-plan infra-security infra-deploy

infra-check-account:
	@test "$(AWS_PROFILE)" = "personal" || (echo "AWS_PROFILE must be personal (got '$(AWS_PROFILE)')"; exit 1)
	@ACCOUNT=$$(aws sts get-caller-identity --profile "$(AWS_PROFILE)" --query Account --output text); \
	ARN=$$(aws sts get-caller-identity --profile "$(AWS_PROFILE)" --query Arn --output text); \
	echo "Account=$$ACCOUNT Arn=$$ARN"; \
	test "$$ACCOUNT" = "$(AWS_ACCOUNT_EXPECTED)" || (echo "BLOCKED_WRONG_AWS_ACCOUNT"; exit 1)

infra-fmt:
	terraform fmt -recursive infra

infra-validate: infra-check-account
	cd $(TF_BOOTSTRAP) && terraform init -backend=false -reconfigure -input=false
	cd $(TF_BOOTSTRAP) && terraform validate
	cd $(TF_PROD) && terraform init -backend=false -reconfigure -input=false
	cd $(TF_PROD) && terraform validate

infra-plan: infra-check-account
	@echo "State bucket remoto ainda pode não existir. TF 1.15 exige init do backend S3 ou state local."
	@cd $(TF_PROD); \
	if aws s3api head-bucket --bucket navalhia-tfstate-214976551341 --profile $(AWS_PROFILE) --region us-east-2 >/dev/null 2>&1; then \
		terraform init -input=false; \
	else \
		echo "Bucket de state ausente — plan com backend local (bootstrap pendente)."; \
		cp backend.tf backend.s3.tf.bak; \
		printf '%s\n' 'terraform { backend "local" { path = "local-pending.tfstate" } }' > backend.tf; \
		terraform init -reconfigure -input=false; \
	fi; \
	terraform plan -input=false -var-file=terraform.tfvars.example -out=production.tfplan; \
	STATUS=$$?; \
	if [ -f backend.s3.tf.bak ]; then mv backend.s3.tf.bak backend.tf; fi; \
	terraform show production.tfplan; \
	exit $$STATUS

infra-security:
	@echo "tflint/checkov/trivy não estão instalados neste ambiente. Instale localmente se quiser o scan; não instalo globalmente sem autorização."

infra-deploy: infra-check-account
	@test "$(AWS_PROFILE)" = "personal" || (echo "AWS_PROFILE=personal é obrigatório"; exit 1)
	cd $(TF_PROD) && terraform init -input=false
	cd $(TF_PROD) && terraform plan -input=false -out=production.tfplan
	cd $(TF_PROD) && terraform show production.tfplan
	@echo
	@echo "Revise o plano acima. Digite APPLY para aplicar este arquivo de plano. Qualquer outra coisa aborta."
	@read ans; test "$$ans" = "APPLY" || (echo "Abortado."; exit 1)
	cd $(TF_PROD) && terraform apply -input=false production.tfplan
