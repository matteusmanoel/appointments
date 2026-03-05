# WhatsApp — Integração oficial (UAZAPI)

O NavalhIA usa **UAZAPI** para conectar o número de WhatsApp: pareamento por **QR Code** ou **código de 8 dígitos**, sem necessidade de Meta Developer ou token de longo prazo. O backend e o worker usam o token da instância Uazapi para enviar e receber mensagens.

## Endpoints da API (autenticação JWT)

Base: `/api/integrations/whatsapp`. Requer header `Authorization: Bearer <token>` (login do usuário).

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/api/integrations/whatsapp` | Status da conexão (barbershop do usuário): `connected`, `whatsapp_phone`, `last_error`, `ai_paused_until`, etc. |
| GET | `/api/integrations/whatsapp/uazapi/connectivity` | Testa se a API alcança a Uazapi. Retorna `{ api: "ok", uazapi: { ok, error? } }`. |
| POST | `/api/integrations/whatsapp/uazapi/start` | Cria instância (se não existir), configura webhook e inicia conexão. Body opcional: `{ phone?: string }` para código de pareamento. Retorna `status`, `qr?`, `pairingCode?`, `webhook_warning?`. |
| POST | `/api/integrations/whatsapp/uazapi/link-existing` | Vincula uma instância Uazapi já existente ao barbershop (evita 429 ao recriar). Body: `{ instance_name, instance_id, token }`. |
| GET | `/api/integrations/whatsapp/uazapi/status` | Status atual + QR/pairing code. Retorna `status`, `connected`, `qr?`, `pairingCode?`. |
| POST | `/api/integrations/whatsapp/uazapi/disconnect` | Desconecta a instância (remove pareamento). |
| POST | `/api/integrations/whatsapp/uazapi/send-test` | Envia mensagem de teste. Body opcional: `{ number?: string, text?: string }`. |
| POST | `/api/integrations/whatsapp/assume` | Pausa a IA para atendimento manual (handoff). |
| POST | `/api/integrations/whatsapp/resume` | Retoma a IA após assumir manualmente. |

## Webhook (entrada de mensagens)

A Uazapi envia eventos para a URL configurada no servidor:

- **POST** `{UAZAPI_WEBHOOK_PUBLIC_URL}` — em produção normalmente `https://api.seudominio.com/api/webhooks/uazapi`.

O backend persiste o evento, resolve o `barbershop_id` pelo `instanceId`/instância e enfileira um job para o worker de IA processar e responder. Ver [UAZAPI_WEBHOOK_PAYLOADS.md](../UAZAPI_WEBHOOK_PAYLOADS.md) para o contrato dos payloads.

## Variáveis de ambiente (backend)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `UAZAPI_BASE_URL` | Sim (para WhatsApp) | Base da API Uazapi (ex.: `https://free.uazapi.com` ou subdomínio do plano). |
| `UAZAPI_ADMIN_TOKEN` | Sim | Token de administração Uazapi (criação de instâncias, etc.). |
| `UAZAPI_WEBHOOK_PUBLIC_URL` | Sim | URL pública que receberá os eventos (ex.: `https://api.seudominio.com/api/webhooks/uazapi`). HTTPS obrigatório. |
| `APP_ENCRYPTION_KEY` | Sim | Chave para criptografar/descriptografar o token da instância no banco (`uazapi_instance_token_encrypted`). |
| `UAZAPI_REQUIRE_WEBHOOK` | Não | Se `true`, falha ao conectar quando o webhook não for configurado com sucesso. |

## Fluxo resumido (usuário no painel)

1. Usuário clica em **Conectar WhatsApp** → front chama `POST .../uazapi/start`.
2. Backend cria/usa instância, configura webhook e retorna `qr` e/ou `pairingCode`.
3. Front exibe o QR; usuário escaneia no celular (WhatsApp → Aparelhos conectados).
4. Front faz polling em `GET .../uazapi/status` até `connected: true`.
5. Mensagens recebidas vão para o webhook → job enfileirado → worker processa com IA e envia resposta via client Uazapi.

Para tutorial de uso (passo a passo para usuário final), veja [../USUARIO/WHATSAPP_SETUP.md](../USUARIO/WHATSAPP_SETUP.md).
