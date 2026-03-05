# Runbook — Operação e venda (MVP)

Checklist e procedimentos para colocar o NavalhIA em produção e abrir vendas.

---

## 1. CORS

- **Antes de vender**: restrinja origens em produção.
- No deploy da API, defina `CorsOrigin` com a URL do front (ex.: `https://d123.cloudfront.net`).
- Domínio em uso: **navalhia.com.br** → use `CORS_ORIGIN=https://app.navalhia.com.br,https://navalhia.com.br` (e CloudFront/API se aplicável).
- Nunca use `*` em produção quando o front usar credenciais (cookies/Authorization).
- O backend lê `CORS_ORIGIN` (lista separada por vírgula) e o API Gateway está configurado no stack; para HTTP API o CORS é tratado pelo Lambda, então o valor no env é o que vale.

---

## 2. Rate limit

- A API aplica **express-rate-limit**: 120 requisições por minuto por IP (exceto `POST /api/billing/webhook`).
- Ajuste em `backend/src/app.ts` (`windowMs`, `max`) se precisar.
- Para limites por tenant (por API key), considerar middleware adicional no futuro.

---

## 3. Alarmes (CloudWatch)

- O stack da API (`infra/api/stack.yaml`) cria dois alarmes:
  - **Lambda errors**: mais de 5 erros em 1 minuto.
  - **Lambda duration**: duração média > 25 s em 2 períodos de 1 minuto.
- Opcional: parâmetro `AlarmEmail` no stack para criar tópico SNS e enviar notificações por email (requer confirmação do email na AWS).
- Consulte alarmes no console: CloudWatch → Alarmes.

---

## 4. AWS Budgets

- Crie um orçamento no console: **Billing → Budgets → Create budget**.
- Sugestão MVP: budget mensal (ex.: USD 50) com alertas em 80% e 100%.
- Configure alertas por email para não ter surpresas de custo.

---

## 5. Backups (Supabase)

- Supabase gerencia backups conforme o plano (ver documentação do plano).
- Confirme no painel do Supabase: **Project Settings → Database** (backups automáticos / point-in-time recovery).
- Para dump manual (opcional): use `pg_dump` com a `DATABASE_URL` em ambiente seguro e armazene o resultado em local seguro.

---

## 6. Deploy

- **API**: `./scripts/aws/deploy-api.sh` (exige `ARTIFACT_BUCKET`, `DATABASE_URL`, `JWT_SECRET` no `.env`; opcional Stripe/SES, workers: `OPENAI_API_KEY`, `N8N_EVENTS_WEBHOOK_URL`, `N8N_EVENTS_SECRET`). Para staging: `STAGE=staging` (stack `navalhia-api-staging`).
- **Static**: `./scripts/aws/deploy-static.sh` (usa ou cria o stack `navalhia-static-prod`; defina `VITE_API_URL` para o build). Para staging: `STAGE=staging` (stack `navalhia-static-staging`).
- **Staging**: ver `docs/STAGING.md` (stacks separados, Stripe Test mode, domínios opcionais `staging.app.navalhia.com.br` / `staging.api.navalhia.com.br`).
- **CI/CD**: push na `main` dispara o workflow em `.github/workflows/deploy.yml` (requer OIDC role e secrets configurados).
- **Smoke E2E em produção**: `PLAYWRIGHT_BASE_URL=https://app.navalhia.com.br npx playwright test e2e/smoke.spec.ts` (não inicia servidor local; ver `e2e/README.md`).

---

## 6.1 Migrations (Supabase)

As migrations ficam em `supabase/migrations/` e devem ser aplicadas em **staging** e **produção** antes (ou logo após) cada deploy da API, para evitar drift de schema.

### Checklist de migrations

- [ ] **Listar migrations pendentes**: no diretório do projeto, `supabase migration list` (com projeto linkado) ou compare os arquivos em `supabase/migrations/` com as entradas em `supabase_migrations.schema_migrations` no banco.
- [ ] **Staging**: aplicar com `supabase db push` (ambiente de staging linkado) ou executar manualmente os `.sql` pendentes na ordem do timestamp do nome.
- [ ] **Produção**: aplicar com `supabase db push` (projeto prod linkado) ou via painel Supabase → SQL Editor, na mesma ordem.
- [ ] **Migrations críticas para automações** (incluir no pipeline de deploy):
  - `20260222140000_scheduled_messages_followup_dedupe.sql` — índice único para evitar duplicar follow-up 30 dias (obrigatório se o worker de scheduled-messages estiver ativo).
  - Demais migrations em `supabase/migrations/` conforme ordem lexicográfica (timestamp no nome).

### Comandos úteis

- Aplicar todas as pendentes (Supabase CLI, com link ao projeto): `supabase db push`
- Ver status: `supabase migration list`
- Em ambiente sem CLI: executar cada arquivo `.sql` em `supabase/migrations/` em ordem, contra o banco de staging/prod.

### Verificação de drift

Após aplicar em prod, confira que não há erros de schema em runtime (ex.: coluna ou índice faltando). Os workers (scheduled-messages, ai-worker) dependem de `scheduled_messages`, `ai_jobs`, `barbershop_whatsapp_connections` e tabelas relacionadas; garantir que todas as migrations até a última estejam aplicadas.

---

## 6.2 Workers Lambda (EventBridge)

O deploy da API (`deploy-api.sh`) sobe também as Lambdas dos workers, invocadas por EventBridge:

- **navalhia-worker-ai-prod**: rate 1 minuto (fila `ai_jobs`).
- **navalhia-worker-scheduled-prod**: rate 5 minutos (fila `scheduled_messages` + sweep diário).

### Parâmetros opcionais no deploy

No `.env` (ou parâmetros do stack) para os workers:

| Parâmetro                                     | Uso                                    |
| --------------------------------------------- | -------------------------------------- |
| `OPENAI_API_KEY`                              | Worker AI (obrigatório para IA ativa). |
| `N8N_EVENTS_WEBHOOK_URL`, `N8N_EVENTS_SECRET` | Envio de eventos para n8n (outbound).  |

### Validação pós-deploy (CloudWatch)

- **Log groups**: `/aws/lambda/navalhia-worker-ai-prod`, `/aws/lambda/navalhia-worker-scheduled-prod`.
- No console AWS: **CloudWatch → Log groups** → abrir cada um e verificar **Log streams** recentes.
- Confirmar que há invocações (EventBridge dispara a cada 1 min / 5 min) e que não há erros recorrentes (timeout, `OPENAI_API_KEY` ausente, falha de conexão com DB/Uazapi). Ver também `docs/WORKERS.md` e `docs/WORKERS_DEPLOY_ECONOMICO.md`.

---

## 6.3 Domínio customizado e API mappings (api.navalhia.com.br)

Para que rotas como `POST /api/billing/checkout` funcionem em `https://api.navalhia.com.br`, o domínio deve ter **exatamente um** mapping **root** (sem `ApiMappingKey`) apontando para a API atual do stack. Mappings antigos ou com key (ex.: `api`) fazem o path chegar errado na Lambda e geram 404 em `/api/*`.

- **Configurar/ajustar**: `./scripts/aws/setup-custom-domain.sh` (lista mappings, remove indesejados, garante um mapping root para o `API_ID` do stack).
- **Diagnóstico**: `aws apigatewayv2 get-api-mappings --domain-name api.navalhia.com.br --region us-east-1` — conferir que existe um item com `ApiId` igual ao da stack e `ApiMappingKey` vazio.

---

## 6.4 Gate para produção (testes antes de promover)

Só promover para produção quando os itens abaixo forem atendidos. Rodar **testes locais** e **E2E em staging** (quando disponível) antes de fazer deploy em prod.

### Testes locais (antes de subir qualquer alteração)

- [ ] **Backend**: `cd backend && npm ci && npx tsc` (sem erros). `npm test` (Vitest).
- [ ] **Front**: `npm ci && npm run build` (sem erros). `npx playwright test e2e/smoke.spec.ts e2e/debug-prod.spec.ts` (com `CI=1` o Playwright sobe o preview automaticamente; ver `e2e/README.md`).
- [ ] **Checkout route (opcional, exige API rodando)**: com a API em `http://localhost:3003`, `PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test e2e/checkout-route.spec.ts`.

### E2E em staging

Com staging deployado (ver `docs/STAGING.md`):

- [ ] **Smoke**: `PLAYWRIGHT_BASE_URL=https://<staging-app-url> npx playwright test e2e/smoke.spec.ts`
- [ ] **Checkout route**: `PLAYWRIGHT_BASE_URL=https://<staging-app-url> E2E_API_URL=https://<staging-api-url> npx playwright test e2e/checkout-route.spec.ts`
- [ ] **Onboarding**: validar manualmente `/onboarding?session_id=...` (checkout com cartão 4242 em Test mode): auto-login, modal de troca de senha, tour após troca.

### Checklist de gate (tudo ok antes de prod)

- [ ] Landing e login renderizam sem erros de JS (smoke + debug-prod).
- [ ] Checkout por plano mostra valor correto (Stripe Price IDs por plano).
- [ ] Onboarding: auto-login funciona e obriga troca de senha; tour roda após troca.
- [ ] Webhook provisiona barbearia e `billing_plan` correto (CloudWatch / logs da API).
- [ ] SES envia e-mails para destinatários reais (Production access; ver seção SES no runbook).

---

## 7. Checklist antes de abrir vendas

- [ ] CORS restrito à URL do front (não usar `*`).
- [ ] Rate limit ativo (padrão 120 req/min).
- [ ] Alarmes CloudWatch criados (e opcionalmente SNS/email).
- [ ] Budget AWS configurado com alertas.
- [ ] Backups do Supabase conferidos.
- [ ] API keys por estabelecimento e webhook de billing testados.
- [ ] Docs públicas (OpenAPI/Redoc) publicadas em `/docs/` no CloudFront.
- [ ] Fluxo de onboarding (checkout → webhook → email com senha temporária e API key) testado de ponta a ponta.

---

## 7.1 Checkout Stripe: preços por plano e teste em produção

### Por que o checkout mostra sempre o mesmo valor (ex.: R$ 99)?

O backend escolhe o **Price ID** do Stripe conforme o plano enviado no checkout (`essential`, `pro`, `premium`). Se só houver **um** Price ID configurado (por exemplo só `STRIPE_PRICE_ID` ou só `STRIPE_PRICE_ID_PRO`), todos os planos usam esse preço — por isso o valor exibido na Stripe fica igual (ex.: R$ 99) independente do plano selecionado.

**Solução:** criar no Stripe **três preços recorrentes** (um por plano), por exemplo:

- Essencial: R$ 97/mês
- Profissional: R$ 197/mês
- Premium: R$ 349/mês

No deploy da API (`.env` ou parâmetros do stack), definir os três:

- `STRIPE_PRICE_ID_ESSENTIAL=price_xxx`
- `STRIPE_PRICE_ID_PRO=price_xxx`
- `STRIPE_PRICE_ID_PREMIUM=price_xxx`

O `deploy-api.sh` já envia esses parâmetros para o CloudFormation quando estão no `.env`. Após redeploy, o checkout passará a exibir o valor correto para cada plano. Para criar os preços via Stripe CLI e gerar o bloco para o `.env`, use `docs/STRIPE_CLI_PRICES.md` e `scripts/stripe-output-env.sh`. Ver também `docs/CHECKOUT_FORM.md`.

### Simular primeira venda (sem pagamento real)

Para validar o fluxo de “primeira venda” e primeiro acesso **sem cobrança real**:

1. **Modo teste do Stripe**
   - No Stripe Dashboard, use **Test mode** (toggle no canto superior).
   - Configure no backend (ou stack) as chaves de **teste**: `STRIPE_SECRET_KEY=sk_test_...`, e no front `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`.
   - Crie um webhook de teste apontando para `https://api.navalhia.com.br/api/billing/webhook` e use o **Signing secret** de teste no `STRIPE_WEBHOOK_SECRET`.

2. **Cartão de teste**
   - No checkout, use o cartão **4242 4242 4242 4242** (qualquer data futura, qualquer CVC). Nenhuma cobrança real é feita.

3. **Fluxo esperado**
   - Cliente preenche o formulário na landing e escolhe um plano → checkout (embutido ou redirect).
   - Após “pagar” com 4242, o Stripe dispara `checkout.session.completed` → webhook da API cria barbershop, perfil admin, API key e grava senha temporária em `checkout_onboarding`.
   - Se `FROM_EMAIL` estiver configurado, o e-mail de onboarding (senha temporária + API key) é enviado.
   - Redirect para `/onboarding?session_id=...`: a página chama `GET /api/billing/session?session_id=...` e exibe e-mail e senha temporária (uma vez).
   - Novo usuário faz login → é solicitada a troca de senha (primeiro acesso) → acessa o painel.

Assim você valida: criação de conta, e-mail (opcional), onboarding, login e primeiro acesso como se fosse a primeira venda.

### E-mail de onboarding não chega (SES)

Se `FROM_EMAIL=no-reply@navalhia.com.br` está configurado mas o e-mail com credenciais não chega:

1. **SES em sandbox**: em sandbox o SES só envia para **endereços verificados**. Adicione o e-mail de teste em **SES → Verified identities → Create identity (Email)** ou solicite **Production access** (ver seção **SES — Production access e entregabilidade** abaixo). Ver `docs/SES_NAVALHIA_DOMAIN.md`.
2. **DKIM**: confira se os 3 registros CNAME de DKIM do domínio estão no DNS e se `get-email-identity` mostra `DkimAttributes.Status: SUCCESS`.
3. **Logs**: a API registra `[SES] Onboarding email sent to ...` em sucesso ou `[SES] Failed to send onboarding email:` em falha. No CloudWatch, abra o log group da Lambda da API (`/aws/lambda/navalhia-api-prod`) e busque por `SES` ou `billing` para ver o erro.

### SES — Production access e entregabilidade

**Request Production access (passo a passo):**

1. Console AWS → **Amazon SES** (região us-east-1) → **Account dashboard**.
2. Clique em **Request production access**.
3. Preencha: caso de uso (onboarding + recuperação de senha para clientes que assinam), volume estimado de e-mails/mês, como os destinatários optam (formulário de checkout), confirmação de que não envia spam. Aprovação costuma levar até 24–48 h.

**Checklist DKIM/SPF/DMARC (entregabilidade):**

- [ ] **DKIM**: os 3 registros CNAME do domínio no DNS (ver `docs/SES_NAVALHIA_DOMAIN.md`). Verificar: `aws sesv2 get-email-identity --email-identity navalhia.com.br --region us-east-1` → `DkimAttributes.Status: SUCCESS`.
- [ ] **SPF** (opcional mas recomendado): registro TXT em `navalhia.com.br` com `v=spf1 include:amazonses.com ~all` (ou o valor sugerido pelo SES se usar outro provedor).
- [ ] **DMARC** (opcional): TXT em `_dmarc.navalhia.com.br` com política (ex.: `v=DMARC1; p=none; rua=mailto:...`) para monitorar e depois endurecer.

**Depuração de erros SES (CloudWatch):**

- **MessageRejected**: destinatário inválido ou sandbox bloqueando; verificar Production access ou lista de verificados.
- **AccountSendingPausedException**: conta pausada (abuse/complaint); abrir ticket no AWS Support.
- **InvalidParameterValue**: `FROM_EMAIL` não verificado ou domínio sem DKIM concluído.
- Logs da API: filtrar por `[SES]` ou `[billing]` no log group da Lambda.

### Passo a passo para testar em produção

Use este checklist para validar em **produção** (com moderação: preferir modo teste do Stripe e cartão 4242 para não gerar cobranças reais).

1. **Infra e API**
   - [ ] `curl -s https://api.navalhia.com.br/health` → `{"status":"ok"}`.
   - [ ] `curl -s -X POST https://api.navalhia.com.br/api/billing/checkout -H "Content-Type: application/json" -d '{"barbershop_name":"Teste","phone":"11999999999","email":"teste@example.com"}' -i` → não retorna 404 (esperado 400 por validação ou 503 se Stripe não configurado).

2. **Landing e planos**
   - [ ] Abrir `https://app.navalhia.com.br` (ou domínio do front).
   - [ ] Clicar em **Começar agora** / **Assinar** e abrir o modal de checkout.
   - [ ] Selecionar cada plano (Essencial, Profissional, Premium) e, antes de pagar, **conferir no resumo da Stripe** se o valor exibido está correto (R$ 97, R$ 197, R$ 349). Se todos aparecerem iguais, revisar `STRIPE_PRICE_ID_ESSENTIAL`, `_PRO`, `_PREMIUM` no deploy.

3. **Checkout e onboarding (simulação com cartão de teste)**
   - [ ] Preencher formulário (nome da NavalhIA, telefone, e-mail) e escolher um plano.
   - [ ] Ir para pagamento; no checkout da Stripe usar cartão **4242 4242 4242 4242** (test mode).
   - [ ] Após conclusão, ser redirecionado para `/onboarding?session_id=...`.
   - [ ] Na página de onboarding: ver e-mail e senha temporária (e mensagem sobre credenciais já enviadas por e-mail, se aplicável).
   - [ ] Fazer login com esse e-mail e a senha temporária.
   - [ ] Trocar a senha no primeiro acesso (se o fluxo exigir).

4. **Funcionalidades principais no painel (após login)**
   - [ ] **Dashboard**: resumo, gráficos, lista de agendamentos.
   - [ ] **Agendamentos**: listar, filtrar, criar/editar agendamento.
   - [ ] **Serviços**: listar, criar/editar serviço (nome, preço, duração).
   - [ ] **Clientes**: listar, criar/editar cliente.
   - [ ] **Configurações**: perfil, barbeiros, integrações; **Portal de cobrança** (botão que chama `POST /api/billing/portal` e abre o Stripe Customer Portal para gerenciar assinatura/números extras).
   - [ ] **WhatsApp (IA)** (se configurado): status de conexão, mensagem de teste.

5. **Smoke E2E (opcional)**
   - [ ] `PLAYWRIGHT_BASE_URL=https://app.navalhia.com.br npx playwright test e2e/smoke.spec.ts` (ver `e2e/README.md`).

Se algum passo falhar (ex.: checkout 404, valor errado, onboarding sem credenciais), conferir: API mappings do domínio (seção 6.3), variáveis Stripe no stack e webhook do Stripe apontando para a API com o secret correto.

---

## 8. Integração Uazapi (WhatsApp plug-and-play)

### Credenciais e variáveis

Configure as seguintes variáveis no backend (`.env` em dev ou parâmetros do stack CloudFormation em prod):

| Variável                    | Obrigatório              | Descrição                                                                                                                 |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `UAZAPI_BASE_URL`           | Sim (para usar WhatsApp) | Base da API Uazapi (ex.:`https://free.uazapi.com` ou o subdomínio do seu plano em uazapi.com).                            |
| `UAZAPI_ADMIN_TOKEN`        | Sim                      | Token de administrador obtido no painel da Uazapi (criação de instâncias).                                                |
| `UAZAPI_WEBHOOK_PUBLIC_URL` | Sim                      | URL pública que receberá os eventos (ex.:`https://api.seudominio.com/api/webhooks/uazapi`). Deve ser HTTPS.               |
| `APP_ENCRYPTION_KEY`        | Sim                      | Chave de pelo menos 32 caracteres para criptografar o token da instância no banco (ex.:`openssl rand -hex 32`).           |
| `N8N_CHAT_TRIGGER_URL`      | Não                      | URL do webhook “When chat message received” do fluxo de IA no n8n. Se não definida, o bot responderá com mensagem padrão. |

Em desenvolvimento, use também `DATABASE_URL`, `JWT_SECRET` e, se quiser receber webhooks locais, exponha o backend via túnel HTTPS (ngrok, Cloudflare Tunnel, etc.) e defina `UAZAPI_WEBHOOK_PUBLIC_URL` com essa URL + `/api/webhooks/uazapi`.

### Erro 429 no start/connect (limite de instancias)

Se ao conectar o WhatsApp o backend retornar erro `429` da Uazapi ("Maximum number of instances connected reached"), significa que ja existe uma instancia conectada na conta Uazapi (mesmo que voce tenha zerado o banco).

Opcoes:

- Desconectar/remover instancias antigas diretamente no painel da Uazapi e tentar novamente.
- Vincular uma instancia ja existente (sem criar nova instancia):
  - Endpoint: `POST /api/integrations/whatsapp/uazapi/link-existing`
  - Body: `{ "token": "<token_da_instancia>", "instance_name": "opcional" }`

Importante: para o webhook resolver corretamente o tenant quando a Uazapi enviar `instanceId`, a migration que adiciona `uazapi_instance_id` em `barbershop_whatsapp_connections` deve estar aplicada.

### Validação ponta a ponta (webhook → job → worker → WhatsApp)

Após conectar ou vincular uma instância Uazapi, valide que mensagens recebidas disparam a IA e a resposta chega no WhatsApp:

1. **Confirmar status e webhook**
   - Chamar `GET /api/integrations/whatsapp/uazapi/status` (com JWT) e conferir `status: "connected"` e que o banco foi atualizado.
   - Se tiver usado link-existing ou start, conferir que `webhook_set: true` (ou configurar o webhook manualmente no painel Uazapi para `UAZAPI_WEBHOOK_PUBLIC_URL`).

2. **Enviar mensagem real**
   - De outro celular, enviar uma mensagem de texto para o número conectado.

3. **Conferir pipeline**
   - **API (webhook):** nos logs da API, deve aparecer `[uazapi webhook] inbound event=...` e `[uazapi webhook] enqueued jobId=... conversationId=...`.
   - **Banco:** `SELECT * FROM public.whatsapp_inbound_events ORDER BY received_at DESC LIMIT 1` e `SELECT * FROM public.ai_jobs WHERE status IN ('queued','processing','done') ORDER BY created_at DESC LIMIT 5`.
   - **Worker:** nos logs do `worker-ai`, deve aparecer `[ai-worker] processing jobId=...`, `[ai-worker] jobId=... AI reply len=...` e `[ai-worker] jobId=... sent to fromPhone=...`.

4. **Resultado esperado**
   - Resposta do bot no WhatsApp no mesmo chat. Se não chegar: verificar `[ai-worker] no Uazapi token` (status da conexão) ou erros de envio nos logs.

### Agente de IA: base de conhecimento e versionamento (publish/rollback)

- **Base de conhecimento (Premium):** na aba **Integrações → WhatsApp (IA)** o usuário pode configurar documentos para RAG (PDF, DOCX, TXT). O upload gera jobs em `barbershop_ai_knowledge_jobs`; o **worker knowledge** (Lambda ou processo separado) processa e grava chunks em `barbershop_ai_knowledge_chunks`. O ai-worker usa esses chunks ao montar o contexto da conversa. Ver `docs/WORKERS.md` (seção Worker Knowledge) e `docs/WHATSAPP_AGENTE_CONFIG.md`.
- **Publish/versionamento:** o stepper permite **Publicar** e **Reverter** a configuração do agente (identidade, max tokens, typing simulation). As versões ficam em `barbershop_ai_agent_versions`; a ativa em uso é a publicada. Em caso de problema, o operador pode reverter pela UI ou conferir logs do ai-worker e da API.

---

### Como testar em desenvolvimento

1. **Configurar ambiente**
   - No `.env` do backend: defina `UAZAPI_BASE_URL`, `UAZAPI_ADMIN_TOKEN`, `APP_ENCRYPTION_KEY` e `UAZAPI_WEBHOOK_PUBLIC_URL` (URL do túnel + `/api/webhooks/uazapi`).
   - Aplique as migrações: `supabase db push` ou execute os SQL em `supabase/migrations/` (incluindo `20260218160000_add_whatsapp_connections.sql`).

2. **Expor o webhook**
   - Inicie o backend e use ngrok ou Cloudflare Tunnel para expor a porta do API (ex.: 3003) em HTTPS.
   - Defina `UAZAPI_WEBHOOK_PUBLIC_URL=https://seu-tunel.ngrok.io/api/webhooks/uazapi` (ou a URL gerada pelo túnel).

3. **Conectar no painel**
   - Faça login no painel, vá em **Configurações** e clique em **WhatsApp (IA)**.
   - Clique em **Conectar WhatsApp**. Opcionalmente informe o número para usar código de pareamento em vez de QR.
   - Se aparecer o QR Code, escaneie no WhatsApp (celular) do número que deseja conectar.
   - Aguarde o status **Conectado**.

4. **Testar mensagem**
   - No modal, use **Enviar mensagem de teste** (ou envie uma mensagem de texto para o número conectado a partir de outro celular).
   - Confirme que a resposta chega (via n8n, se `N8N_CHAT_TRIGGER_URL` estiver configurado, ou mensagem padrão).

5. **Validar agendamento (opcional)**
   - Se o n8n estiver configurado com as tools do NavalhIA (header `X-API-Key` com a API key da NavalhIA), envie uma mensagem pedindo agendamento e confira se o agendamento aparece no painel.

### Como testar em produção

1. **Deploy**
   - Garanta que as migrações foram aplicadas no Supabase de produção.
   - No deploy da API (CloudFormation ou `deploy-api.sh`), informe os parâmetros: `UazapiBaseUrl`, `UazapiAdminToken`, `UazapiWebhookPublicUrl`, `AppEncryptionKey` e, se usar n8n, `N8nChatTriggerUrl`.
   - `CORS_ORIGIN` deve estar restrito aos domínios do front (não usar `*`).

2. **Conectar um número**
   - Acesse o painel em produção, **Configurações** → **WhatsApp (IA)** e conclua o fluxo de conexão (QR ou código de pareamento).

3. **Smoke test**
   - Envie uma mensagem de texto para o número conectado e confira se a resposta é recebida.
   - Use **Enviar mensagem de teste** no painel e confira no celular.

4. **Rollback**
   - Se precisar desativar: no painel use **Desconectar**.
   - Em caso de problema com a Uazapi: revogue ou altere tokens no painel da Uazapi e, se necessário, desconfigure o webhook da instância pela documentação da Uazapi.

---

## 9. Desenvolvimento local: frontend e backend

Quando o front (Vite) e a API rodam em portas diferentes, as requisições do painel para o backend podem falhar por URL errada, CORS ou API desatualizada no container. Abaixo as causas mais comuns e como evitar.

### Como o front chama a API

- O front usa `VITE_API_URL` (em `.env`) como base das chamadas (`src/lib/api.ts`).
- Se **`VITE_API_URL` estiver definido** (ex.: `http://localhost:3003`): o navegador faz a requisição **direto** para essa URL (cross-origin em relação ao front, ex.: `http://localhost:3002`).
- Se **`VITE_API_URL` não estiver definido**: as chamadas vão para o **mesmo host** do front (ex.: `http://localhost:3002/api/...`) e o **proxy do Vite** (em `vite.config.ts`) encaminha `/api` para `http://localhost:3003`.

### Causas de falha e o que fazer

| Sintoma                                                         | Causa provável                                                                                      | Solução                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **404** em algum endpoint (ex.: `Cannot POST /api/barbershops`) | Backend no container está com **código antigo** (rota nova ainda não existe na imagem em execução). | Reconstruir e **recriar** o container da API: `docker compose up -d --build api`. Só `docker compose build` não atualiza o container em execução.           |
| **CORS** no console do navegador (bloqueio de origem)           | A origem do front (ex.: `http://localhost:3002`) não está em `CORS_ORIGIN` do backend.              | No `.env` do backend (ou do Docker), defina `CORS_ORIGIN=http://localhost:3002,http://localhost:8080,...` incluindo a URL em que o Vite está rodando.       |
| **Rede / connection refused**                                   | Backend não está rodando ou porta errada.                                                           | Subir a API: `docker compose up -d api` (ou rodar o backend localmente na porta usada em `VITE_API_URL`). Conferir: `curl -s http://localhost:3003/health`. |
| **URL errada** (404 em tudo ou em outro host)                   | `VITE_API_URL` apontando para outro lugar (typo, porta ou host errado).                             | Ajustar no `.env`: ex. `VITE_API_URL=http://localhost:3003`. Reiniciar o dev server do Vite (`npm run dev`) para recarregar variáveis.                      |

### Checklist rápido (local)

1. Backend no ar: `curl -s http://localhost:3003/health` deve retornar `{"status":"ok"}`.
2. CORS: no `.env` do backend, `CORS_ORIGIN` deve incluir a URL do front (ex.: `http://localhost:3002`).
3. Após mudar código do backend no Docker: `docker compose up -d --build api` para recriar o container com a nova build.
4. Teste de conectividade completo: `./scripts/test-connectivity.sh http://localhost:3003`.
