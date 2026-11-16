# Relatório — contexto do cliente no agente WhatsApp

Base de `develop` conferida: `d117e7b76f222c0f5ade24b3aa8c4e0ee79cc4c9` (igual a `main`). Este trabalho parte do simulador já coberto em `e89e2cc` (`feat/agente-simulador-cobertura`) e segue na branch `cursor/agente-contexto-multiturno-7086`.

Postgres usado aqui: local em `127.0.0.1`. A guarda do simulador e dos testes só aceita `localhost`, `127.0.0.1` ou `::1`. Nenhuma chamada real a LLM, Uazapi, Evolution ou Stripe.

## Onde o contexto vive

| Peça | Onde | O que guarda |
| --- | --- | --- |
| Rascunho e card | `ai_conversation_runtime.booking_draft` | Serviço, horário, barbeiro e card pendente da conversa atual |
| Intenções pendentes | `ai_conversation_runtime.pending_intents` | Fila da conversa atual |
| Memória de costume | `client_ai_memory` | Serviço, barbeiro e faixa de horário aprendidos |
| Histórico | `appointments` com status `completed` | O «de sempre» quando a contagem na janela de 6 meses ganha da memória |
| Sessão entre conversas | `client_ai_memory.session_context` (novo) | Rascunho, card, intenções pendentes e última intenção, por cliente e barbearia |

O rascunho da conversa se perdia quando o simulador abria outra thread (`sim:{telefone}:cN`). A conversa nova hidrata `session_context` só quando o próprio `booking_draft` ainda é nulo. Rascunho e intenções pendentes valem 24 h a partir do `updatedAt`. O card guarda o TTL de 30 min. Slot que já passou não volta como card. Card ainda vivo, numa conversa nova, vira contexto: o «sim» não executa e o agente reapresenta o card. A última intenção continua valendo quando o turno novo não é um «sim».

## Casos

Suíte: `backend/src/__tests__/agent-context-conversations.test.ts`. Cada caso olha a resposta, as tools e o que ficou no banco (agendamento e memória/`session_context`).

| # | Caso | Resultado |
| --- | --- | --- |
| 1 | Cliente novo agenda em vários turnos. Dias depois o agente sugere o serviço de costume e o barbeiro preferido | passou |
| 2 | Outra conversa, «quero mudar meu horário», remarca o mesmo agendamento, sem criar outro | passou |
| 3 | Lembrete na véspera, «confirmo». Nova conversa: «preciso cancelar» gera o card, «sim» cancela. A conversa seguinte não vê mais o cancelado | passou |
| 4 | Depois do lembrete, «dá pra mudar?» oferece 2 a 3 horários; a escolha e o «sim» remarcam o mesmo. O banco fica com o horário novo | passou |
| 5 | Dois horários futuros: cancela o das 15h e, na conversa seguinte, remarca o das 11h | passou |
| 6 | Várias visitas concluídas mudam o serviço de costume (3 barbas e 1 corte → sugere Barba) | passou |
| 7 | «sim» 40 min depois, em conversa nova, não executa o card: ele expirou | passou |
| 7b | «sim» 10 min depois, em conversa nova, reapresenta o card e só o «sim» seguinte marca | passou |
| 7c | Slot das 15h ocupado por outro cliente: a conversa nova não revive o card nesse horário | passou |
| 8 | Dois clientes no mesmo tenant, e o mesmo telefone em outro tenant, sem vazamento | passou |
| 9 | Fora do horário: «Já estamos encerrando por hoje, mas podemos encontrar um horário pra você amanhã», sem trocar «amanhã» pelo nome do dia | passou |
| 10 | «você é robô?» no meio do fluxo: «Estou aqui pra te ajudar com o horário» e o fluxo segue | passou |
| 11 | «consegue trocar esse horário para as 17h?» também remarca o mesmo (gêmeo semântico do caso 2) | passou |
| 12 | Rascunho continua no turno seguinte da mesma conversa | passou |

Golden novo `recurring_client_suggests_usual_without_clock` («Quero agendar», sem relógio) também passou, junto com `reschedule_named_hour_free` («Quer que eu mude para», sem «Posso confirmar?»).

## O que foi corrigido

| Arquivo | Motivo |
| --- | --- |
| `supabase/migrations/20261116170000_client_session_context.sql` | Coluna `session_context`, idempotente, com `lock_timeout` 2s e `statement_timeout` 5s. O boot não dá `ALTER` nessa tabela |
| `backend/src/ai/agent/client-session-context.ts` | Grava e hidrata rascunho, card e intenções. O telefone usa `brPhoneMatchKeys`, com `ORDER BY` canônico, comprimento e id. Isolado por `client_id` + `barbershop_id` |
| `backend/src/ai/agent/context-builder.ts` | A conversa nova puxa a sessão do cliente. Favoritos usam a data simulada, não o `CURRENT_DATE` do servidor |
| `backend/src/ai/agent.ts` | Antes de aplicar o turno, esvazia rascunho já fechado (o pedido novo não era descartado). Caminhos rápidos de criar/remarcar aguardam a memória, com a hora do agendamento (a faixa vinha da data e ficava errada). Horário nomeado livre numa remarcação usa `composeRescheduleAsk` («Quer que eu mude para…»). O «sim» chama `reschedule_appointment` no mesmo id. Oferta com barbeiro conhecido cita o primeiro nome. Se o dia pedido tem menos de 2 horários, a busca segue até achar um dia com 2 ou 3; «amanhã» só entra quando o dia pedido é hoje e não tinha nenhum horário |
| `backend/src/ai/agent/orchestrator.ts` | «Quero agendar» sem relógio, com serviço de costume, pergunta o de sempre em vez de cair em corte ou combo |
| `backend/src/ai/booking-draft.ts` | A sugestão do de sempre inclui o barbeiro quando a confiança é ≥ 0,5 |
| `backend/src/ai/memory/client-memory.ts` | A faixa de horário sai de `HH:mm`, não da data |
| `backend/src/ai/tools.ts` | `getClientFavoriteServices` aceita a data de referência |
| `backend/src/ai/simulator/session.ts` e `replay-file.ts` | Evento `new_conversation` e `now` por turno, para o cliente voltar horas ou dias depois |
| `backend/src/ai/simulator/openai-stub.ts` | O stub de embeddings devolve vetor zerado. O chat continua recusando chamada real |
| `supabase/migrations/20261115120000_ai_simulator_turn_traces_harden.sql` | Voltou ao texto já mergeado em `develop`. Mudança nessa migration não entra neste PR |
| `backend/src/__tests__/whatsapp-ai-routes.test.ts` | Sem `OPENAI_API_KEY`, `/ai-simulate` tem que responder 503 `OpenAI not configured`. Com a chave, continua exigindo 200. Não foi escondido nem transformado em sucesso falso |
| `backend/src/ai/simulator/compare.ts` e `agent-simulator-compare.ts` | `--max-tokens` e `--max-runs` inválidos saem com código 1. O teto é checado antes de cada chamada de chat e de embedding; a chamada seguinte não sai se a última já não cabe. Embeddings entram na soma e no custo |
| `backend/src/ai/simulator/golden/` | Os cenários e o runner saíram de `__tests__`. O compare não importa mais teste |
| `backend/src/routes/clients.ts` e `client-memory.ts` | As respostas de memória listam as colunas. `session_context` não volta na API |

## Revisão do PR

Os quatro pontos da revisão de backend, sem merge:

1. O lookup do cliente usa `brPhoneMatchKeys`. Um WhatsApp de 11 dígitos casa com o cadastro de 11 e com o de 10 do mesmo DDD. A chave de 10 dígitos não casa com outro DDD no mesmo tenant. O `ORDER BY` prefere o telefone canônico, depois o mais longo, depois o id.
2. Rascunho e `pendingIntents` expiram em 24 h. O card segue com 30 min. Slot passado ou ocupado não volta como card vivo. Na conversa nova, o card dentro do TTL é reapresentado; o «sim» direto não marca. `lastIntent` segue em uso quando o turno não é afirmação.
3. `ensure-schema.ts` não altera `client_ai_memory` no boot. A migration `20261116170000` é idempotente e usa `lock_timeout='2s'` e `statement_timeout='5s'`. A migration `20261115120000`, já mergeada, voltou ao texto de `develop`.
4. Valores inválidos de `--max-tokens` e `--max-runs` falham com mensagem clara e código diferente de zero. O teto vale para chat e embeddings, antes da chamada, e os embeddings entram no custo.

## O que ficou de fora

- Criar um segundo agendamento pela fala enquanto já existe um futuro continua sendo remarcação. Esse contrato já estava em `confirmation-guards`. O caso 5 grava a segunda visita no banco e o agente cancela uma e remarca a outra.
- «dá pra mudar?» não casa com a heurística determinística de reagendar (falta «horário» perto de «mudar»). O teste classifica isso no intérprete fake. Não entrou heurística de frase no agente.
- `SUPPORT_NUMBER`, `seed-production`, `infra/` e Terraform não foram alterados.
- A rotação Uazapi fica num PR separado. Lá estão o runbook, os testes com fetch fake e o `npm run whatsapp:rotate`.

## Ambiente

`POST /api/integrations/whatsapp/ai-simulate` sem `OPENAI_API_KEY` responde 503. O teste marca isso como ambiente e confere o corpo. Com a chave, o mesmo teste exige 200, resposta e `violations`.

## Comandos para reproduzir no Mac

Postgres local (porta do seu Docker ou do Postgres instalado). A URL precisa ser `localhost`, `127.0.0.1` ou `::1`.

```bash
cd backend
export DATABASE_URL='postgres://USUARIO:SENHA@127.0.0.1:5432/navalhia'
export DATABASE_SSL=false
npm run migrate:all

# simulador interativo, sem LLM
npm run simulate:agent -- --tenant <slug-ou-uuid> --interactive --llm none --now 2026-11-16T10:00:00-03:00

# replay de um roteiro
npm run simulate:agent -- --tenant <slug-ou-uuid> --replay scripts/examples/cliente-decidido.yaml --llm none
npm run simulate:agent -- --tenant <slug-ou-uuid> --phone 5500000000001 --now 2026-11-16T18:00:00-03:00 --replay scripts/examples/lembrete-confirmo.yaml --llm none

# suíte de contexto
npx vitest run src/__tests__/agent-context-conversations.test.ts

# compare none vs openai — os testes usam cliente fake; este comando chama a API de verdade
OPENAI_API_KEY=sk-... npm run simulate:compare -- --tenant <slug-da-barbearia-local> --out /tmp/navalhia-simulate-compare.md --model gpt-4o-mini --max-runs 1 --max-tokens 300000
```

A rotação de instância está no PR https://github.com/matteusmanoel/appointments/pull/44 (`cd32ba7`). O runbook, nesse PR, é `docs/qa/runbook-uazapi-instancia.md`.

```bash
cd backend
export DATABASE_URL='postgres://USUARIO:SENHA@127.0.0.1:5432/navalhia'
export DATABASE_SSL=false
export APP_ENCRYPTION_KEY='<a mesma chave da API>'
npm run whatsapp:rotate -- --tenant <slug-ou-uuid> --webhook-url https://<publico>/api/webhooks/uazapi
npm run whatsapp:rotate -- --tenant <slug-ou-uuid> --dry-run
npm run whatsapp:rotate -- --remote
```

## O que rodou aqui

| Comando | Resultado |
| --- | --- |
| `npx vitest run` no backend, com `DATABASE_URL` em `127.0.0.1` | 105 arquivos, 961 testes, passou |
| `npx tsc --noEmit` no backend | passou, de novo nesta revisão |
| `npm test` na raiz (front) | 30 arquivos, 192 testes, passou. O front não mudou |
| `npm run build` na raiz | passou |

O CI do GitHub continua sem runner por billing. A evidência é a execução local acima.
