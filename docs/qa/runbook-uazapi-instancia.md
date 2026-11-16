# Runbook — trocar a instância Uazapi

A Uazapi é o alvo de produção. No servidor grátis a instância cai depois de mais ou menos uma hora. Este runbook troca o tenant para uma instância nova sem chamar serviço nenhum daqui: os exemplos usam placeholders. Não crie conta, não cole token em issue, log ou `.env` versionado.

O comando é local. Ele pede a URL do servidor e o token no terminal, sem eco. `--token` e `--uazapi-url` existem só para teste e não aparecem no `--help`.

```bash
cd backend
export DATABASE_URL='postgres://USUARIO:SENHA@127.0.0.1:5432/navalhia'
export DATABASE_SSL=false
export APP_ENCRYPTION_KEY='<a mesma chave da API, 32 bytes ou 64 hex>'
npm run whatsapp:rotate -- --tenant <slug-ou-uuid> --webhook-url https://<publico>/api/webhooks/uazapi
```

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

O `<segredo NavalhIA>` é `WHATSAPP_WEBHOOK_SECRET`. Ele vai na query porque a Uazapi não manda cabeçalho próprio. O backend recebe em `POST /api/webhooks/uazapi`. O comando chama `setWebhook`, que tenta primeiro esse `POST /webhook` e, se a instalação responder 405, tenta os paths antigos com o mesmo body.

## Túnel até a URL pública

O webhook precisa de uma URL que a Uazapi alcance. Duas opções, sem criar conta nesta etapa:

| | Cloudflare quick tunnel | Cloudflare named tunnel | ngrok |
| --- | --- | --- | --- |
| Conta | Não | Conta grátis e um domínio | Conta |
| URL | Muda a cada execução (`*.trycloudflare.com`) | Fixa | Depende do plano |
| Quando a URL muda | Registrar o webhook de novo | Não muda | — |

Recomendação para o laboratório: **Cloudflare quick tunnel**, porque não pede conta.

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Copie o `https://….trycloudflare.com` que aparecer e passe em `--webhook-url`, com o caminho `/api/webhooks/uazapi`. Quando o processo do túnel morre, a URL morre junto: rode o comando de novo e registre o webhook outra vez. O named tunnel deixa a URL fixa, mas exige conta e domínio — não crie essa conta só para este runbook.

## Como conferir

1. `GET $UAZAPI_BASE_URL/instance/status` com o header `token` da instância. O corpo precisa ter `instance.status` igual a `connected`. O comando já faz essa chamada antes de gravar e imprime o status, sem o token.
2. Uma mensagem de teste no número da instância. O backend precisa receber `POST /api/webhooks/uazapi?token=<segredo>` e responder 200. Sem o token, ou com token errado, a resposta é 401.
3. A linha em `barbershop_whatsapp_connections` do tenant fica com `provider = uazapi`, `status = connected` e o token só na coluna criptografada.

Nada disso envia mensagem para cliente. Não use o token numa linha de comando que fique no histórico do shell: o modo normal pede no terminal sem eco.
