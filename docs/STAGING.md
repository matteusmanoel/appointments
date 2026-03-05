# Staging — Infra e deploy

Ambiente de staging na AWS para validar fluxos (checkout, onboarding, webhooks) antes de promover para produção. Usa os mesmos templates CloudFormation que produção, com `Stage=staging` e variáveis separadas (Stripe Test mode, opcionalmente SES e CORS para URLs de staging).

## Stacks

| Stack | Descrição |
|-------|-----------|
| `navalhia-api-staging` | Lambda API + API Gateway HTTP + workers (AI, scheduled-messages). Nome da função: `navalhia-api-staging`. |
| `navalhia-static-staging` | S3 + CloudFront para o frontend. Bucket: `navalhia-static-staging-<account-id>-app`. |

Ambos os templates já suportam o parâmetro `Stage` com valores `prod` ou `staging` (`infra/api/stack.yaml`, `infra/static/stack.yaml`).

## Deploy

### API (staging)

Requer as mesmas variáveis que produção (podem vir de `.env.staging` ou de outro arquivo). Use **Stripe Test mode** e, se quiser, mesma `DATABASE_URL` (banco compartilhado com cuidado) ou um banco de staging.

```bash
# Exemplo: deploy API para staging
export STAGE=staging
# Opcional: carregar env específico
# set -a && source .env.staging && set +a
./scripts/aws/deploy-api.sh
```

Isso usa `STACK_NAME=navalhia-api-staging` (default quando `STAGE=staging`) e passa `Stage=staging` para o CloudFormation. Configure no ambiente (ou `.env.staging`):

- `ARTIFACT_BUCKET`, `DATABASE_URL`, `JWT_SECRET` (obrigatórios)
- `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_*` (Test mode; ver [Stripe Test mode em staging](#stripe-test-mode-em-staging))
- `CORS_ORIGIN`: ex.: `https://<staging-cloudfront-domain>.cloudfront.net` ou, quando existir, `https://staging.app.navalhia.com.br`
- `FROM_EMAIL`, `APP_URL` (opcional; `APP_URL` deve ser a URL do front de staging)
- Demais variáveis (Uazapi, N8n, etc.) conforme necessário

### Static (staging)

Build do front com `VITE_API_URL` apontando para a API de staging (CloudFront da API ou domínio customizado).

```bash
export STAGE=staging
# URL da API de staging (saída do deploy da API ou domínio custom)
export VITE_API_URL=https://<api-gateway-id>.execute-api.us-east-1.amazonaws.com
# Chave pública Stripe Test mode
export VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
./scripts/aws/deploy-static.sh
```

O script usa `STACK_NAME=navalhia-static-staging` quando `STAGE=staging`.

## URLs de acesso

Após o deploy, sem domínios customizados:

- **App (front)**: URL do CloudFront exibida no output do deploy (ex.: `https://d123abc.cloudfront.net`). Obtenha com:
  ```bash
  aws cloudformation describe-stacks --stack-name navalhia-static-staging --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text
  ```
- **API**: URL do API Gateway (ex.: `https://abc123.execute-api.us-east-1.amazonaws.com`). Obtenha com:
  ```bash
  aws cloudformation describe-stacks --stack-name navalhia-api-staging --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text
  ```

### Domínios customizados (opcional)

Para usar, por exemplo:

- `staging.app.navalhia.com.br` → CloudFront do static staging (registro CNAME ou Route53 alias para o distribution).
- `staging.api.navalhia.com.br` → API Gateway (HTTP API) custom domain + certificado ACM.

Configure no API Gateway: **Custom domain names** → Create → domínio `staging.api.navalhia.com.br`, mapeando para o API de staging. Ajuste então `CORS_ORIGIN` e `VITE_API_URL` para essas URLs.

## Stripe Test mode em staging

Em staging use **sempre** Stripe em **Test mode** para evitar cobranças reais e validar checkout/onboarding fim a fim.

### 1. Chaves e Price IDs

- **API (backend)**: `STRIPE_SECRET_KEY=sk_test_...` (obtenha em [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/test/apikeys), modo Test).
- **Front (build)**: `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` (mesma página, chave publicável).
- **Price IDs**: crie produtos e preços no **Test mode** conforme `docs/STRIPE_CLI_PRICES.md` (Essential, Pro, Premium, Extra number). Use os IDs `price_xxx` retornados no `.env.staging` e no deploy da API:
  - `STRIPE_PRICE_ID_ESSENTIAL`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_PREMIUM`, `STRIPE_PRICE_ID_EXTRA_NUMBER` (opcional).

### 2. Webhook

- **Endpoint**: a API de staging deve expor o webhook publicamente, ex.: `https://<api-gateway-id>.execute-api.us-east-1.amazonaws.com/api/billing/webhook` ou `https://staging.api.navalhia.com.br/api/billing/webhook` (se domínio custom estiver configurado).
- **Secret**:
  - **Opção A (recomendada para validação local)**: use o Stripe CLI: `stripe listen --forward-to https://<staging-api-url>/api/billing/webhook`; o CLI exibe um `whsec_...` — use-o como `STRIPE_WEBHOOK_SECRET` ao testar localmente. Para o Lambda de staging receber eventos reais do Stripe, crie um endpoint no Dashboard.
  - **Opção B**: no [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks), adicione um endpoint apontando para a URL do webhook de staging (modo Test). Copie o **Signing secret** (`whsec_...`) e configure no deploy da API: `STRIPE_WEBHOOK_SECRET=whsec_...`.

### 3. Validação

- **Checkout com cartão de teste**: no front de staging, abra o fluxo de checkout e use o número **4242 4242 4242 4242** (qualquer data futura, CVC e CEP). Confirme que o redirect vai para `/onboarding?session_id=...` e que o webhook `checkout.session.completed` é recebido pela API (ver logs do Lambda `navalhia-api-staging` no CloudWatch).
- **Stripe CLI (opcional)**: `stripe trigger checkout.session.completed` para simular evento; ou `stripe listen` apontando para a API de staging e realizando um checkout real em Test mode para ver o evento passar.

---

## Variáveis Stripe/SES separadas

- **Staging**: use sempre Stripe **Test mode** (`sk_test_...`, `pk_test_...`) e um webhook secret de um endpoint apontando para a API de staging (ex.: `https://staging.api.navalhia.com.br/api/billing/webhook` ou a URL do API Gateway de staging).
- **Produção**: use Stripe Live e webhook/secret de produção.
- SES: em staging pode continuar no sandbox (e-mails só para endereços verificados) ou usar a mesma conta com Production access; o importante é não misturar envio de onboarding de prod com staging (por isso `FROM_EMAIL` e `APP_URL` devem ser de staging quando quiser testar e-mail de onboarding em staging).

## Migrations

Aplique as migrations do Supabase também no banco usado por staging (se for o mesmo de prod, cuidado com dados; o ideal é um banco separado para staging). Ver `docs/RUNBOOK.md` (seção Migrations).

## Resumo de comandos

```bash
# Deploy completo staging
STAGE=staging ./scripts/aws/deploy-api.sh
STAGE=staging VITE_API_URL=https://<api-staging-url> VITE_STRIPE_PUBLISHABLE_KEY=pk_test_... ./scripts/aws/deploy-static.sh
```

Não edite o plano; use estes procedimentos para manter staging alinhado ao plano de melhorias pós-MVP.
