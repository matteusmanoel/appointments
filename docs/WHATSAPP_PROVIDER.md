# Provedor de WhatsApp: mudança de padrão (uazapi → evolution) e configuração

## O que mudou
- **Antes**: sem `WHATSAPP_PROVIDER`, o código usava `uazapi`; o Terraform fixava `WHATSAPP_PROVIDER="uazapi"` com `EVOLUTION_API_URL` vazio.
- **Agora**: o padrão é **`evolution`** (decisão mantida), mas a escolha é **explícita**: variável Terraform `whatsapp_provider` → env `WHATSAPP_PROVIDER`; `.env.example` traz o valor.
- Conexões **já existentes** mantêm o provedor gravado no banco (`barbershop_whatsapp_connections.provider`); o padrão só afeta conexões **novas** e o provedor global de fallback.

## Aviso no startup (API e Lambda)
Ao subir, `startupWhatsappWarnings()` registra em log (`console.warn`, prefixo `[startup] whatsapp`):
1. **Padrão alterado** quando `WHATSAPP_PROVIDER` não está definido (ou é inválido): "usando o padrão evolution... o padrão anterior era uazapi. Se esta instalação usa Uazapi, defina WHATSAPP_PROVIDER=uazapi".
2. Configuração incompleta do provedor escolhido (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, URL pública do webhook; ou `UAZAPI_BASE_URL`/`UAZAPI_ADMIN_TOKEN`). `EVOLUTION_API_KEY` só autentica a chamada à API da Evolution; **não** é segredo de webhook.
3. `WHATSAPP_WEBHOOK_SECRET` vazio e, se a Meta Cloud API está em uso, `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` vazios.

## Dependência de ordem de merge
Este PR (#7, `fix/whatsapp-provider-config`) deve entrar **depois** de `fix/webhook-auth` (#1). As variáveis de segredo de webhook (`whatsapp_webhook_secret`, `whatsapp_app_secret`, `whatsapp_verify_token`, `_previous`) são declaradas no Terraform **só no #1**; este PR não as repete. Sem o #1, o aviso do item 3 é informativo (os webhooks ainda não exigem segredo). Com o #1, sem o segredo os webhooks respondem 503. Ver `docs/RUNBOOK_WEBHOOK_SECRET.md` (vem no #1).

## Segurança do webhook da Evolution
O segredo do webhook é o `WHATSAPP_WEBHOOK_SECRET` dedicado, enviado no cabeçalho `apikey` configurado em `webhook.headers` (a URL não leva token). A chave mestra `EVOLUTION_API_KEY` não é usada como segredo de webhook.

## Checklist para quem faz o deploy
- [ ] Definir `TF_VAR_whatsapp_provider` (`evolution` ou `uazapi`) conforme o que produção usa hoje (antes deste PR o Terraform fixava `uazapi`; o default da variável agora é `evolution`).
- [ ] Se `evolution`: `evolution_api_url`, `evolution_api_key` (host externo), `EVOLUTION_WEBHOOK_PUBLIC_URL` ou `APP_URL`.
- [ ] Conferir no log de startup que não há linhas `[startup] whatsapp...`.
