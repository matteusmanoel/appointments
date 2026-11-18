# Backend NavalhIA

API Node/Express e agente WhatsApp. Schema em `../supabase/migrations/`. Postgres local de teste: `127.0.0.1:55432`.

## Simulador CLI do agente

Comando de terminal que conversa com o **mesmo** `runAgent` do WhatsApp, no Postgres **local**, sem WhatsApp, sem ngrok e sem custo AWS.

Não há página no painel. Nada é enviado a cliente: o simulador liga um provider WhatsApp **noop** (grava a tentativa em memória e não faz HTTP para Evolution/Uazapi). Lembretes automáticos também não entram na fila de envio enquanto o noop está ativo.

```bash
cd backend
npm run simulate:agent -- --tenant <slug-ou-uuid> --replay scripts/examples/cavalier-proximo-horario.json
npm run simulate:agent -- --tenant <slug-ou-uuid> --interactive --now 2026-11-14T18:08:00-03:00
```

Opções:

| Opção | Descrição |
| --- | --- |
| `--tenant`, `-t` | Slug ou UUID da barbearia |
| `--phone`, `-p` | Telefone **fictício** (padrão `5500000000001`). Nunca reutiliza conversa WhatsApp nem cliente existente: o simulador usa `channel=simulator` e um telefone interno namespaced |
| `--now` | Relógio simulado (`2026-11-14T18:08:00-03:00` ou `2026-11-14 18:08`). Sem fuso, assume `America/Sao_Paulo`. Se omitido, vale o `now` do arquivo de replay |
| `--replay`, `-r` | Arquivo JSON ou YAML com a conversa |
| `--interactive`, `-i` | Lê mensagens do cliente no terminal |
| `--llm none\|openai` | Padrão `none` (sem chamada de modelo). `openai` só se o turno cair no LLM |
| `--trace` | Grava um trace por turno no Postgres local. **Padrão: desligado.** |
| `--run-reminders` | Roda o job de lembrete 24h no relógio (`--now` ou `now` do arquivo), pelo provider **noop**. A mensagem entra na conversa `sim:…` para o cliente responder no turno seguinte. Não enfileira `scheduled_messages` e nada é enviado. Também dá para colocar o turno `{"role":"system","event":"reminders"}` no roteiro. |

### Roteiros de exemplo

Em `scripts/examples/` (validados por `src/__tests__/simulator-replay-examples.test.ts`). Sempre com `--llm none` e Postgres `127.0.0.1:55432`:

| Arquivo | O que cobre |
| --- | --- |
| `cavalier-proximo-horario.yaml` (e `.json`) | Agendar pedindo o próximo horário |
| `cliente-decidido.yaml` | Cliente já chega com serviço, dia e hora, e confirma |
| `cliente-indeciso.yaml` | «Quero agendar um corte amanhã» — o agente oferece 2 a 3 opções |
| `fora-do-horario.yaml` | Perto do fechamento; fala «Já estamos encerrando por hoje, mas podemos encontrar um horário pra você amanhã» (não troca «amanhã» pelo nome do dia) |
| `voce-e-robo.yaml` | «você é robô?» no meio do agendamento: desvia e segue o card, sem revelar IA |
| `lembrete-confirmo.yaml` | Turno `system`/`reminders` + «Confirmo». Exige um agendamento do cliente do simulador com lembrete 24h devido no `--now` |

```bash
npm run simulate:agent -- --tenant <slug-ou-uuid> --replay scripts/examples/cliente-decidido.yaml --llm none
npm run simulate:agent -- --tenant <slug-ou-uuid> --phone 5500000000001 --now 2026-11-16T18:00:00-03:00 --replay scripts/examples/lembrete-confirmo.yaml --llm none
```

Exemplo de replay (JSON):

```json
{
  "now": "2026-11-14T18:08:00-03:00",
  "turns": [
    { "role": "user", "text": "Quero agendar um corte pra hoje" },
    { "role": "user", "text": "Só o corte mesmo" },
    { "role": "user", "text": "Pode ser o próximo" }
  ]
}
```

Há um YAML equivalente em `scripts/examples/cavalier-proximo-horario.yaml`. Turnos com `"role": "assistant"` só entram no histórico, sem chamar o agente. O turno `{"role":"system","event":"reminders"}` dispara o job de lembrete no relógio simulado (mesmo código do job real, provider noop).

### Comparação none vs openai (`simulate:compare`)

Roda os 5 roteiros de `scripts/examples/` e os goldens **duas vezes** ( `--llm none` e `--llm openai` ), com `AI_AGENT_SLOT_INTERPRET=true` e `AI_AGENT_LANGUAGE_REWRITE=true` **somente neste processo**. Modelo padrão: `gpt-4o-mini` (`--model` só aceita modelos mini). A tabela de preços (USD por 1M de tokens) fica em `src/ai/simulator/compare-pricing.ts` e pode ser atualizada ali.

O comando **não lê `.env`**. Exporte `OPENAI_API_KEY` e `DATABASE_URL` (Postgres local `127.0.0.1:55432`) no terminal. A guarda de banco local continua valendo. `--max-runs` (padrão 1 por roteiro) e `--max-tokens` (padrão 300000) abortam se o teto de tokens for ultrapassado.

No Mac do Mateus:

```bash
cd backend
export DATABASE_URL='postgresql://USER:SENHA@127.0.0.1:55432/navalhia'
export OPENAI_API_KEY='sk-...'   # só no terminal; este comando não lê .env
npm run simulate:compare -- --tenant <slug-da-barbearia-local> --out /tmp/navalhia-simulate-compare.md --model gpt-4o-mini --max-runs 1 --max-tokens 300000
```

`--skip-examples` ou `--skip-goldens` e `--only <id>` restringem o lote. O relatório (terminal e Markdown) traz, por roteiro: resposta final de cada modo, passou/falhou nos contratos do golden, se a fala mudou, se o filtro `ai_exposure` ou o fallback agiram, latência, tokens de entrada e de saída, e o custo estimado.

Os testes de `simulate:compare` usam um cliente OpenAI **fake** — nenhuma chamada real.

### Trace no Postgres local


A migration `supabase/migrations/20261114210000_ai_simulator_turn_traces.sql` cria `public.ai_simulator_turn_traces`. Cada linha guarda: mensagem, intent, rascunho, tool calls (args e resultado), resposta final, o que o filtro `ai_exposure` alterou, latência e tokens.

A escrita é controlada pela flag **`AI_SIMULATOR_TRACE_ENABLED`** (`true`/`1`/`yes`). **Default: desligada.** A API, a produção e o CLI não ligam essa flag, a menos que você passe `--trace`. Telefones e dados de cliente são mascarados na gravação. Linhas com mais de 7 dias são apagadas na próxima escrita (`purgeExpiredSimulatorTurnTraces`).

O terminal imprime o mesmo conteúdo de forma legível (telefone mascarado, ex. `***0001`).

Conversas do simulador usam `channel = simulator`, `is_sandbox = true` e um telefone interno que não colide com cliente real. Não entram na contagem de uso, não tocam conversa/cliente existente, não enfileiram `scheduled_messages`, não disparam sync de foto, não consomem waitlist e não marcam cobrança PIX como enviada.

### Guarda de DATABASE_URL

O CLI e os testes recusam `DATABASE_URL` cujo host não seja local (`localhost`, `127.0.0.1`, `::1` ou socket Unix) **antes de qualquer conexão**, no espírito do LouFlow #66. A mensagem de erro não inclui a URL nem credenciais.

### Migration da tabela de trace

A criação `20261114210000_ai_simulator_turn_traces.sql` **não entra no `migrate:all`**, para não criar a tabela em produção. O follow-up `20261115120000_ai_simulator_turn_traces_harden.sql` permanece no `migrate:all` e é inofensivo: só roda se a tabela já existir, usa `lock_timeout`/`statement_timeout` curtos, remove FKs para tabelas quentes (`barbershops`, `ai_conversations`) e cria o índice de TTL. Testes e o CLI criam a tabela localmente, sem FKs.

## Trocar a instância Uazapi (`whatsapp:rotate`)

O servidor grátis da Uazapi cai depois de mais ou menos uma hora. O comando troca token e instância do tenant no Postgres **local**, com fetch injetável nos testes (nenhuma chamada real). A URL e o token vêm do prompt sem eco, ou de `UAZAPI_BASE_URL` e `UAZAPI_NEW_TOKEN`. Não vão na linha de comando. Não edita `.env` e não imprime o token.

`UAZAPI_BASE_URL` e `WHATSAPP_PROVIDER` são do processo: mudá-los exige reinício do container ou nova env na Lambda/Terraform. Token, nome e id da instância ficam em `barbershop_whatsapp_connections` e são relidos a cada mensagem, sem reinício. O token é gravado com `encrypt` / `APP_ENCRYPTION_KEY`.

```bash
npm run whatsapp:rotate -- --tenant <slug-ou-uuid> --webhook-url https://<publico>/api/webhooks/uazapi
npm run whatsapp:rotate -- --tenant <slug-ou-uuid> --dry-run
npm run whatsapp:rotate -- --remote
```

`--dry-run` não grava e não chama a Uazapi. `--remote` só imprime os passos da AWS e não pede token. Sem `--remote`, `DATABASE_URL` tem que ser local. O passo a passo (webhook `POST /webhook`, túnel nomeado da Cloudflare, como conferir `instance.status=connected`) está em `docs/qa/runbook-uazapi-instancia.md`. Esse runbook também registra a ordem de merge com o PR do contexto: `simulate:compare` e `whatsapp:rotate` ficam os dois no `package.json`. Os testes são `src/__tests__/whatsapp-rotate-uazapi.test.ts`.


## Preenchimento determinístico (fluxos básicos)

Nos fluxos de agendar, reagendar, cancelar e responder a um lembrete, o código decide serviço, barbeiro, data, horário, quais tools chamar e quando confirmar. Horário já nomeado, com barbeiro desconhecido ou sem preferência, entra no fluxo determinístico (`check_availability` e, se ocupado, 2–3 alternativas) — sem o loop de tools do modelo.

Quando as regras não extraem os slots, o LLM só interpreta a fala em slots estruturados (serviço, barbeiro, data, horário, intent), com schema validado. Isso fica atrás da flag **`AI_AGENT_SLOT_INTERPRET`** (`true`/`1`/`yes`), **default desligada**. O simulador liga essa interpretação só com `--llm openai`. Nos testes, use `--llm none` e um intérprete fake determinístico (`createFakeSlotInterpreter`).

A linguagem sai de uma fala-modelo. O LLM pode reescrever o template com tom simpático, mas a saída passa pelo filtro `ai_exposure` e por uma checagem de que os horários e serviços citados são os do template; se não passar, usa o template puro. Flag **`AI_AGENT_LANGUAGE_REWRITE`**, **default desligada** (template puro, sem custo extra).

Sem relógio nomeado, o turno não cai no loop de LLM: oferece 2–3 horários ou usa uma fala segura. Os goldens desses fluxos também rodam pelo simulador CLI (`src/__tests__/slot-filling-simulator.test.ts`).

Cancelar só acontece depois de um card explícito («Posso cancelar seu horário de …? Se preferir, posso remarcar.») e de um «sim» na fala seguinte — o mesmo vale para a tool do modelo. Com mais de um horário futuro, o agente pergunta qual. Um «sim» atrasado ou ambíguo não confirma, cria nem remarca: o card de confirmação e o de lembrete têm TTL, o alvo é o agendamento do card, e criar/remarcar exigem que o card seja a última fala do agente. O intérprete de slots tem timeout com fallback determinístico e registra o uso de tokens. A reescrita da fala-modelo rejeita o fallback seguro e exige que data, preço e barbeiro citados sejam os do template.

