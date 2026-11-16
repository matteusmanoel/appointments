# Runbook — trocar a instância Uazapi

A Uazapi é o alvo de produção. No servidor grátis a instância cai depois de mais ou menos uma hora. Este runbook troca o tenant para uma instância nova sem chamar serviço nenhum daqui: os exemplos usam placeholders. Não crie conta, não cole token em issue, log ou `.env` versionado.

O comando é local. A URL do servidor e o token da instância vêm do prompt sem eco, ou das variáveis `UAZAPI_BASE_URL` e `UAZAPI_NEW_TOKEN`. Não existem flags para esses valores: se alguém passar `--token` ou `--uazapi-url`, o comando sai com erro e não usa o que foi escrito na linha.

```bash
cd backend
export DATABASE_URL='postgres://USUARIO:SENHA@127.0.0.1:5432/navalhia'
export DATABASE_SSL=false
export APP_ENCRYPTION_KEY='<a mesma chave da API, 32 bytes ou 64 hex>'
export UAZAPI_BASE_URL='https://<servidor-uazapi>'
export UAZAPI_NEW_TOKEN='<token da instância nova>'
npm run whatsapp:rotate -- --tenant <slug-ou-uuid> --webhook-url https://<publico>/api/webhooks/uazapi
```

Sem essas duas variáveis, o comando pede os valores no terminal e não os ecoa. `--allow-http` só existe para o laboratório: libera HTTP em localhost e host privado na URL da Uazapi. O `--webhook-url` continua https e público. O endereço de metadata (`169.254.169.254` e `metadata.google.internal`) continua recusado.

`--dry-run` não grava e não chama a Uazapi. `--remote` só imprime os passos da AWS e não escreve em banco remoto. Sem `--remote`, a `DATABASE_URL` tem que ser `localhost`, `127.0.0.1` ou `::1`.

## O que muda no ambiente e o que muda no tenant

| O quê | Onde | Precisa reiniciar? |
| --- | --- | --- |
| `UAZAPI_BASE_URL` | Ambiente do processo. No Terraform, `uazapi_base_url`. No Docker, a env do container | Sim. O processo lê na subida. No Docker, reinicie o container. Na Lambda, mude a env e publique de novo |
| `WHATSAPP_PROVIDER` | Ambiente do processo (`uazapi` para conexão nova). No Terraform, `whatsapp_provider` | Sim, pelo mesmo motivo. A conexão que já existe usa a coluna `provider` do banco |
| Token da instância | `barbershop_whatsapp_connections.uazapi_instance_token_encrypted` | Não. `getWhatsApp` relê a conexão a cada mensagem |
| Nome e id da instância | `uazapi_instance_name`, `uazapi_instance_id` | Não. Também são relidos do banco |

O comando não edita `.env`. Se a URL digitada for diferente de `UAZAPI_BASE_URL`, ele avisa os nomes que ainda precisam mudar no ambiente. O token é gravado com `encrypt` e `APP_ENCRYPTION_KEY`. A chave tem que ser a mesma da API. O valor não é impresso.

## Webhook da instância nova

A Uazapi recebe:

```http
POST $UAZAPI_BASE_URL/webhook
token: <token da instância>
Content-Type: application/json
```

```json
{
  "enabled": true,
  "url": "https://<publico>/api/webhooks/uazapi?token=<segredo NavalhIA>",
  "events": ["messages", "messages_update", "connection"],
  "excludeMessages": ["wasSentByApi"]
}
```

O `<segredo NavalhIA>` é `WHATSAPP_WEBHOOK_SECRET`. O backend recebe em `POST /api/webhooks/uazapi` e já aceita o segredo no cabeçalho `apikey`, `x-api-key` ou `x-webhook-secret`, ou na query `?token=`.

A entrega da Uazapi não tem onde registrar esse cabeçalho. A documentação do `POST /webhook` (conferida em 16/11/2026) aceita `enabled`, `url`, `events`, `excludeMessages`, `addUrlEvents`, `addUrlTypesMessages` e, no modo de vários destinos, `action` e `id`. O header `token` autentica a chamada até a Uazapi; não é um cabeçalho que ela reenvia. A Evolution, no contrário, grava o segredo em `webhook.headers.apikey` e a URL fica limpa. Enquanto a Uazapi não ganhar um campo de cabeçalho, o segredo continua na query. Se passar a ter, o registro deve usar o cabeçalho e deixar a query só como fallback.

O risco é o segredo aparecer em log de proxy, de túnel e do painel da Uazapi. Mitigações:

- Segredo longo, só dele, e rotacionável: `WHATSAPP_WEBHOOK_SECRET` e, na troca, `WHATSAPP_WEBHOOK_SECRET_PREVIOUS`. O passo a passo está em `docs/RUNBOOK_WEBHOOK_SECRET.md`.
- O handler de `POST /api/webhooks/uazapi` não loga `req.url` nem a query. A linha de skip registra content-type, tamanho do corpo, chaves do JSON, evento, instância e telefone. A recusa sem segredo não imprime o valor.
- Não há logger de request (morgan/pino) que grave a URL. `redactWebhookSecrets` mascara `?token=` e o valor conhecido do segredo, inclusive percent-encoded. O teste `redactWebhookSecrets remove token= e o valor do segredo` cobre isso.
- O túnel recomendado é o nomeado, com URL fixa nossa. O quick tunnel é temporário e o log dele também pode guardar a query.

O comando chama `setWebhook`, que tenta primeiro esse `POST /webhook` e, se a instalação responder 405, tenta os paths antigos com o mesmo body. A mensagem de erro traz só o status HTTP, ou a URL pública sem query no caso do 405. Não traz o token, o corpo nem os headers.

## Túnel até a URL pública

O webhook precisa de uma URL https que a Uazapi alcance. O padrão é o **named tunnel da Cloudflare**, com hostname fixo. Não crie a conta só para ler este runbook: use a que o laboratório já tiver.

```bash
cloudflared tunnel login
cloudflared tunnel create navalhia-lab
cloudflared tunnel route dns navalhia-lab webhook.exemplo.com
```

O `config.yml` do túnel aponta o hostname para a API local:

```yaml
ingress:
  - hostname: webhook.exemplo.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

```bash
cloudflared tunnel run navalhia-lab
```

Passe `https://webhook.exemplo.com/api/webhooks/uazapi` em `--webhook-url`. A URL não muda quando o processo reinicia.

O quick tunnel fica só como opção temporária. Ele publica a API local inteira na internet, a URL `*.trycloudflare.com` muda a cada execução e o webhook precisa ser registrado de novo. Não cole token nem segredo no histórico do shell.

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

O ngrok também pede conta e a URL depende do plano. Não é o caminho recomendado.

## Ordem de merge com o PR do contexto

O PR do contexto (`simulate:compare`) e este (`whatsapp:rotate`) editam o bloco de scripts do `backend/package.json`. Entre o contexto primeiro. Este branch já deixa os dois scripts, para o resultado depois do merge:

- `simulate:compare` — o arquivo `src/scripts/agent-simulator-compare.ts` entra com o PR do contexto. Neste branch o script está declarado e o arquivo ainda não.
- `whatsapp:rotate` — este comando.

Se o `package.json` conflitar, fique com as duas linhas. Não junte os branches antes disso.

## Como conferir

1. `GET $UAZAPI_BASE_URL/instance/status` com o header `token` da instância. O corpo precisa ter `instance.status` igual a `connected`. O comando já faz essa chamada antes de gravar e imprime o status, sem o token.
2. Uma mensagem de teste no número da instância. O backend precisa receber `POST /api/webhooks/uazapi?token=<segredo>` e responder 200. Sem o token, ou com token errado, a resposta é 401.
3. A linha em `barbershop_whatsapp_connections` do tenant fica com `provider = uazapi`, `status = connected` e o token só na coluna criptografada.

Nada disso envia mensagem para cliente. Não use o token numa linha de comando que fique no histórico do shell: ou o prompt sem eco, ou `UAZAPI_NEW_TOKEN` no ambiente da sessão.
