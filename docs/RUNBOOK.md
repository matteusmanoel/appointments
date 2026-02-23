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

- **API**: `./scripts/aws/deploy-api.sh` (exige `ARTIFACT_BUCKET`, `DATABASE_URL`, `JWT_SECRET` no `.env`; opcional Stripe/SES).
- **Static**: `./scripts/aws/deploy-static.sh` (usa ou cria o stack `navalhia-static-prod`; defina `VITE_API_URL` para o build).
- **CI/CD**: push na `main` dispara o workflow em `.github/workflows/deploy.yml` (requer OIDC role e secrets configurados).

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

| Sintoma | Causa provável | Solução |
|--------|-----------------|--------|
| **404** em algum endpoint (ex.: `Cannot POST /api/barbershops`) | Backend no container está com **código antigo** (rota nova ainda não existe na imagem em execução). | Reconstruir e **recriar** o container da API: `docker compose up -d --build api`. Só `docker compose build` não atualiza o container em execução. |
| **CORS** no console do navegador (bloqueio de origem) | A origem do front (ex.: `http://localhost:3002`) não está em `CORS_ORIGIN` do backend. | No `.env` do backend (ou do Docker), defina `CORS_ORIGIN=http://localhost:3002,http://localhost:8080,...` incluindo a URL em que o Vite está rodando. |
| **Rede / connection refused** | Backend não está rodando ou porta errada. | Subir a API: `docker compose up -d api` (ou rodar o backend localmente na porta usada em `VITE_API_URL`). Conferir: `curl -s http://localhost:3003/health`. |
| **URL errada** (404 em tudo ou em outro host) | `VITE_API_URL` apontando para outro lugar (typo, porta ou host errado). | Ajustar no `.env`: ex. `VITE_API_URL=http://localhost:3003`. Reiniciar o dev server do Vite (`npm run dev`) para recarregar variáveis. |

### Checklist rápido (local)

1. Backend no ar: `curl -s http://localhost:3003/health` deve retornar `{"status":"ok"}`.
2. CORS: no `.env` do backend, `CORS_ORIGIN` deve incluir a URL do front (ex.: `http://localhost:3002`).
3. Após mudar código do backend no Docker: `docker compose up -d --build api` para recriar o container com a nova build.
4. Teste de conectividade completo: `./scripts/test-connectivity.sh http://localhost:3003`.
