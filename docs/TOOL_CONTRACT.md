# Tool Contract — Product API (n8n MCP)

Todas as tools são chamadas pelo n8n (MCP client) contra o **Backend do Produto**. Autenticação: header `Authorization: Bearer <API_KEY>` ou `X-API-Key: <API_KEY>`.

**Multi-tenant (SaaS):** cada estabelecimento tem sua própria API Key (gerada no painel em Integrações). O `barbershop_id` é **sempre inferido** pela API a partir da key; não envie `barbershop_id` em query ou body — ele será ignorado. Basta configurar no n8n uma credencial com a API Key da NavalhIA.

Em instalação single-tenant (on-prem), uma única key pode ser usada e o `barbershop_id` continua inferido (ex.: env `BARBERSHOP_ID` ou único registro).

---

## 1. list_services

**Descrição:** Lista serviços ativos da NavalhIA (nome, valor, descrição; sem comissão).

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| barbershop_id | UUID | Não (inferido pela API Key) | Não enviar; a API usa o tenant da key. |

**Resposta (200):** JSON array de objetos:
- `id`, `name`, `description`, `price`, `duration_minutes`, `category`
- Não incluir `commission_percentage`.

---

## 2. list_barbers

**Descrição:** Lista barbeiros (apenas ativos para exibição ao cliente; inativos não devem ser listados para o agente).

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| barbershop_id | UUID | Não (inferido pela API Key) | Não enviar; a API usa o tenant da key. |

**Resposta (200):** JSON array de objetos:
- `id`, `name`, `status` (apenas `active` ou `break` no MVP para listagem)
- Opcional: `schedule` (horário de trabalho)

---

## 3. list_appointments

**Descrição:** Lista agendamentos em uma data (para verificar horários ocupados). Não expor dados de outros clientes (ex.: só horário e barbeiro, sem nome do cliente).

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| barbershop_id | UUID | Não (inferido pela API Key) | Não enviar; a API usa o tenant da key. |
| date | string (yyyy-MM-dd) | Sim | Data do agendamento |
| barber_id | UUID | Não | Filtrar por barbeiro |

**Resposta (200):** JSON array de slots ocupados, ex.:
- `barber_id`, `scheduled_time`, `duration_minutes` (para calcular fim do slot)
- Não incluir `client_id` ou nome do cliente.

---

## 4. upsert_client

**Descrição:** Busca cliente por telefone na NavalhIA; se não existir, cria. Se existir, pode atualizar nome/notes.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| barbershop_id | UUID | Não (inferido pela API Key) | Não enviar; a API usa o tenant da key. |
| phone | string | Sim | Telefone (normalizado) |
| name | string | Não | Nome do cliente |
| notes | string | Não | Observações |

**Resposta (200):** Objeto cliente: `id`, `name`, `phone`, `barbershop_id`. Usar `id` em `create_appointment`.

---

## 5. create_appointment

**Descrição:** Cria um novo agendamento. A API deve aplicar a **regra de conflito** e retornar erro se o slot estiver ocupado.

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|-------------|-----------|
| barbershop_id | UUID | Não (inferido pela API Key) | Não enviar; a API usa o tenant da key. |
| client_id | UUID | Sim | ID do cliente (retornado por upsert_client) |
| barber_id | UUID | Sim | ID do barbeiro |
| service_id | UUID | Sim | ID do serviço |
| date | string (yyyy-MM-dd) | Sim | Data |
| time | string (HH:mm) | Sim | Horário de início |
| notes | string | Não | Observações |
| client_phone | string | Sim | Telefone (auditoria/confirmação) |
| client_name | string | Não | Nome do cliente (auditoria) |

**Regra de conflito (obrigatória):**
- Dois agendamentos não podem ocupar o mesmo barbeiro em intervalos que se sobreponham.
- Cálculo: `scheduled_time` + `duration_minutes` do serviço. Se qualquer agendamento existente (mesmo barbeiro, mesmo dia, status não cancelado) tiver sobreposição, retornar **409 Conflict** com mensagem clara (ex.: "Horário já ocupado para este barbeiro").
- Em caso de sucesso: **201 Created** e corpo com o agendamento criado (`id`, `scheduled_date`, `scheduled_time`, `status`, etc.).

---

## Autorização (n8n → API)

- Todas as requisições das tools devem incluir **uma API Key por estabelecimento** (header `X-API-Key` ou `Authorization: Bearer <key>`).
- A API associa a key a um `barbershop_id` (tabela `barbershop_api_keys`). O tenant é sempre inferido pela key; não envie `barbershop_id` no request.
- Não expor dados de outros estabelecimentos: cada key só acessa os dados da sua NavalhIA.

---

## Versionamento

- Prefixo de path opcional: `/api/v1/tools/...` para evolução futura.
- Contrato estável: novos campos opcionais permitidos; remoção ou mudança breaking deve ser versionada.
