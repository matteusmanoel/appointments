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

Há um YAML equivalente em `scripts/examples/cavalier-proximo-horario.yaml`. Turnos com `"role": "assistant"` só entram no histórico, sem chamar o agente.

### Trace no Postgres local

A migration `supabase/migrations/20261114210000_ai_simulator_turn_traces.sql` cria `public.ai_simulator_turn_traces`. Cada linha guarda: mensagem, intent, rascunho, tool calls (args e resultado), resposta final, o que o filtro `ai_exposure` alterou, latência e tokens.

A escrita é controlada pela flag **`AI_SIMULATOR_TRACE_ENABLED`** (`true`/`1`/`yes`). **Default: desligada.** A API, a produção e o CLI não ligam essa flag, a menos que você passe `--trace`. Telefones e dados de cliente são mascarados na gravação. Linhas com mais de 7 dias são apagadas na próxima escrita (`purgeExpiredSimulatorTurnTraces`).

O terminal imprime o mesmo conteúdo de forma legível (telefone mascarado, ex. `***0001`).

Conversas do simulador usam `channel = simulator`, `is_sandbox = true` e um telefone interno que não colide com cliente real. Não entram na contagem de uso, não tocam conversa/cliente existente, não enfileiram `scheduled_messages`, não disparam sync de foto, não consomem waitlist e não marcam cobrança PIX como enviada.

### Guarda de DATABASE_URL

O CLI e os testes recusam `DATABASE_URL` cujo host não seja local (`localhost`, `127.0.0.1`, `::1` ou socket Unix) **antes de qualquer conexão**, no espírito do LouFlow #66. A mensagem de erro não inclui a URL nem credenciais.

### Migration da tabela de trace

A criação `20261114210000_ai_simulator_turn_traces.sql` **não entra no `migrate:all`**, para não criar a tabela em produção. O follow-up `20261115120000_ai_simulator_turn_traces_harden.sql` permanece no `migrate:all` e é inofensivo: só roda se a tabela já existir, usa `lock_timeout`/`statement_timeout` curtos, remove FKs para tabelas quentes (`barbershops`, `ai_conversations`) e cria o índice de TTL. Testes e o CLI criam a tabela localmente, sem FKs.


## Preenchimento determinístico (fluxos básicos)

Nos fluxos de agendar, reagendar, cancelar e responder a um lembrete, o código decide serviço, barbeiro, data, horário, quais tools chamar e quando confirmar. Horário já nomeado, com barbeiro desconhecido ou sem preferência, entra no fluxo determinístico (`check_availability` e, se ocupado, 2–3 alternativas) — sem o loop de tools do modelo.

Quando as regras não extraem os slots, o LLM só interpreta a fala em slots estruturados (serviço, barbeiro, data, horário, intent), com schema validado. Isso fica atrás da flag **`AI_AGENT_SLOT_INTERPRET`** (`true`/`1`/`yes`), **default desligada**. O simulador liga essa interpretação só com `--llm openai`. Nos testes, use `--llm none` e um intérprete fake determinístico (`createFakeSlotInterpreter`).

A linguagem sai de uma fala-modelo. O LLM pode reescrever o template com tom simpático, mas a saída passa pelo filtro `ai_exposure` e por uma checagem de que os horários e serviços citados são os do template; se não passar, usa o template puro. Flag **`AI_AGENT_LANGUAGE_REWRITE`**, **default desligada** (template puro, sem custo extra).

Sem relógio nomeado, o turno não cai no loop de LLM: oferece 2–3 horários ou usa uma fala segura. Os goldens desses fluxos também rodam pelo simulador CLI (`src/__tests__/slot-filling-simulator.test.ts`).
