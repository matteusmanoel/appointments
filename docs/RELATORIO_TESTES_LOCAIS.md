# Relatório: Migrations, Rebuild e Testes Locais

**Data:** 2025-02-21

## 1. Migrations aplicadas

Migrations executadas no Postgres local (Docker) via `psql`:

| Migration | Resultado |
|-----------|-----------|
| `20260221180000_scheduled_messages_and_opt_out.sql` | OK – tabela `scheduled_messages`, índice, `clients.marketing_opt_out` |
| `20260221190000_appointment_public_token.sql` | OK – coluna `appointments.public_token`, índice único (UPDATE 0 = sem linhas para backfill) |
| `20260221200000_accounts_and_memberships.sql` | OK – `accounts`, `account_memberships`, `barbershops.account_id`, backfill (1 account/barbershop, 1 membership) |
| `20260221210000_ai_model_premium.sql` | OK – `barbershop_ai_settings.model_premium` |
| `20260222120000_ai_agent_profile_and_versions.sql` | OK (alguns objetos já existiam, NOTICEs apenas) |
| `20260222130000_ai_quality_metrics.sql` | OK (objetos já existiam, NOTICEs apenas) |

**Observação:** O schema inicial (`20260131203523_...`) já estava aplicado; por isso não foi reexecutado.

---

## 2. Rebuild dos containers

- **Erro no build:** em `backend/src/routes/auth.ts` (linha 209) o handler `POST /switch-barbershop` fazia `return res.json(...)`, e o tipo do handler é `Promise<void>`, o que gerava `TS2322: Type 'Response' is not assignable to type 'void'`.
- **Correção:** troca de `return res.json(...)` por `res.json(...); return;` para não retornar valor.
- **Rebuild:** `docker compose build` concluído com sucesso para `api`, `worker-ai`, `worker-scheduled`.

---

## 3. Testes (terminal)

### Backend (`backend/`)

```bash
cd backend && npm run test
```

- **Resultado:** 4 arquivos, 29 testes – **todos passando**
- Arquivos: `prompt-builder.test.ts`, `agent-violations.test.ts`, `webhook-uazapi.test.ts`, `whatsapp-ai-routes.test.ts`

### Frontend (raiz do projeto)

```bash
npm run test
```

- **Resultado:** 3 arquivos, 8 testes – **todos passando**
- Arquivos: `example.test.ts`, `slots.test.ts`, `serviceLabel.test.ts`

---

## 4. Status dos containers

Após `docker compose up -d`:

| Serviço           | Status   | Porta / Observação        |
|-------------------|----------|----------------------------|
| db                | Up (healthy) | 5432                    |
| api               | Up (healthy) | 3003 → 3000             |
| worker-ai         | Up       | -                          |
| worker-scheduled  | Up       | -                          |

- **Health check da API:** `curl http://localhost:3003/health` → **200**
- **Worker scheduled:** log `[scheduled-messages-worker] started` – rodando normalmente.

---

## 5. Ajustes e recomendações para uso local

### CORS e frontend

- No `docker-compose.yml`, `CORS_ORIGIN` está como `http://localhost:8080` por padrão.
- O Vite do projeto sobe em **3002** (`npm run dev`).
- Para testar o app no browser contra a API em 3003, use no `.env` (ou no `docker-compose`):

  ```env
  CORS_ORIGIN=http://localhost:3002,http://localhost:8080
  ```

  E no frontend (`.env` na raiz):

  ```env
  VITE_API_URL=http://localhost:3003
  ```

### Testes de disparo (WhatsApp / scheduled messages)

- **Remetente (número da barbearia):** 45999325199  
- **Destinatário (cliente):** 45988230845  

Para os disparos (lembrete 24h, follow-up 30d) funcionarem:

1. **Conexão WhatsApp:** o barbershop usado nos testes deve ter em `barbershop_whatsapp_connections` uma linha com `provider = 'uazapi'`, `status = 'connected'` e o token Uazapi (ou `uazapi_instance_id`/nome) correspondente ao número **45999325199**.
2. **Variáveis no worker/API:** `UAZAPI_BASE_URL`, `UAZAPI_ADMIN_TOKEN` e, se necessário, `APP_ENCRYPTION_KEY` para descriptografar o token da conexão.
3. **Dados de teste:** criar um agendamento com cliente cujo telefone normalizado seja **45988230845**; o lembrete 24h será enfileirado (e enviado na janela 9–20h, timezone do barbershop) se o plano for Pro/Premium e a conexão WhatsApp estiver ativa.

Para validar apenas a fila (sem envio real), insira em `scheduled_messages` um job com `to_phone = 45988230845` e verifique os logs do `worker-scheduled` (envio ou skip por horário/opt-out/token).

---

## 6. Resumo

| Item                    | Status |
|-------------------------|--------|
| Migrations locais       | Aplicadas (MVP + AI) |
| Build (auth fix)        | Corrigido e build OK |
| Containers              | db, api, worker-ai, worker-scheduled rodando |
| Testes backend          | 29 passed |
| Testes frontend         | 8 passed |
| API health              | 200 |
| Worker scheduled        | Iniciado e em execução |

Nenhuma falha restante nos testes automatizados. Para testes de disparo reais, configurar a conexão Uazapi e o número 45999325199 no banco e usar o destinatário 45988230845 conforme acima.
