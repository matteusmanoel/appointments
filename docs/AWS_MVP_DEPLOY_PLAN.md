# Plano de ação completo (MVP) — Deploy AWS + Supabase (Opção A)

Este documento descreve um plano **fase a fase**, com foco em **MVP funcional, barato e fácil de manter**, usando:

- **AWS (infra automatizada via AWS CLI + CloudFormation)** para hospedar **API** e **front/docs estáticos**
- **Supabase Postgres** como banco gerenciado (menos atrito operacional no MVP)
- Integração com **n8n** via **API keys por estabelecimento** (plug-and-play)

> Região escolhida: **`us-east-1`** (tudo em uma região para simplificar).

---

## Estado atual do deploy (produção)

Após o primeiro deploy da API via `scripts/aws/deploy-api.sh`:

| Recurso | Valor |
|--------|--------|
| **API (base)** | `https://2ggnv5isxc.execute-api.us-east-1.amazonaws.com` |
| **Health** | `https://2ggnv5isxc.execute-api.us-east-1.amazonaws.com/health` |
| **API (auth, tools, public)** | `https://2ggnv5isxc.execute-api.us-east-1.amazonaws.com/api` |
| **Bucket de artifacts** | `navalhia-artifacts-bdcf2e84` |
| **Stack CloudFormation** | `navalhia-api-prod` |
| **Região** | `us-east-1` |

- **Frontend (produção)**: defina `VITE_API_URL=https://2ggnv5isxc.execute-api.us-east-1.amazonaws.com` no build.
- **n8n**: base URL das tools = `https://2ggnv5isxc.execute-api.us-east-1.amazonaws.com/api`; autenticação via header `X-API-Key` (API key por estabelecimento).

---

## Visão de arquitetura (MVP)

Sem domínio (primeiro deploy, mais rápido):

- **Front (Landing + App)**: S3 (privado) + CloudFront (CDN) → URL do CloudFront
- **Docs**: S3 + CloudFront → URL do CloudFront
- **API**: API Gateway (HTTP API) + Lambda → URL do API Gateway
- **Banco**: Supabase Postgres (conexão via `DATABASE_URL`)

Com domínio (quando comprar):

- `www.seudominio.com` → CloudFront (landing)
- `app.seudominio.com` → CloudFront (app)
- `docs.seudominio.com` → CloudFront (docs)
- `api.seudominio.com` → API Gateway custom domain

---

## Premissas do código atual (importante)

- O painel **NÃO usa Supabase Auth** hoje; ele usa **JWT da própria API**:
  - login em `POST /api/auth/login`
  - perfil em `GET /api/auth/me`
- A pasta `src/integrations/supabase/` existe, mas o fluxo de login está acoplado ao backend.
- Para n8n, já existe o conceito de endpoints “tools” (`/api/tools/*`) usando header **`x-api-key`**.

Referências úteis no repo:

- `docs/TOOL_CONTRACT.md`
- `docs/N8N_PRODUCT_API_SETUP.md`
- `docs/WHATSAPP_INTEGRATION.md`
- `docs/SALES_ONBOARDING_CHECKLIST.md`

---

## Fase 1 — “Plug and play” e segurança mínima (multi-tenant real)

### Objetivo
Permitir que o n8n envie payloads sem precisar confiar em `barbershop_id` no body.

### Trabalho de desenvolvimento (backend)
1) **Criar tabela de API keys por estabelecimento**:
   - `barbershop_api_keys` com campos mínimos:
     - `id`
     - `barbershop_id`
     - `name` (ex: "n8n-prod")
     - `key_hash` (NÃO salvar key em texto puro)
     - `last_used_at`, `created_at`, `revoked_at`

2) **Gerar keys por estabelecimento**:
   - endpoint admin no painel para criar/revogar keys (MVP pode ser só “criar 1 key”)
   - key exibida **uma vez** e depois só hash no banco

3) **Trocar `TOOLS_API_KEY` global por validação por estabelecimento**:
   - `requireToolsKey` passa a:
     - ler `x-api-key`
     - buscar a key no banco (por hash)
     - injetar `req.barbershopId` automaticamente
   - qualquer `barbershop_id` vindo no payload deve ser ignorado ou validado (se divergente, retornar `401/403`).

4) **Rate limit (MVP)**:
   - no mínimo: limitar por IP + por key na camada de API Gateway (usage plans) **ou** no Express (lib).
   - se for “MVP ultra rápido”, documentar risco e colocar como prioridade logo após vendas iniciais.

### Resultado esperado
- n8n chama:
  - `POST /api/tools/upsert_client`
  - `POST /api/tools/create_appointment`
  - etc…
- sempre com `x-api-key: <key do estabelecimento>`
- a API descobre o `barbershop_id` automaticamente.

---

## Fase 2 — Banco no Supabase (Postgres) + migrações

### Objetivo
Ter o banco online, com schema versionado e “seed” inicial para testes.

### Passos
1) Criar projeto no Supabase (UI do Supabase).
2) Obter:
   - `DATABASE_URL` (preferir string com pooler se disponível)
   - IP allowlist (se necessário; em geral, Supabase já expõe publicamente com SSL)
3) Rodar migrações:
   - use os SQLs em `supabase/migrations/` em ordem (timestamp no nome).
4) Rodar seed:
   - usar scripts já existentes no backend (`backend/src/scripts/seed.ts`, `seed-demo.ts`).

### Ajuste necessário no backend (importante para Supabase)
O `pg.Pool` atual não configura SSL. Para Supabase em produção, ajustar `backend/src/db.ts` para suportar SSL, por exemplo:

- habilitar SSL quando `NODE_ENV=production` (ou env `DATABASE_SSL=true`)
- reduzir `max` do pool em ambiente Lambda (ex: 2–5) para evitar explosão de conexões

---

## Fase 3 — Transformar a API Express em Lambda (sem container, MVP)

### Objetivo
Rodar o Express como Lambda para reduzir custo e manutenção.

### Implementação recomendada (MVP)
1) Adicionar dependência no backend:
   - `serverless-http` (adaptador Express → Lambda)
2) Separar a criação do `app` do `listen()`:
   - `src/app.ts` exporta `app`
   - `src/index.ts` fica para uso local (dev), chamando `listen`
   - `src/lambda.ts` exporta `handler` (Lambda)

### Observações de produção (MVP)
- garantir CORS correto para os domínios do CloudFront (app/landing)
- configurar timeouts (Lambda + API Gateway) compatíveis
- usar logs estruturados (mínimo)

---

## Fase 4 — Infra AWS via CloudFormation (aplicado por AWS CLI)

### Objetivo
Infra repetível e 100% automatizável pelo terminal (Cursor), com revisão em PR.

### Estrutura sugerida no repo

- `infra/`
  - `api/`
    - `stack.yaml`
    - `params.prod.json`
  - `static/`
    - `stack.yaml`
    - `params.prod.json`
  - `ci/`
    - `oidc-github-role.yaml`
- `scripts/aws/`
  - `bootstrap.sh`
  - `deploy-api.sh`
  - `deploy-static.sh`
  - `deploy-all.sh`

### 4.1 Bootstrap (uma vez)
No terminal integrado do Cursor:

1) Configurar AWS CLI:

```bash
aws configure
aws sts get-caller-identity
export AWS_REGION=us-east-1
```

2) Criar bucket de artifacts:

```bash
export PROJECT=navalhia
export SUFFIX=<um-sufixo-unico>
export ARTIFACT_BUCKET="${PROJECT}-artifacts-${SUFFIX}"
aws s3 mb "s3://${ARTIFACT_BUCKET}"
```

3) Criar bucket para estados/outputs (opcional, mas recomendado):

```bash
export STATE_BUCKET="${PROJECT}-state-${SUFFIX}"
aws s3 mb "s3://${STATE_BUCKET}"
```

### 4.2 Stack da API (Lambda + API Gateway HTTP API + logs)
Provisionar via:

```bash
aws cloudformation deploy \
  --stack-name navalhia-api-prod \
  --template-file infra/api/stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Stage=prod \
    ArtifactBucket="${ARTIFACT_BUCKET}" \
    DatabaseUrl="<SUPABASE_DATABASE_URL>" \
    JwtSecret="<JWT_SECRET_FORTE>" \
    CorsOrigin="*"
```

> No MVP inicial sem domínio, use `CorsOrigin="*"` temporariamente **apenas** para acelerar testes. Antes de vender, restrinja para os domínios do CloudFront.

### 4.3 Stack do estático (S3 + CloudFront)
Provisionar via:

```bash
aws cloudformation deploy \
  --stack-name navalhia-static-prod \
  --template-file infra/static/stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Stage=prod
```

Saídas esperadas (outputs do stack):
- CloudFront URL do `www`
- CloudFront URL do `app`
- CloudFront URL do `docs`
- Nomes dos buckets S3

---

## Fase 5 — Deploy da aplicação (build + upload + invalidation) via AWS CLI

### 5.1 Deploy da API (zip)
1) Build e bundle:
- opção simples: `tsc` + zip de `dist` + `node_modules`
- opção melhor: bundler (ex: `esbuild`) para gerar um zip pequeno (recomendado para Lambda)

2) Enviar artifact:

```bash
aws s3 cp backend/dist.zip "s3://${ARTIFACT_BUCKET}/api/dist.zip"
```

3) Atualizar stack (CloudFormation aponta para o novo artifact) **ou** atualizar a função diretamente:

```bash
aws lambda update-function-code \
  --function-name navalhia-api-prod \
  --s3-bucket "${ARTIFACT_BUCKET}" \
  --s3-key "api/dist.zip"
```

4) Smoke test:
- `GET <API_URL>/health`
- `POST <API_URL>/api/auth/login`
- `GET <API_URL>/api/auth/me` com token

### 5.2 Deploy do Front (S3 + CloudFront)
1) Build do front:

```bash
npm ci
VITE_API_BASE_URL="<API_URL>" npm run build
```

2) Upload:

```bash
aws s3 sync dist "s3://<BUCKET_APP>" --delete
```

3) Invalidation:

```bash
aws cloudfront create-invalidation --distribution-id <DIST_APP> --paths "/*"
```

### 5.3 Deploy da documentação
Gerar HTML estático (ex: Redoc) a partir de `openapi.yaml`, publicar no bucket `docs`, invalidar.

---

## Fase 6 — Domínio (quando comprar) + HTTPS “bonito”

### Objetivo
Trocar URLs técnicas (CloudFront/API Gateway) por subdomínios.

### Passo a passo
1) Comprar domínio (pode ser fora da AWS).
2) Criar Hosted Zone no Route53:

```bash
aws route53 create-hosted-zone --name seudominio.com --caller-reference "$(date +%s)"
```

3) Apontar DNS do registrador para os NS do Route53.
4) Criar certificado ACM (em `us-east-1`) para:
- `www.seudominio.com`
- `app.seudominio.com`
- `docs.seudominio.com`
- `api.seudominio.com`

5) Atualizar CloudFront + API Gateway para usar os domínios e criar records `A/AAAA` no Route53.

---

## Fase 7 — CI/CD (releases fáceis) com GitHub Actions + AWS CLI

### Objetivo
Deploy automático por push na `main`, sem chaves long-lived.

1) Criar Role OIDC para GitHub Actions via CloudFormation (`infra/ci/oidc-github-role.yaml`).
2) Workflow com 2 jobs:
- **api**: build → zip → upload S3 → update Lambda/CloudFormation
- **static**: build → `s3 sync` → invalidation CloudFront

> Resultado: seu fluxo vira “estilo Vercel”, mas com AWS e controle total via CLI.

---

## Fase 8 — Vendas (checkout) + provisionamento automático

### MVP “mais barato e rápido”
1) Começar com **payment link/checkout hospedado** (Stripe/MercadoPago/Pagar.me).
2) Criar endpoint na API:
- `POST /api/billing/webhook`
3) Quando o pagamento confirmar:
- criar estabelecimento
- criar perfil admin
- gerar `api_key` do estabelecimento
- enviar email com acesso + instruções de n8n

Email:
- MVP: SES (após liberar produção) ou provedor externo (Resend/Postmark) para acelerar.

---

## Fase 9 — Operação mínima (para vender com tranquilidade)

- **Budget/Alerts na AWS** (obrigatório para não ter surpresa)
- **Logs e métricas** (CloudWatch) + alarmes simples (5xx, latency)
- **Backups**:
  - Supabase: backups/snapshots (conferir plano)
  - script `scripts/backup-db.sh` adaptado para Supabase (se necessário)
- **Checklist antes de abrir vendas**:
  - CORS restrito
  - rate limit habilitado
  - `api_key` por estabelecimento funcionando
  - docs públicas publicadas

---

## Entregáveis (ordem sugerida)

1) Migração + código: API keys por estabelecimento + validação no middleware tools
2) Ajuste SSL/pool do Postgres no backend (Supabase)
3) OpenAPI + docs estáticas
4) Adaptar Express para Lambda (`serverless-http`)
5) Criar `infra/` com CloudFormation (API + static)
6) Criar `scripts/aws/*.sh` para bootstrap e deploy
7) GitHub Actions (OIDC) e pipeline de release
8) Webhook de billing + provisionamento (vendas)

---

## Próxima ação recomendada (para começar hoje)

1) Definir no `.env` (local) os valores:
- `DATABASE_URL` (Supabase)
- `JWT_SECRET`
- variáveis do front `VITE_API_URL` (local ou produção; ver `.env.example`)
- para deploy API: `ARTIFACT_BUCKET` (ex.: `navalhia-artifacts-bdcf2e84`)

2) Executar local:
- `docker compose up db api` (se for continuar usando Postgres local para desenvolvimento)
- ou apontar o backend local para o Supabase e rodar seeds

3) Re-deploy da API: `./scripts/aws/deploy-api.sh` (usa `.env`; exige `ARTIFACT_BUCKET`, `DATABASE_URL`, `JWT_SECRET`).

