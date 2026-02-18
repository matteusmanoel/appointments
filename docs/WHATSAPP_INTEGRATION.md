# Integração WhatsApp (Meta Cloud API)

## Visão geral

- **Entrada**: Meta envia eventos (mensagens) para um **webhook público** do seu backend.
- **Processamento**: O backend valida o webhook, extrai a mensagem, chama o n8n (agente) e obtém a resposta.
- **Saída**: O backend envia a resposta ao usuário via **Meta Cloud API** (endpoint de mensagens).

## Requisitos de infraestrutura

1. **URL pública com HTTPS**
   - O webhook do WhatsApp **exige HTTPS** e um domínio acessível pela internet.
   - Exemplos: `https://api.seudominio.com`, `https://barberflow.seudominio.com`.

2. **Opções de exposição**
   - **VPS/servidor**: domínio apontando para o IP, TLS com certificado (ex.: Let’s Encrypt via Caddy/Nginx).
   - **Túnel**: Cloudflare Tunnel ou similar, expondo o backend sem IP público no servidor.

3. **Porta**
   - O reverse proxy (Caddy/Nginx/Traefik) escuta em 443 e faz proxy para o container do backend (ex.: `http://api:3000`).

## Configuração no Meta (Developer / WhatsApp)

1. Crie um app em [developers.facebook.com](https://developers.facebook.com) e adicione o produto **WhatsApp**.
2. Em **WhatsApp > Configuration**, defina:
   - **Webhook URL**: `https://seu-dominio.com/api/webhooks/whatsapp`
   - **Verify Token**: um valor secreto que você define (ex.: string aleatória). O backend usa esse valor para responder ao GET de verificação do Meta.
3. Inscreva-se no webhook para o objeto **messages**.
4. Gere um **token de acesso** (temporário ou permanente) com permissão para enviar mensagens. Guarde em variável de ambiente (ex.: `WHATSAPP_ACCESS_TOKEN`).

## Fluxo técnico

1. **GET** `.../webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
   - O backend compara `hub.verify_token` com `WHATSAPP_VERIFY_TOKEN` e, se for igual, responde com `hub.challenge` (texto no body).

2. **POST** `.../webhooks/whatsapp`
   - Body: JSON do Meta com entradas de mensagem.
   - O backend lê o telefone do remetente e o texto, chama o n8n (trigger do agente de chat com essa mensagem) e recebe a resposta.
   - O backend envia a resposta via Meta Cloud API (POST para o endpoint de mensagens com o token).

3. **Envio de mensagem**
   - `POST https://graph.facebook.com/v18.0/<PHONE_NUMBER_ID>/messages` com headers `Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>` e body com `to`, `type: text`, `text: { body }`.

## Variáveis de ambiente (backend)

- `WHATSAPP_VERIFY_TOKEN`: token de verificação do webhook (igual ao configurado no Meta).
- `WHATSAPP_ACCESS_TOKEN`: token de acesso da Meta para enviar mensagens.
- `WHATSAPP_PHONE_NUMBER_ID`: ID do número de telefone WhatsApp Business (usado na URL de envio).
- `N8N_CHAT_TRIGGER_URL`: (opcional) URL para disparar o fluxo de chat do n8n com a mensagem recebida (ex.: webhook do n8n que inicia o agente). Se não definido, o backend pode apenas enfileirar ou responder com mensagem fixa para testes.

## Segurança

- Validar assinatura do webhook (Meta envia header `X-Hub-Signature-256`) quando disponível.
- Manter `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_VERIFY_TOKEN` em variáveis de ambiente, nunca no código.
