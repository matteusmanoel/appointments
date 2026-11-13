# ADR 0002 — Separação em Understanding / Orchestrator / Composer

## Status

Aceito

## Contexto

`runAgent` acumula três responsabilidades num único loop OpenAI: interpretação semântica, decisão de negócio e geração de linguagem. Isso produziu três classes de bug confirmadas em sessão de teste (Cavalier Barbearia, 25/09/2026):

1. **Substituição silenciosa de barbeiro** — catálogo ausente do contexto + verificação de substituição só no turno atual. Sem contrato entre "quem interpreta" e "quem verifica regra".
2. **Resumo de slot antes de verificar disponibilidade** — `composeAvailableSlotConfirm` chamado antes de `create_appointment` confirmar. O compositor agia com dado não verificado.
3. **Nome do cliente perguntado novamente** — `confirmedPersonName` descarta nome confirmado que coincide com push name da API. Estado de identidade sem contrato explícito.

A causa raiz comum: o LLM decide comportamento que deveria ser determinístico, e funções determinísticas dependem de dados que o LLM deveria ter extraído. As responsabilidades sangram entre si porque vivem no mesmo escopo de execução.

Tentativa anterior de mitigação (filtros booleanos de intent) foi removida corretamente — eram heurísticas de palavras específicas, não contratos. O problema raiz não é o filtro: é a ausência de fronteiras entre fases.

## Decisão

`runAgent` torna-se thin coordinator. Cada fase recebe interface TypeScript exportada e vive em arquivo próprio:

```
backend/src/ai/
  agent.ts                ← runAgent(): entry point, ~100 linhas
  agent/
    context-builder.ts    ← buildAgentContext()  → AgentContext
    understanding.ts      ← understandTurn()     → IntentSet
    orchestrator.ts       ← orchestrate()        → Plan
    composer.ts           ← composeTurn()        → Reply[]
```

### Contrato entre fases

**Understanding** (`understandTurn`):
- Recebe: `Turn` (Eventos do cliente + contexto acumulado)
- Devolve: `IntentSet` — conjunto de intents com campos parciais permitidos (`null`, `"ambiguous"`, `"unknown_named"`)
- Nunca consulta: catálogo, banco, regras de negócio, estado de conversa
- Razão para mudar: modelo OpenAI, schema de `IntentSet`

**Orchestrator** (`orchestrate`):
- Recebe: `IntentSet` + `EstadoDeConversa` + `AgentContext`
- Devolve: `Plan` — ações a executar, com campos obrigatórios resolvidos ou pergunta a fazer
- Consulta: catálogo (leitura), estado de conversa, regras de negócio
- Nunca delega ao LLM: decisão de qual ação tomar, qual campo pedir, se handoff é necessário
- Razão para mudar: regras de negócio, novas ações de domínio

**Composer** (`composeTurn`):
- Recebe: `Plan` + `ToolResults` + `AgentContext`
- Devolve: `Reply[]` — bolhas de resposta
- Nunca decide: qual ação foi tomada, se o horário está disponível, se o nome é válido
- Razão para mudar: tom, formato, limites de bolhas

### Regras determinísticas que saem do prompt e entram no Orchestrator

- `reschedule` + `cancel` simultâneos → `reschedule` prevalece
- `plan_offered` + novo intent ≠ plano → processar novo intent, limpar estado
- `intent.confidence < HANDOFF_LOW_CONFIDENCE_THRESHOLD` (0.35) em dois Turnos consecutivos → `Plan { action: "handoff" }`
- `schedule` com `client_ai_memory.confidence >= 0.5` → pular coleta, pré-preencher com memória
- `service === "ambiguous"` → consultar catálogo deterministicamente (combo existe? propor. Não existe? perguntar)
- `barber === "unknown_named"` → disclosure obrigatória + sugerir disponíveis (nunca substituição silenciosa)

### O que não muda

- `ai-worker.ts` continua chamando `runAgent` — sem nova fila, sem novo processo
- `booking-draft.ts` continua como contrato do Rascunho (um slot em construção)
- Ferramentas OpenAI (`tools.ts`) não mudam de interface
- Banco de dados sem migration neste ADR

## Consequências

**Positivas:**
- Cada fase é testável isoladamente (unit tests sem LLM para Understanding e Orchestrator)
- Bugs futuros têm fronteira identificável: linguagem (Understanding) vs. negócio (Orchestrator) vs. tom (Composer)
- Cenários golden do benchmark verificam `Plan` e `IntentSet` diretamente, não strings da resposta
- Novos intents e regras de negócio entram no Orchestrator sem tocar o loop LLM

**Negativas / riscos:**
- Latência levemente maior: três contextos sequenciais vs. um loop. Mitigação: Understanding e contexto podem ser preparados em paralelo com carregamento de dados.
- Custo de tokens: Understanding e Composer fazem chamadas separadas. Mitigação: Understanding pode ser um modelo menor; Composer não precisa de tools.
- Aumento de superfície de código na transição. Mitigação: `finishTurn` atual (que já aplica overrides pós-LLM) mapeia diretamente para Orchestrator — é refactor, não reescrita.

**Reverter:**
Reverter implica fundir as três fases de volta em `runAgent`. Dado que o estado persistido (`booking_draft`, `conversation_turns`, `client_ai_memory`) não muda, a reversão não gera inconsistência de dados — apenas perde os contratos. Reversão é cara mas possível até as migrações de estado chegarem.
