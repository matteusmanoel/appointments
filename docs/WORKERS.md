# Workers — variáveis de ambiente e fluxo de envio

Documentação das variáveis de ambiente e do fluxo de envio real dos workers **scheduled-messages** e **ai-worker**.

---

## 1. Worker scheduled-messages

Processa a fila `scheduled_messages`: lembretes 24h e follow-ups 30 dias. Envia mensagens via Uazapi usando o token da instância (criptografado no banco).

### Variáveis obrigatórias para envio real

| Variável | Descrição |
| -------- | --------- |
| `DATABASE_URL` | Conexão PostgreSQL (ler `scheduled_messages`, `barbershop_whatsapp_connections`). |
| `APP_ENCRYPTION_KEY` | Chave de 32+ caracteres para descriptografar `uazapi_instance_token_encrypted` (ex.: `openssl rand -hex 32`). Sem ela, o worker não consegue obter o token e não envia mensagens. |
| `UAZAPI_BASE_URL` | Base da API Uazapi (ex.: `https://free.uazapi.com`). Usada pelo client para `sendText`. |

### Variáveis opcionais

- `UAZAPI_ADMIN_TOKEN`: não é usado pelo worker; só pela API para criar/vincular instâncias. Pode ser omitido no container do worker se desejar.

### Fluxo de envio real

1. Worker faz polling em `scheduled_messages` onde `status = 'queued'` e `run_after <= now()`.
2. Para cada job, carrega o token da instância: `SELECT uazapi_instance_token_encrypted FROM barbershop_whatsapp_connections WHERE barbershop_id = ... AND status = 'connected'`.
3. Descriptografa o token com `APP_ENCRYPTION_KEY` (módulo `integrations/encryption`).
4. Chama a API Uazapi (POST para envio de texto) usando `UAZAPI_BASE_URL` e o token descriptografado.
5. Atualiza o job para `sent` ou `failed` (e `last_error` em caso de falha).

### Como rodar localmente

- Defina no `.env`: `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `UAZAPI_BASE_URL`.
- Suba o worker: `cd backend && npm run build && node dist/workers/scheduled-messages-worker.js`.
- Ou use Docker: `docker compose up worker-scheduled` (com as mesmas variáveis no `env_file` / `environment`).

---

## 2. Worker AI (ai-worker)

Processa a fila `ai_jobs`: mensagens recebidas no WhatsApp que disparam a IA. Responde via Uazapi com o token da instância.

### Variáveis obrigatórias para envio real

| Variável | Descrição |
| -------- | --------- |
| `DATABASE_URL` | Conexão PostgreSQL (ler `ai_jobs`, `barbershop_whatsapp_connections`, configurações de IA, etc.). |
| `JWT_SECRET` | Usado internamente em alguns fluxos; manter alinhado com a API. |
| `APP_ENCRYPTION_KEY` | Descriptografar o token da instância Uazapi armazenado no banco. |
| `UAZAPI_BASE_URL` | Base da API Uazapi para enviar a resposta ao WhatsApp. |
| `OPENAI_API_KEY` | Chave da OpenAI para o agente de IA. |

### Variáveis opcionais

- `AI_WORKER_CONCURRENCY`, `AI_JOB_MAX_ATTEMPTS`, `AI_JOB_BACKOFF_BASE_SECONDS`: tuning do worker.
- `N8N_EVENTS_WEBHOOK_URL`, `N8N_EVENTS_SECRET`: envio de eventos para n8n (outbound).

### Fluxo de envio real

1. Worker faz polling em `ai_jobs` onde `status = 'queued'` e `run_after <= now()`.
2. Obtém o token da instância para o `barbershop_id` do job (mesmo esquema do worker scheduled: descriptografar com `APP_ENCRYPTION_KEY`).
3. Chama o agente de IA (OpenAI) para gerar a resposta.
4. Envia a resposta ao WhatsApp via client Uazapi (`UAZAPI_BASE_URL` + token).
5. Atualiza o job para `done` ou `failed`.

---

## 3. Resumo rápido

- **Envio real (WhatsApp)** em ambos os workers exige: `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `UAZAPI_BASE_URL`.
- O token por estabelecimento fica em `barbershop_whatsapp_connections.uazapi_instance_token_encrypted`; sem `APP_ENCRYPTION_KEY` não há como enviar.
- Números de teste e redirecionamentos específicos (ex.: dev) devem ficar em documentação de ambiente de desenvolvimento, não neste arquivo.

Para credenciais da Uazapi (criação de instâncias, webhook), ver **RUNBOOK.md** → Integração Uazapi.
