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
| `--phone`, `-p` | Telefone **fictício** (padrão `5500000000001`) |
| `--now` | Relógio simulado (`2026-11-14T18:08:00-03:00` ou `2026-11-14 18:08`, fuso `America/Sao_Paulo`) |
| `--replay`, `-r` | Arquivo JSON ou YAML com a conversa |
| `--interactive`, `-i` | Lê mensagens do cliente no terminal |
| `--llm none\|openai` | Padrão `none` (sem chamada de modelo). `openai` só se o turno cair no LLM |
| `--trace` / `--no-trace` | Grava um trace por turno no Postgres local |

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

A escrita é controlada pela flag **`AI_SIMULATOR_TRACE_ENABLED`** (`true`/`1`/`yes`). **Default: desligada.** A API e a produção não devem ligar essa flag. O CLI liga só no próprio processo, a menos que você passe `--no-trace`.

O terminal imprime o mesmo conteúdo de forma legível (telefone mascarado, ex. `***0001`).

Conversas do simulador usam `is_sandbox = true` e não criam jobs de envio.


## Preenchimento determinístico (fluxos básicos)

Nos fluxos de agendar, reagendar, cancelar e responder a um lembrete, o código decide serviço, barbeiro, data, horário, quais tools chamar e quando confirmar. Sem relógio nomeado, o turno não cai no loop de LLM: oferece 2–3 horários ou usa uma fala segura. Os goldens desses fluxos também rodam pelo simulador CLI (`src/__tests__/slot-filling-simulator.test.ts`).
