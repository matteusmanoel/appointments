# WhatsApp — Evolution API (adapter por barbearia)

A NavalhIA fala com o WhatsApp via `getWhatsApp(barbershopId)`. Callers (worker IA, scheduled, stepper) não conhecem `instanceName` nem token.

## Provider no row

A flag vive em `barbershop_whatsapp_connections.provider` (`evolution` | `uazapi`). Lojas migram uma a uma.

- `WHATSAPP_PROVIDER` — default de **novas** conexões (`evolution` ou `uazapi`).
- Se `EVOLUTION_API_URL` estiver definido e `WHATSAPP_PROVIDER` vazio, o default é `evolution`.

Uazapi permanece até o cutover. Endpoints `/api/integrations/whatsapp/uazapi/*` continuam para lojas antigas. O stepper usa os genéricos:

| Método | Path |
|--------|------|
| POST | `/api/integrations/whatsapp/connect` |
| GET | `/api/integrations/whatsapp/status` |
| POST | `/api/integrations/whatsapp/disconnect` |
| GET | `/api/integrations/whatsapp/connectivity` |
| POST | `/api/integrations/whatsapp/send-test` |

`connect()` cria a instância e configura o webhook internamente.

## Infra local

Um único `.env` na raiz (veja `.env.example`). Compose interpola esse arquivo automaticamente.

```bash
cp .env.example .env   # se ainda não existir; preencha senhas e chaves
docker-compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.evolution.yml up -d --build
```

- Evolution escuta em `http://localhost:8081`
- Postgres/Redis **só da Evolution** (rede `navalhia-evolution-net`). A API NavalhIA usa o Postgres atual.
- Webhook interno: `http://api:3000/api/webhooks/evolution` (Evolution e API na mesma rede Compose).

Guia de teste com os números reais: [TESTE_AGENTE_WHATSAPP.md](./TESTE_AGENTE_WHATSAPP.md).

## Variáveis no backend (`.env`)

| Variável | Descrição |
|----------|-----------|
| `WHATSAPP_PROVIDER` | Default de novas conexões: `evolution` ou `uazapi` |
| `EVOLUTION_API_URL` | Base HTTP da Evolution no host (ex.: `http://localhost:8081`) |
| `EVOLUTION_API_KEY` | `AUTHENTICATION_API_KEY` da Evolution |
| `EVOLUTION_WEBHOOK_PUBLIC_URL` | URL de `POST /api/webhooks/evolution` alcançável **pela Evolution** |
| `EVOLUTION_POSTGRES_PASSWORD` / `EVOLUTION_REDIS_PASSWORD` | Senhas do stack isolado |

Workers `worker-ai` e `worker-scheduled` enviam via `getWhatsApp(barbershopId)`. No Compose, `EVOLUTION_API_URL` dos containers aponta para `http://navalhia-evolution-api:8080`.

## Contrato outbound (bot-pending)

1. INSERT `ai_messages` assistant com `provider_message_id = bot-pending-{uuid}`
2. `sendText`
3. UPDATE com o id real
4. Inbound `fromMe`: match por id → eco (não pausa); sem match → pausa (dono no celular)

Inbox lê `ai_messages` (não `findMessages` da Evolution na Fase 0).

## Multi-tenant

Um servidor Evolution, N instâncias (`evolution_instance_name`, uma por barbearia). Não copiar o modelo de instância única no env.
