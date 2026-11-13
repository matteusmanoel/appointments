# Runbook: segredo dos webhooks de WhatsApp (Evolution / Uazapi / Meta)

**Não execute nada disto sem o dono do projeto autorizar.** O script de reconfiguração é *dry-run por padrão* e só chama instâncias reais com `--apply` + `CONFIRM_RECONFIGURE=yes`.

## Variáveis

| Variável | Para quê | Onde |
|---|---|---|
| `WHATSAPP_WEBHOOK_SECRET` | segredo exigido nos webhooks `POST /api/webhooks/uazapi` e `/evolution` | Terraform: `whatsapp_webhook_secret` (sem valor, sensitive) |
| `WHATSAPP_WEBHOOK_SECRET_PREVIOUS` | segredo anterior, aceito **só durante a rotação** | Terraform: `whatsapp_webhook_secret_previous` (opcional, vazio por padrão) |
| `WHATSAPP_APP_SECRET` (+ `_PREVIOUS`) | App Secret da Meta: valida `X-Hub-Signature-256` no `POST /api/webhooks/whatsapp` | Terraform: `whatsapp_app_secret` (sem valor) |
| `WHATSAPP_VERIFY_TOKEN` | token do handshake `GET /api/webhooks/whatsapp` | Terraform: `whatsapp_verify_token` (sem valor) |
| `EVOLUTION_WEBHOOK_TOKEN_IN_URL` | `true` só se a Evolution em uso ignorar `headers` no webhook (então o segredo vai também em `?token=`) | env, padrão ausente |

Sem `WHATSAPP_WEBHOOK_SECRET` os webhooks respondem **503** (fail closed). **Não existe mais fallback para `EVOLUTION_API_KEY`**: a chave mestra da Evolution nunca é usada como segredo de webhook.

## Como o segredo viaja

- **Evolution**: cabeçalho `apikey: <WHATSAPP_WEBHOOK_SECRET>` configurado em `webhook.headers` ao registrar o webhook (a URL fica limpa, sem token). Webhook global do `docker-compose.evolution.yml` (dev) usa `?token=` porque não aceita cabeçalho.
- **Uazapi**: não envia cabeçalho próprio; o segredo vai em `?token=` na URL registrada.
- **Meta**: HMAC `X-Hub-Signature-256` sobre o corpo cru (também com corpo em base64 no API Gateway: o corpo é decodificado antes do cálculo).

## Antes de produção: o `terraform plan`/`apply` barra segredo vazio

`whatsapp_webhook_secret` tem uma `validation` que **falha o `plan`/`apply`** quando `lambda_zip_path` está definido (zip real) e o segredo está vazio ou tem menos de 16 caracteres. Isso evita publicar a Lambda e derrubar a entrada de mensagens (503 em todos os webhooks) por esquecer o `TF_VAR_whatsapp_webhook_secret`. Notas:
- `terraform validate` **não** executa a trava (ela precisa dos valores); quem a pega é o `plan`. O plan só com o placeholder (`lambda_zip_path` vazio) segue livre.
- `whatsapp_app_secret` e `whatsapp_verify_token` ficam opcionais (só valem para o provedor Meta; produção usa Uazapi).
- **Rode este runbook inteiro (segredo → publicar → reconfigurar instâncias) ANTES de apontar tráfego de produção**; não faça o `apply` com o segredo e deixe para reconfigurar depois.

### Janela de indisponibilidade esperada
Entre publicar a Lambda com o segredo e reconfigurar as instâncias existentes, os webhooks dessas instâncias recebem 401 (a URL antiga não traz o segredo). Para encurtar: (1) teste primeiro numa barbearia (3b); (2) se a Lambda de produção ainda não tem `EVOLUTION_API_KEY`/o código novo, o código antigo ignora o header e o `?token=` novos, então **rodar o script com `--apply` ANTES de publicar a Lambda nova elimina a janela** para a Evolution; para a Uazapi o `?token=` extra na URL é ignorado pelo código antigo, então o mesmo vale; (3) mensagens recebidas na janela não são reentregues pelo provedor: confira o histórico depois.
- O keepalive da Evolution compara só URL e eventos (não o header): após uma **rotação** o header registrado pode ficar velho com a URL igual, e a Lambda de produção nem executa o keepalive. Por isso a rotação exige o script (`--apply`), mesmo com o keepalive ligado.

## Primeira ativação (instâncias existentes ainda apontam para a URL antiga)

1. Gerar o segredo: `openssl rand -hex 32` (guardar no gerenciador de segredos; **não** no repositório).
2. Definir `whatsapp_webhook_secret` (e `whatsapp_app_secret`, `whatsapp_verify_token`) no ambiente do Terraform (`TF_VAR_...`) e publicar a Lambda. Enquanto as instâncias não forem reconfiguradas, os webhooks recusam as chamadas (401/503): **faça os passos 2 e 3 em seguida, numa janela curta**, ou use a rotação abaixo para não perder mensagens.
3. Reconfigurar as instâncias (dry-run primeiro):

```bash
cd backend
# 3a. simulação (não envia nada): lista instância, endpoint e corpo com o segredo mascarado
npx tsx scripts/reconfigure-whatsapp-webhooks.ts
# 3b. testar em UMA barbearia
CONFIRM_RECONFIGURE=yes npx tsx scripts/reconfigure-whatsapp-webhooks.ts --apply --barbershop <uuid>
# 3c. todas
CONFIRM_RECONFIGURE=yes npx tsx scripts/reconfigure-whatsapp-webhooks.ts --apply
```

O script só toca instâncias da NavalhIA (prefixo `navalhia-` ou legado `nh-`); `--include-foreign` desliga o filtro (não use em host compartilhado). O keepalive da Evolution repara a URL e os eventos do webhook (não o header; ver «Janela de indisponibilidade»).

## Rotação sem perda de mensagens

1. Novo segredo em `WHATSAPP_WEBHOOK_SECRET`; o antigo em `WHATSAPP_WEBHOOK_SECRET_PREVIOUS`. Publicar. A API aceita os dois.
2. Rodar o script (`--apply`) para registrar o novo em todas as instâncias.
3. Conferir nos logs que não chegam mais chamadas com o segredo antigo (401 apenas para segredos desconhecidos) e remover `WHATSAPP_WEBHOOK_SECRET_PREVIOUS`; publicar.

Para a Meta, o mesmo vale com `WHATSAPP_APP_SECRET_PREVIOUS` (o App Secret é trocado no painel da Meta; durante a troca ambas as assinaturas são aceitas).

## Reversão

Se algo falhar após a ativação: recolocar o segredo anterior em `WHATSAPP_WEBHOOK_SECRET` e publicar (as instâncias ainda registradas com ele voltam a funcionar). Não existe modo "sem segredo" por design.

## Ordem de merge dos PRs

`fix/webhook-auth` (#1) deve entrar **antes** de `fix/whatsapp-provider-config` (#7): o aviso de startup do #7 já considera `WHATSAPP_WEBHOOK_SECRET`, e as variáveis Terraform dos webhooks são definidas só no #1 (o #7 não as repete).
