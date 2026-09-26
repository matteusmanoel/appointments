# Infraestrutura de produção — Terraform

Ambiente único: **produção na AWS**. Desenvolvimento continua só na máquina local.
Staging não existe nesta conta.

CloudFormation em `infra/api/` e `infra/static/` é legado da conta antiga (`321225686266`). Não use nesses scripts.

## Arquitetura aprovada

- Frontend: S3 (`us-east-2`) + CloudFront + ACM (`us-east-1`)
- API: Lambda + HTTP API (`us-east-2`)
- Workers: Lambda + EventBridge (1 min / 5 min / 5 min)
- Banco: **Supabase Pro** (recriar o projeto; MCP ainda não aponta para NavalhIA)
- WhatsApp: **Uazapi** (não Evolution)
- E-mail: SES `us-east-2`, `FROM_EMAIL=no-reply@navalhia.com`
- DNS: **Cloudflare**, domínio `navalhia.com` (Route 53 registrar é bloqueado no Free Plan)
- Budget: `mateusmanoelfr@gmail.com`, USD 30
- Front de produção: `VITE_NATIVE_AI_UI=false` (esconde Inteligência editável, Atendimento, cérebro, créditos e disparo em massa)

Conta AWS autorizada: `214976551341`. Perfil: `personal`. Região de compute: `us-east-2`.

Não coloque Access Key no Terraform. Autentique com `AWS_PROFILE=personal`.

## Comandos

```bash
export AWS_PROFILE=personal
make infra-fmt
make infra-validate
make infra-plan
make infra-security
# make infra-deploy   # pede confirmação humana APPLY; não use -auto-approve
```

`make infra-deploy` **não** foi executado nesta entrega.

## 1. Bootstrap (cria o bucket de state)

Ainda **não** rode isto sem autorização de apply.

```bash
export AWS_PROFILE=personal
aws sts get-caller-identity --profile personal
# Account deve ser 214976551341

cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
# terraform apply    # somente após aprovação explícita
```

O bucket `navalhia-tfstate-214976551341` tem versionamento, AES256, bloqueio público, lifecycle (MPU 7d, versões 90d) e `prevent_destroy`. Lock nativo S3 (`use_lockfile`), sem DynamoDB.

## 2. Backend do stack production

Depois do bootstrap, o arquivo `infra/production/backend.tf` já aponta para esse bucket.

```bash
cd infra/production
terraform init          # com o bucket já existente
# se o state local existir: terraform init -migrate-state
```

Até o bucket existir, use `terraform init -backend=false` (é o que `make infra-validate` e `make infra-plan` fazem hoje).

## 3. Inicializar production e plano

```bash
export AWS_PROFILE=personal
cd infra/production
cp terraform.tfvars.example terraform.tfvars
# preencha DATABASE_URL, JWT_SECRET, APP_ENCRYPTION_KEY, UAZAPI_*, OPENAI_API_KEY
terraform init -backend=false
terraform plan -var-file=terraform.tfvars.example -out=production.tfplan
```

## 4. Migração de state

Se um apply foi feito com backend desabilitado:

```bash
cd infra/production
terraform init -migrate-state
```

Confirme o copy local → S3. Não delete o state local até o remote estar íntegro.

## 5. Recuperação de state

1. Listar versões: `aws s3api list-object-versions --bucket navalhia-tfstate-214976551341 --prefix production/terraform.tfstate --profile personal --region us-east-2`
2. Restaurar uma versão anterior do objeto.
3. Lockfile órfão: `aws s3 rm s3://navalhia-tfstate-214976551341/production/terraform.tfstate.tflock --profile personal --region us-east-2` — só se tiver certeza de que nenhum apply está em curso.

## 6. Teardown (não rode agora)

Ordem segura:

1. `attach_custom_domains=false` e aplicar (solta aliases).
2. Esvaziar buckets de artifacts/static/knowledge (knowledge tem dados — confirme backup).
3. `terraform destroy` em `infra/production` (state, static e knowledge têm `prevent_destroy`; é preciso remover o lifecycle conscientemente).
4. Só então destroy do bootstrap.

## Domínio Cloudflare (`navalhia.com`)

Comprar o domínio **na Cloudflare**, não na AWS.

1. Apply inicial com `attach_custom_domains=false`.
2. Outputs `cloudflare_acm_validation_cdn` e `cloudflare_acm_validation_api` → CNAMEs na Cloudflare.
3. Outputs `ses_dkim_tokens` → CNAMEs `{token}._domainkey.navalhia.com` → `{token}.dkim.amazonses.com`.
4. Quando ACM = ISSUED: `attach_custom_domains=true` e novo apply.
5. Tráfego:
   - `app` CNAME → `cloudfront_domain`
   - apex (`navalhia.com`) CNAME flattening → o mesmo CloudFront
   - `api` CNAME → `api_custom_domain_target`

## Frontend build (produção)

```bash
VITE_API_URL=https://api.navalhia.com VITE_NATIVE_AI_UI=false npm ci && npm run build
aws s3 sync dist s3://$(terraform -chdir=infra/production output -raw static_bucket) --delete --profile personal --region us-east-2
aws cloudfront create-invalidation --distribution-id $(terraform -chdir=infra/production output -raw cloudfront_distribution_id) --paths "/*" --profile personal
```

## Backend zip

```bash
cd backend && npm ci && npm run build
zip -r ../dist-api.zip dist package.json package-lock.json node_modules -x "*.map"
# lambda_zip_path = caminho do zip no terraform.tfvars
```

Placeholder em `infra/production/placeholder/` só existe para `validate`/`plan` sem o zip real.

## Supabase Pro

O MCP conectado hoje **não** é um projeto NavalhIA. Depois de criar o projeto Pro:

1. Habilitar extensão `vector`.
2. Aplicar `supabase/migrations/*.sql` em ordem (CLI ou MCP `apply_migration`).
3. Colocar a connection string **pooler + SSL** em `DATABASE_URL` (SSM/tfvars local, não no git).
4. `DATABASE_SSL=true` já vai na Lambda.

Não rode `confirm_cost` / `create_project` daqui sem um novo ok explícito — o Pro é pago.

## Secrets

Não entram no git. `terraform.tfvars` está no `.gitignore`. O state S3 é criptografado; mesmo assim evite `terraform show` em canais públicos. Rotação: atualizar tfvars local + apply, ou `aws lambda update-function-configuration`.

## Rollback

- Código da API: `aws lambda update-function-code` com o zip anterior em `s3://navalhia-artifacts-prod-214976551341`.
- Front: sync do `dist` anterior + invalidation.
- Infra: `terraform apply` de um plan gerado a partir de um commit anterior.

## `prevent_destroy`

Usado só em: bucket de **state**, **static** (SPA) e **knowledge** (documentos de clientes). Lambdas, API e logs podem ser recriados.
