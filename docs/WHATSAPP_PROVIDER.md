# Provedor de WhatsApp: mudança de padrão (uazapi → evolution) e configuração

## O que mudou
- **Antes**: sem `WHATSAPP_PROVIDER`, o código usava `uazapi`; o Terraform fixava `WHATSAPP_PROVIDER="uazapi"` com `EVOLUTION_API_URL` vazio.
- **Agora**: no código o padrão (sem `WHATSAPP_PROVIDER`) é **`evolution`** (decisão mantida, com aviso no startup), mas **no Terraform a escolha é explícita e obrigatória**: a variável `whatsapp_provider` **não tem mais padrão** e o `plan`/`apply` com zip real (`lambda_zip_path`) falha se ela estiver vazia (valores: `evolution` ou `uazapi`). Antes o Terraform fixava `uazapi`; um padrão silencioso trocaria o provedor de produção.
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

## Travas no Terraform (avaliadas no `plan`/`apply`, não no `validate`)
Com `lambda_zip_path` definido (zip real): `whatsapp_provider` vazio → erro; `whatsapp_provider = evolution` exige `evolution_api_url` (http/https) e `evolution_api_key`. O plan só com o placeholder (sem zip) segue livre. As mensagens de erro não imprimem valores.

## Uazapi: por que o segredo do webhook segue em `?token=` (e não em cabeçalho)
Verificado em 13/11/2026 na documentação da Uazapi (`POST /webhook`): os campos aceitos são `enabled`, `url`, `events`, `excludeMessages`, `addUrlEvents`, `addUrlTypesMessages` (e `action`/`id` para múltiplos destinos). **Não há campo para cabeçalhos customizados** na entrega do webhook, então não dá para registrar um cabeçalho com o segredo. Mitigações em vigor: HTTPS; o API Gateway do Terraform **não** tem access log configurado (a query não é gravada) e o backend não loga `req.url`; o segredo é um `WHATSAPP_WEBHOOK_SECRET` dedicado (nunca o token da instância nem o `admintoken`), rotacionável com `WHATSAPP_WEBHOOK_SECRET_PREVIOUS` e o script de reconfiguração (`docs/RUNBOOK_WEBHOOK_SECRET.md`). Endurecimento futuro possível, **não feito**: o envelope do webhook da Uazapi traz o `token` da instância no corpo; validá-lo contra o token gravado (criptografado) da barbearia daria uma segunda checagem sem depender da URL. Reavalie se a Uazapi passar a aceitar cabeçalhos.

## Checklist para quem faz o deploy
- [ ] Definir `TF_VAR_whatsapp_provider` (`evolution` ou `uazapi`) conforme o que produção usa hoje (antes deste tema o Terraform fixava `uazapi`; agora não há padrão e o `plan` falha sem ele).
- [ ] Se `evolution`: `evolution_api_url`, `evolution_api_key` (host externo; o `plan` exige), `EVOLUTION_WEBHOOK_PUBLIC_URL` ou `APP_URL`.
- [ ] Conferir no log de startup que não há linhas `[startup] whatsapp...`.
