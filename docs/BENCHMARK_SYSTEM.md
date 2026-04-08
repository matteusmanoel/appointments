# Sistema de Benchmark & Refinamento do Agente

> Documento técnico interno. Última atualização: Abril 2026.

## Visão Geral

Este sistema implementa um loop de melhoria contínua controlado para o agente de atendimento do NavalhIA. O objetivo é reduzir ao máximo a auditoria manual de conversas, substituindo-a por benchmarks reproduzíveis, avaliação objetiva e recomendações rastreáveis.

**O que o sistema faz:**
- Executa cenários de conversa (sintéticos + reais) contra o agente
- Avalia qualidade em duas camadas: regras determinísticas + LLM-as-judge
- Gera scores compostos e relatórios comparáveis entre execuções
- Detecta regressões antes de promover mudanças
- Sugere hipóteses de correção sem aplicar automaticamente

**O que o sistema NÃO faz:**
- Não aplica mudanças no agente automaticamente
- Não substitui revisão humana de cenários críticos
- Não define política de produto — só mede conformidade com a política definida

---

## Arquitetura

```
backend/benchmark/
├── types.ts                     Tipos centrais (Scenario, ViolationType, BenchmarkRun…)
├── config.ts                    Configuração global (pesos, thresholds, gate rules)
│
├── scenarios/
│   ├── index.ts                 Registry + filtro por tags
│   └── barbershop/
│       ├── greeting.ts          Cenários de saudação
│       ├── booking.ts           Cenários de agendamento
│       ├── management.ts        Cancelamento, reagendamento, waitlist
│       ├── memory.ts            Preferências, "o de sempre", contexto
│       └── edge-cases.ts        Fora de escopo, handoff, reativação
│
├── evaluation/
│   ├── deterministic.ts         20+ checks de regras (sem LLM)
│   ├── llm-judge.ts             LLM-as-judge com rubrica fixa (12 métricas)
│   └── scorer.ts                Score composto com pesos documentados
│
├── runner/
│   ├── harness.ts               Runner principal (mock + live)
│   └── replay.ts                Replay de conversas reais anonimizadas
│
├── comparison/
│   ├── baseline.ts              Salvar/carregar snapshots de runs
│   └── gate.ts                  Regras de promoção (6 checks configuráveis)
│
├── reports/
│   └── generator.ts             Relatórios MD + JSON por run e comparação
│
├── refinement/
│   ├── analyzer.ts              Agrupa falhas, identifica quick wins
│   └── patcher.ts               Gera sugestões em MD (sem auto-apply)
│
├── results/                     Runs salvos (JSON + MD) + registry
├── suggestions/                 Sugestões de refinamento aguardando revisão
└── cli.ts                       CLI unificado (run/compare/promote/refine…)
```

---

## Como Rodar

### Pré-requisitos
- `.env` com `OPENAI_API_KEY` e `DATABASE_URL`
- Banco com seed executado (`npm run seed:dev`)
- Node 18+ com `tsx` disponível

### Modo mock (sem OpenAI, para CI)

Executa apenas os checks determinísticos. Não chama o agente real.

```bash
cd backend
npm run benchmark:run:mock
```

### Modo live (com OpenAI + DB real)

Executa cenários completos, incluindo LLM judge.

```bash
cd backend
npm run benchmark:run
# ou com filtro de tag:
npm run benchmark -- run --live --tags booking,greeting
# ou cenário específico:
npm run benchmark -- run --live --scenario book-01-direto
```

### Ver runs salvos

```bash
npm run benchmark:list
```

### Gerar relatório de um run

```bash
npm run benchmark:report
# ou especificando run ID:
npm run benchmark -- report --run <runId>
```

### Comparar com baseline

```bash
npm run benchmark:compare
```

### Promover candidato a produção

```bash
npm run benchmark:promote
```

### Analisar falhas e gerar sugestões

```bash
npm run benchmark:refine
```

---

## Fluxo de Trabalho Completo

```
1. [Mudança] Ajuste prompt, guardrail ou code
           ↓
2. [Benchmark] npm run benchmark:run
           ↓
3. [Relatório] Leia benchmark/results/<runId>.md
           ↓
4. [Comparar] npm run benchmark:compare
           ↓       ↘
    Gate PASSA     Gate FALHA
           ↓              ↓
5. [Promover]      6. [Refinar]
   benchmark:promote   benchmark:refine
           ↓              ↓
  Nova produção      Leia suggestions/*.md
                     Ajuste e volte ao passo 1
```

---

## Cenários Disponíveis

### Saudações (tag: `greeting`)
| ID | Descrição |
|----|-----------|
| `greet-01-vague` | Cliente manda só "Oi" |
| `greet-02-seco` | Cliente manda "Salve" |
| `greet-03-cordial` | Cliente cumprimenta e pede agendamento |

### Agendamento (tag: `booking`)
| ID | Descrição |
|----|-----------|
| `book-01-direto` | Cliente especifica serviço + data + hora |
| `book-02-indeciso` | Cliente não sabe o serviço |
| `book-03-qualquer-barbeiro` | Quer qualquer barbeiro, qualquer horário amanhã |
| `book-04-horario-exato` | Hora e barbeiro específicos |
| `book-05-primeiro-horario` | Quer o primeiro disponível amanhã |
| `book-06-hoje` | Pergunta se tem horário hoje |
| `book-07-mudanca-servico` | Muda o serviço no meio da conversa |
| `book-08-conflito-agenda` | Horário solicitado está ocupado |

### Gestão (tags: `cancellation`, `reschedule`, `waitlist`)
| ID | Descrição |
|----|-----------|
| `mgmt-01-cancelamento` | Cancelamento simples |
| `mgmt-02-reagendamento` | Mudança de data/hora |
| `mgmt-03-no-show-retorno` | Retorno após no-show |
| `mgmt-04-lista-espera` | Agenda cheia → lista de espera |

### Memória (tag: `memory`)
| ID | Descrição |
|----|-----------|
| `mem-01-o-de-sempre` | Cliente pede "o de sempre" |
| `mem-02-contexto-repetido` | Agente não deve repetir pergunta já respondida |
| `mem-03-cliente-recorrente` | Cliente recorrente com histórico |

### Edge Cases
| ID | Tags | Descrição |
|----|------|-----------|
| `edge-01-fora-escopo` | out-of-scope | Pergunta sobre pizza |
| `edge-02-servico-inexistente` | out-of-scope | Serviço que não existe |
| `edge-03-handoff` | handoff | Pedido de humano |
| `edge-04-reativacao` | reactivation | Cliente sumido volta |
| `edge-05-cobranca-amigavel` | debt | Pendência financeira |
| `edge-06-mensagem-ambigua` | edge | "pode ser" sem contexto |
| `edge-07-follow-up` | follow-up | Resposta a follow-up |
| `edge-08-multiplos-servicos` | booking | Combo de serviços |
| `edge-09-sem-dados` | booking | Sem nome do cliente |
| `edge-10-preferencia-barbeiro-indisponivel` | booking | Barbeiro preferido fora |

---

## Como Adicionar Cenários

1. Escolha ou crie o arquivo adequado em `benchmark/scenarios/barbershop/`
2. Adicione um objeto `Scenario` seguindo a interface em `types.ts`
3. Exporte do array do arquivo
4. O cenário será detectado automaticamente pelo registry em `scenarios/index.ts`

### Exemplo de cenário

```typescript
import type { Scenario } from "../../types.js";

export const meuCenario: Scenario = {
  id: "book-99-meu-caso",
  name: "Meu caso de uso",
  description: "O que esse cenário testa",
  tags: ["booking"],
  vertical: "barbershop",
  turns: [
    { role: "user", content: "Olá, quero agendar" },
    { role: "user", content: "Amanhã às 10h, corte" },
  ],
  expected: {
    finalState: "appointment_created",
    noViolations: ["uuid_leak", "phone_ask"],
    mustCallTools: ["check_availability"],
    asserts: [
      {
        name: "Não pede nome de novo",
        severity: "medium",
        check: (i, reply) => i === 1
          ? !/qual seu nome/i.test(reply)
          : true,
      },
    ],
  },
};
```

---

## Como Interpretar Scores

### Score por cenário (0–100)

```
Score = 100
  - (violações críticas × 25)    [cap: se houver alguma, máx = 40]
  - (violações médias × 8)
  - (violações leves × 3)
  + (judge quality × 0.25)       [só em modo live]
  + (tarefa concluída × 20)
  + (tool efficiency × 0–10)
  - (cost penalty × 0–5)
```

### Thresholds
| Faixa | Significado |
|-------|-------------|
| ≥ 80 | Excelente |
| 60–79 | Aprovado (acima do threshold de 60) |
| 40–59 | Atenção — falha, mas sem críticos |
| < 40 | Falha grave — provavelmente tem violações críticas |

### Violações críticas (cap automático em 40pts)
São violações que sinalizam problemas graves de produto:
- `ai_exposure` — agente revela que é um sistema automatizado
- `pre_booking_claim` — afirma que agendou antes da confirmação da tool
- `past_time_suggestion` — sugere horário no passado para hoje
- `phone_ask` — pede telefone (já temos pelo WhatsApp)
- `uuid_leak` — vaza ID interno para o cliente

---

## Gate de Promoção

O gate tem 6 regras configuráveis em `config.ts`:

| Regra | Critério padrão |
|-------|----------------|
| `zero_new_critical_violations` | Nenhuma nova violação crítica |
| `total_violations_not_worse` | Δ violações ≤ +2 |
| `quality_score_retained` | Judge score ≥ baseline × 0.97 |
| `task_completion_not_regressed` | Conclusão ≥ baseline × 0.95 |
| `cost_not_exploded` | Tokens ≤ baseline × 1.10 |
| `avg_score_not_regressed` | Score médio ≥ baseline − 3pts |

**Se TODAS passam:** recomendação `promote`  
**Se critical_violations falha:** recomendação `reject` (hard block)  
**Se uma regra não-crítica falha:** recomendação `manual_review`  
**Se múltiplas falham:** recomendação `reject`

---

## Memória Estruturada de Cliente

### Tabela `client_ai_memory`

Campos principais:
- `preferred_services` — serviços favoritos (JSONB)
- `preferred_barber_id` — barbeiro preferido
- `preferred_days` — dias da semana preferidos (array)
- `preferred_time_start/end` — faixa de horário preferida
- `last_completed_services` — último combo de serviços
- `communication_style` — formal/informal/direct/chatty/unknown
- `payment_pending` — flag de pendência financeira
- `notes_safe` — notas curtas para o agente usar no prompt

### Política de confiança

Cada campo tem um companion `_conf` (0.0–1.0):
- `1.0` = confirmado pelo cliente explicitamente
- `0.7` = inferido de múltiplos agendamentos
- `0.5` = inferido de um dado apenas
- `< 0.5` = tratar como desconhecido

A função `decay_client_ai_memory_confidence()` deve ser chamada diariamente para reduzir a confiança de clientes sem visita em 180+ dias.

---

## Comparação de Versões (Baseline vs Candidato)

### Fluxo típico

```
v1 (produção atual)
  ↓ npm run benchmark:run --live
  ↓ npm run benchmark:promote       ← torna v1 o baseline "production"

[mudança no prompt/agente]

  ↓ npm run benchmark:run --live    ← novo run salvo como "candidate"
  ↓ npm run benchmark:compare       ← compara candidate vs production
  ↓ Gate passa?
      SIM → npm run benchmark:promote   ← candidate vira nova produção
      NÃO → npm run benchmark:refine    ← ver sugestões
```

### Arquivos gerados

- `benchmark/results/<runId>.json` — dados estruturados do run
- `benchmark/results/<runId>.md` — relatório legível
- `benchmark/results/compare-<x>-vs-<y>.md` — diff entre dois runs
- `benchmark/results/registry.json` — índice de todos os runs
- `benchmark/suggestions/<data>-<runId>.md` — sugestões de refinamento

---

## Limitações Atuais

1. **Mock mode é superficial:** os checks determinísticos funcionam, mas sem o agente real, não testa tool calls nem contexto real.

2. **Judge tem custo:** cada run com judge usa ~800 tokens por cenário via `gpt-4o-mini`. Com 25 cenários, ~20k tokens por run.

3. **Cenários sintéticos não garantem cobertura total:** adicione cenários baseados em conversas reais quando disponível (via `replay`).

4. **Sem auto-apply:** o sistema gera sugestões mas não aplica. Isso é intencional — mudanças de prompt precisam de revisão humana.

5. **Sem suporte a múltiplas barbearias no benchmark:** o runner usa a primeira barbearia do DB. Para testar configurações específicas, crie um seed dedicado.

---

## Próximos Passos Sugeridos

### Curto prazo
- [ ] Executar o primeiro run live e promover como baseline de produção
- [ ] Adicionar 5-10 cenários baseados em conversas reais (via replay)
- [ ] Integrar `npm run benchmark:run:mock` no CI/CD (PR checks)

### Médio prazo
- [ ] Implementar `upsertClientMemory()` no `agent.ts` para popular `client_ai_memory`
- [ ] Usar `client_ai_memory` no prompt quando `overall_confidence >= 0.5`
- [ ] Adicionar cenários multi-barbearia (select_branch)
- [ ] Criar versão headless do benchmark para rodar em Lambda

### Longo prazo
- [ ] Pack de cenários para vertical `clinic` (consultas, exames)
- [ ] Pack de cenários para vertical `beauty` (salão de beleza)
- [ ] Dashboard visual de histórico de runs (React/recharts)
- [ ] Avaliação de A/B de modelos (gpt-4o vs gpt-4o-mini vs outros)

---

## Referências

- `backend/src/ai/agent.ts` — implementação do agente de produção
- `backend/src/scripts/ai-harness.ts` — harness legado (7 cenários básicos)
- `backend/src/ai/prompt-builder.ts` — construção do system prompt
- `supabase/migrations/20260402120000_client_ai_memory.sql` — schema de memória
