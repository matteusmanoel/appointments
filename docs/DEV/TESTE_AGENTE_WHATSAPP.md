# Teste do agente WhatsApp (Evolution)

Instância de laboratório `navalhia-lab` pareada em **5545988230845** (chip pessoal). Ela não é o agente: o webhook dessa instância é ignorado. A loja **+55 45 98843-2998** atende qualquer conversa individual. Grupos (`@g.us`) são descartados na Evolution e na Uazapi. `/deletar` zera conversa, agenda e o plano do chip que enviou.

Instância de teste: o agente atende no chip da loja; você conversa pelo chip do cliente.

| Papel | Número | Uso |
|--------|--------|-----|
| Loja / agente | **+55 45 98843-2998** (`5545988432998`) | Parear no painel (QR). Envia respostas, lembretes e follow-ups. |
| Cliente | **+55 45 98823-0845** (`5545988230845`) | Envia as mensagens de teste para o número da loja. |

Tudo vive num único `.env` na raiz do repositório. Não use `.env.evolution`.

---

## 1. Subir o ambiente

Na raiz:

Neste Mac o plugin `docker compose` pode não existir — use `docker-compose`. Com `-f` explícito o override **não** entra sozinho; sem ele o Postgres publica 5432 em vez de 5433 (`DATABASE_URL` do `.env`).

```bash
docker-compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.evolution.yml up -d --build
```

Confirme:

```bash
curl -s http://localhost:3003/health
curl -s -H "apikey: $(grep ^EVOLUTION_API_KEY .env | cut -d= -f2)" http://localhost:8081 | head
npm run dev   # frontend em http://localhost:3002 (se ainda não estiver rodando)
```

Seed (schema + admin + serviços + barbeiros):

```bash
cd backend
npx tsx scripts/run-all-migrations.ts
npx tsx src/scripts/seed.ts
npx tsx src/scripts/seed-demo.ts
```

Login no painel:

- URL: `http://localhost:3002`
- E-mail: `admin@navalhia.com.br`
- Senha: `admin123`

Plano da loja no seed é **premium** (lembretes e follow-ups ligados).

### Se a API rodar no host (`cd backend && npm run dev`) em vez do Compose

No `.env`, mude o webhook para o que a Evolution (container) consegue alcançar:

```bash
EVOLUTION_WEBHOOK_PUBLIC_URL=http://host.docker.internal:3000/api/webhooks/evolution
```

Depois reconecte o WhatsApp no painel (o webhook é gravado na Evolution no `connect`).

---

## 2. Conectar o número da loja

1. Abra **Integrações** (`/app/integracoes`).
2. Informe o telefone da loja: `45988432998` (ou `+55 45 98843-2998`).
3. Clique em **Conectar** e escaneie o QR **com o WhatsApp de +55 45 98843-2998** (Aparelhos conectados).
4. Espere `connected`.
5. Envie uma mensagem de teste para `45988230845`. O chip do cliente deve receber.

Checagens:

```sql
SELECT provider, status, whatsapp_phone, evolution_instance_name, last_error
FROM barbershop_whatsapp_connections;
```

- `provider = evolution`, `status = connected`.
- `last_error` vazio (webhook ok).

Workers: o Compose sobe `worker-ai` e `worker-scheduled`. No host:

```bash
cd backend
npm run worker:ai
npm run worker:scheduled
```

---

## 3. Regras gerais do que é sucesso

- Resposta da IA chega no chip do cliente **sem** o dono precisar tocar no celular da loja.
- Agendamento criado pelo chat fica **pending** e **já ocupa o horário** na grade (`/app/agendamentos`).
- Dashboard mostra o evento em **atividade da agenda**.
- Ping do dono (WhatsApp) só em criação / cancelamento / reagendamento feitos pela IA — **não** em confirmação RSVP, lembrete ou no-show.
- “Sim” / “confirmo” depois de lembrete **não** cria outro horário.

O ping do dono usa `profiles.phone` do admin, senão `barbershops.phone`. Com só dois chips, o destino cai no número da loja e a entrega costuma falhar. A evidência confiável do dono neste teste é o **feed no Dashboard**. Para validar o ping de verdade, coloque um terceiro número em `profiles.phone`.

---

## 4. Cenários no WhatsApp (cliente → loja)

Horário comercial do seed: seg–sex 09:00–19:00, sáb 09:00–18:00, domingo fechado. Barbeiros: **Eduardo Gustavo** e **Lucas Lima**. Serviços: Corte masculino, Barba completa, Corte e Barba, Sobrancelha.

Use o chip **+55 45 98823-0845**. Entre um cenário e outro, confira agenda + feed.

### A. Primeiro contato

**Enviar:** `Oi`

**Esperado:** saudação da loja, oferta de serviços ou de agendar. Sem UUID, sem “sou uma IA”.

### B. Agendar

**Enviar (um turno ou em sequência):**

```
Quero cortar o cabelo sábado com o Eduardo
```

Se pedir horário: escolha um slot livre que o agente listar (ex. `sábado às 10h`).

**Esperado:**

- Confirmação no chat (serviço, barbeiro, data, hora).
- Linha na agenda com status **pending**.
- Feed: `appointment_created` / ator `ai`.
- Cliente `Mateus Manoel` / telefone `5545988230845` (ou equivalente com/sem 9).
- Jobs `reminder_24h` e `reminder_2h` em `scheduled_messages` se o horário ainda estiver a mais de 24h / 2h.

```sql
SELECT id, status, scheduled_date, scheduled_time
FROM appointments
WHERE scheduled_date >= CURRENT_DATE
ORDER BY created_at DESC LIMIT 5;

SELECT type, status, run_after, to_phone
FROM scheduled_messages
ORDER BY created_at DESC LIMIT 10;
```

### C. Listar próximos

**Enviar:** `quais são meus horários?`

**Esperado:** o pending recém-criado, sem inventar outro.

### D. Reagendar

**Enviar:** `pode mudar para mais tarde no mesmo dia?` (ou o horário que o agente oferecer)

**Esperado:**

- Agenda no **novo** slot; o antigo livre.
- Feed: `rescheduled` / `ai`.
- Lembretes antigos skipped; novos enfileirados para o novo horário.

### E. Cancelar

**Enviar:** `quero cancelar esse horário`

**Esperado:**

- Status `cancelled`.
- Slot livre na grade.
- Feed: `cancelled` / `ai`.
- Lembretes daquele id `skipped`.

Crie **outro** agendamento (cenário B) antes dos lembretes — o cancelado não serve para RSVP.

---

## 5. Lembretes (acelerar o relógio)

Agende para **daqui 2+ dias** (senão o worker não insere reminder com `run_after` no passado).

Depois, no Postgres da NavalhIA (`localhost:5433`, user `navalhia`):

```sql
UPDATE scheduled_messages
SET run_after = now(), status = 'queued', last_error = NULL
WHERE type IN ('reminder_24h', 'reminder_2h')
  AND status = 'queued';
```

Espere até ~30s (`worker-scheduled`).

**Esperado no chip do cliente:**

- 24h: “Fala, Mateus!” + serviço/data/barbeiro + pedido para confirmar/cancelar/remarcar no WhatsApp.
- 2h: “Oi, Mateus!” + “em breve”.
- Feed: `reminder_sent`.
- **Não** muda o status do appointment (continua `pending`).

A janela de envio neste `.env` está `0–24` (qualquer hora). Em produção o padrão é 9h–20h.

### F. RSVP — confirmar no chat (não criar outro)

Depois do lembrete, **do cliente:**

```
confirmo
```

(também vale `sim` / `ok`)

**Esperado:**

- Status `confirmed` no **mesmo** `appointments.id`.
- Chat reconhece presença; **não** diz que agendou um horário novo.
- Feed: `confirmed`.
- Sem ping de ocupação nova.

```sql
SELECT id, status FROM appointments ORDER BY updated_at DESC LIMIT 3;
```

**Anti-regressão:** se aparecer um segundo appointment no mesmo dia, o RSVP falhou.

### G. Recusar no lembrete

Com outro pending + lembrete enviado: `não vou poder`.

**Esperado:** agente cancela ou reagenda; agenda e feed batem com o que foi dito.

---

## 6. Follow-ups

Sweep roda no worker (ao subir e 1x/dia). Para forçar:

### Follow-up 30 dias (cliente que já cortou)

```sql
-- último corte há 31 dias (ajuste o client_id)
UPDATE appointments
SET scheduled_date = CURRENT_DATE - 31, status = 'completed'
WHERE id = '<uuid>';

-- se o sweep já inseriu este mês, apague o dedupe para retestar
DELETE FROM scheduled_messages
WHERE dedupe_key LIKE 'followup_30d:%' AND to_phone LIKE '%988230845%';
```

Reinicie `worker-scheduled` ou espere o sweep. Depois:

```sql
UPDATE scheduled_messages
SET run_after = now(), status = 'queued'
WHERE type = 'followup_30d' AND status = 'queued';
```

**Esperado:** “faz um tempo que a gente não se vê” + link `/b/navalhia-teste`.

### Follow-up primeiro contato (conversou e não agendou)

Converse (`oi` / `quanto é o corte?`) **sem** agendar. Depois:

```sql
UPDATE ai_conversations
SET last_message_at = now() - interval '31 days'
WHERE channel = 'whatsapp'
  AND regexp_replace(external_thread_id, '[^0-9]', '', 'g') LIKE '%988230845%';

DELETE FROM scheduled_messages
WHERE dedupe_key LIKE 'followup_30d:first_visit:%';
```

Reinicie o worker scheduled e adiante o `run_after` como acima.

**Esperado:** “Bora marcar seu primeiro horario?” + link de agenda.

---

## 7. No-show

Com um pending/confirmed cujo horário já passou há mais de 15 min:

```sql
UPDATE appointments
SET scheduled_date = CURRENT_DATE,
    scheduled_time = (now() AT TIME ZONE 'America/Sao_Paulo' - interval '20 minutes')::time,
    status = 'pending'
WHERE id = '<uuid>';
```

Reinicie `worker-scheduled` (sweep de no-show no boot).

**Esperado:** status `no_show`; feed `no_show` / `system`; slot livre. Sem WhatsApp obrigatório ao cliente.

---

## 8. Inbox e eco `fromMe`

1. Inbox (`/app/whatsapp-interno`): as falas do cliente e da IA aparecem (fonte: `ai_messages`, não o `findMessages` da Evolution).
2. Mensagem **da IA** não deve pausar o agente.
3. Se você responder **manualmente no celular da loja** para o cliente, a IA deve **pausar** (humano no aparelho). Retome em Integrações.

---

## 9. Checklist rápido

| # | Ação | Evidência |
|---|------|-----------|
| 1 | QR no 98843-2998 | `connections.status = connected` na Evolution (`connectionState` = `open`) |
| 2 | `Oi` do 98823-0845 | Resposta da IA no cliente |
| 3 | Agendar | pending na grade + feed created |
| 4 | Reagendar | slot novo; antigo livre |
| 5 | Cancelar | cancelled + lembretes skipped |
| 6 | Acelerar reminder | texto de lembrete no cliente |
| 7 | `confirmo` | mesmo id → confirmed; sem appointment extra |
| 8 | Follow-up 30d / 1ª visita | template no cliente |
| 9 | No-show | status + feed |
| 10 | Inbox | histórico coerente |

---

## 10. Falhas comuns

| Sintoma | O que olhar |
|---------|-------------|
| QR ok, IA muda | `worker-ai` no ar? `OPENAI_API_KEY` no `.env`? |
| IA não recebe a mensagem | webhook: `EVOLUTION_WEBHOOK_PUBLIC_URL`; `last_error` da conexão; logs da API em `POST /api/webhooks/evolution` |
| Lembrete não sai | `run_after` no futuro; `status=queued`; worker-scheduled; plano `pro`/`premium` |
| RSVP cria horário novo | golden `remind-01-confirma-no-chat`; pending precisa existir e o texto do lembrete não pode disparar o fast-path de create |
| Evolution 401 | `EVOLUTION_API_KEY` do `.env` = `AUTHENTICATION_API_KEY` do container (recreate se a chave mudou) |
| API no host, webhook morto | use `host.docker.internal` e reconecte |
| Conectou o QR e a sessão cai (`conflict` / `replaced` / `state: close`) | Não clique em Conectar de novo enquanto espera. O GET status não deve reabrir socket. Reconecte **uma vez** e saia da tela de pareamento. |
| Mensagem chega no log mas `skip` com telefone preenchido | JIDs `@lid` — o parser deve aceitar `remoteJidAlt` / telefone extraído. |

Rotacione JWT, `APP_ENCRYPTION_KEY`, `EVOLUTION_API_KEY` e senhas do Postgres/Redis da Evolution **depois** desta bateria. Trocar `APP_ENCRYPTION_KEY` invalida tokens Uazapi/Evolution já cifrados no banco — reconecte o WhatsApp.
