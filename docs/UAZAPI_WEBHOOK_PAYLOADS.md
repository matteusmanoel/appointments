# Uazapi — Webhook: contrato e payloads (discovery)

Este documento registra o contrato assumido para integração com a Uazapi (set webhook + eventos inbound). **Ao testar em dev, capture exemplos reais e atualize os exemplos abaixo.**

## Configurar webhook da instância

- **Método:** **PUT** (POST retorna 405 Method Not Allowed).
- **Path:** `/webhook/set`.
- **Autenticação:** header `token` com o token **da instância** (não admintoken).
- **Body:**
  ```json
  { "url": "https://api.seudominio.com/api/webhooks/uazapi" }
  ```
  URL sem barra final.

**Ação:** Ao implementar, chamar o endpoint indicado na documentação interativa (docs.uazapi.com) para o item "Configurar Webhook da Instância" e ajustar path/body neste doc e no código.

---

## Payload inbound (mensagem recebida)

APIs WhatsApp (incl. waapi/eazeWA, Z-API, Evolution) costumam enviar algo no formato:

```json
{
  "event": "message",
  "instanceId": "33",
  "instance": "nome-instancia",
  "data": {
    "message": {
      "id": "3EB0538DA65A59F6D8A251",
      "from": "5511999999999@c.us",
      "timestamp": 1234567890,
      "type": "chat",
      "body": "Texto da mensagem"
    }
  }
}
```

### Mapeamento mínimo para o backend

| Campo nosso   | Origem no payload (ajustar após captura real) |
|---------------|-------------------------------------------------|
| `from_phone`  | `data.message.from` (remover sufixo `@c.us` / `@s.whatsapp.net`) |
| `text`        | `data.message.body` (mensagem tipo `chat`)      |
| `message_id`  | `data.message.id`                               |
| `timestamp`   | `data.message.timestamp` (segundos)            |
| `event`       | `event` (ex.: `message`, `message_create`)     |
| Identificador da instância | `instanceId` ou `instance` ou no header — **usar para resolver `barbershop_id`** (lookup na tabela `barbershop_whatsapp_connections` por token/instance_name). |

### Eventos a tratar no MVP

- `message` ou `message_create`: mensagem recebida. Se `data.message.type === 'chat'`, extrair `body` como texto.
- Outros eventos: responder 200 e ignorar (ou logar para análise posterior).

### Idempotência

- Se o provedor enviar `message.id` ou um `event_id`, persistir em `whatsapp_inbound_events` com unique `(provider, provider_event_id)` para ignorar duplicados.

---

## Resposta do nosso endpoint

- **Status:** 200 (ou 2xx) o mais rápido possível, após persistir/enfileirar se aplicável.
- Não bloquear a resposta até terminar de processar a mensagem (processar em background ou de forma assíncrona após responder 200).

---

## Checklist pós-teste em dev

- [ ] Capturar um POST real do webhook (mensagem de texto) e colar o JSON neste doc (mascarando PII).
- [ ] Confirmar path e body do "Configurar Webhook da Instância" no docs.uazapi.com.
- [ ] Ajustar parser em `backend/src/routes/webhooks.ts` conforme os campos reais.
