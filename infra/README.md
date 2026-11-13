# Infraestrutura de produção — Terraform

Ambiente único: **produção na AWS**. Desenvolvimento continua só na máquina local.
Staging não existe nesta conta.

CloudFormation em `infra/api/` e `infra/static/` é legado da conta antiga (`321225686266`). Não use nesses scripts.

## Arquitetura aprovada

- Frontend: produção imediata na **Vercel** (`https://appointments-psi-five.vercel.app`). S3 (`us-east-2`) + CloudFront continuam no stack; com `attach_custom_domains=false` o CloudFront usa o certificado padrão (sem alias `app.navalhia.com` / apex).
- API: Lambda + HTTP API (`us-east-2`). Sem domínio próprio, a URL pública é o `api_endpoint` do API Gateway (`output api_gateway_url`), gravada em `api_public_url` **depois** do primeiro apply (referenciar o endpoint no mesmo módulo cria ciclo API ↔ Lambda).
- Workers: Lambda + EventBridge (1 min / 5 min / 5 min)
- Banco: **Supabase Pro** (recriar o projeto; MCP ainda não aponta para NavalhIA) — na prática o alvo atual é Neon (pooler em `DATABASE_URL`, direto em `DATABASE_URL_DIRECT`).
- WhatsApp: o example de produção usa **`whatsapp_provider=evolution`** (host externo; nada é provisionado aqui). Uazapi continua disponível no código.
- E-mail: SES `us-east-2`. Com `attach_custom_domains=false` **não** se cria identidade de domínio. Informe `ses_sender_email` (sem default) para criar uma identidade de e-mail com verificação individual. A conta está em **sandbox**: só destinatários também verificados recebem; os demais ficam pendentes até a conta sair do sandbox.
- DNS: domínio `navalhia.com` na **Cloudflare** fica para um passo posterior (`attach_custom_domains=true`). Route 53 registrar é bloqueado no Free Plan.
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

## Sem domínio próprio (padrão atual)

`attach_custom_domains` default e no `terraform.tfvars.example` é `false`. Neste modo o Terraform **não cria**:

- certificados ACM (`aws_acm_certificate.cdn` em us-east-1 e `api` em us-east-2);
- identidade SES de domínio (`aws_sesv2_email_identity.domain`) nem tokens DKIM;
- domínio/mapping customizado no API Gateway (já eram `count`-ados).

O que usar no lugar:

- `app_public_url` = `https://appointments-psi-five.vercel.app` (vira `APP_URL`).
- `api_public_url` vazio no 1º apply; depois copie o output `api_gateway_url` e faça um 2º apply (preenche `UAZAPI_WEBHOOK_PUBLIC_URL` / `EVOLUTION_WEBHOOK_PUBLIC_URL`).
- `cors_origin` = a origem Vercel; depois do 1º apply, acrescente `,https://<output cloudfront_domain>`.
- `ses_sender_email`: variável **sem default** — declare no tfvars. Vazio = não cria identidade. Preenchido = `aws_sesv2_email_identity.sender` (verifique o e-mail no inbox). `FROM_EMAIL` passa a ser esse endereço.
- Output `custom_domain_resource_counts` e os `local.*_count` devem ser 0 para ACM / SES de domínio / API domain quando o flag é false. Confira com `terraform console -var-file=terraform.tfvars.example` (sem plan/apply) avaliando `local.acm_cdn_count`, `local.acm_api_count`, `local.ses_domain_identity_count` e `local.apigw_custom_domain_count` (devem ser 0).

## Domínio Cloudflare (`navalhia.com`) — passo posterior

Comprar o domínio **na Cloudflare**, não na AWS. Só ligue o flag depois dos CNAMEs de validação existirem e os certificados estarem ISSUED.

1. Apply inicial com `attach_custom_domains=false` (já é o padrão; não cria ACM nem identidade SES de domínio).
2. `attach_custom_domains=true` e novo plan/apply — aí saem os outputs `cloudflare_acm_validation_cdn` e `cloudflare_acm_validation_api` → CNAMEs na Cloudflare.
3. Output `ses_dkim_tokens` → CNAMEs `{token}._domainkey.navalhia.com` → `{token}.dkim.amazonses.com`.
4. Quando ACM = ISSUED, um apply com o flag true anexa aliases e o domínio da API.
5. Tráfego:
   - `app` CNAME → `cloudfront_domain`
   - apex (`navalhia.com`) CNAME flattening → o mesmo CloudFront
   - `api` CNAME → `api_custom_domain_target`

## Frontend build (produção)

Enquanto não houver domínio próprio, o front de produção é a **Vercel**. Só configure `VITE_API_URL` **depois** do apply (use o output `api_gateway_url`) e faça um novo deploy na Vercel. `CHECKOUT_REQUIRE_RISK_ACCEPTANCE` permanece ligado: o front com o aceite de risco precisa ir ao ar nessa janela.

O SPA no CloudFront (bucket estático) é opcional neste momento e usa o certificado padrão, sem `app.navalhia.com`:

```bash
# VITE_API_URL = output api_gateway_url (depois do apply). Não use api.navalhia.com enquanto o flag for false.
VITE_API_URL="$API_GATEWAY_URL" VITE_NATIVE_AI_UI=false npm ci && npm run build
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
