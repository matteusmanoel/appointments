# Ciclo de Autoaprimoramento da IA — Guia Interno

> Uso exclusivo do time de desenvolvimento durante testes do MVP.

---

## Visão geral

O fluxo de autoaprimoramento permite que qualquer membro do time, ao detectar uma falha real do agente de atendimento no WhatsApp, registre esse caso de forma estruturada e o conecte diretamente ao sistema de benchmark/refinamento existente.

```
Falha detectada no inbox
        ↓
"Reportar problema da IA"
        ↓
Classifica tipo + severidade + nota
        ↓
IA analisa e sugere correção (OpenAI)
        ↓
"Salvar no benchmark" (opcional)
        ↓
Incidente persiste no DB (ai_incidents)
+ rascunho de cenário benchmark gerado
        ↓
CLI: benchmark incidents list/export
        ↓
Dev edita cenário e promove ao suite
        ↓
npx tsx benchmark/cli.ts run
        ↓
Análise e refinamento incremental
```

---

## Como acionar (UX)

1. Abra o **Atendimento** (`/app/whatsapp-interno`)
2. Selecione a conversa com o problema
3. No menu da barra de chat, clique em **"Reportar problema"**
4. No modal:
   - Selecione o **tipo de problema** (19 categorias organizadas em grupos)
   - Selecione a **severidade** (Crítica / Média / Leve)
   - Escreva uma nota opcional descrevendo o problema e o comportamento esperado
5. Clique em **"Analisar com IA"**
6. Revise a sugestão da IA (summary, patches sugeridos, risk notes)
7. Escolha uma ação:
   - **"Salvar no benchmark"** → persiste o incidente + gera rascunho de cenário (use este para o ciclo de refinamento)
   - **"Aplicar no rascunho"** → aplica a sugestão nas configurações em rascunho
   - **"Aplicar e publicar"** → aplica e publica imediatamente

---

## O que é capturado por incidente

| Campo | Descrição |
|---|---|
| `incident_type` | Categoria do problema (19 tipos) |
| `severity` | critical / medium / light |
| `manager_note` | Nota livre do dev |
| `transcript_json` | Todas as mensagens da conversa |
| `settings_snapshot_json` | Snapshot do `agent_profile` + `additional_instructions` ativos no momento |
| `diagnosis_result_json` | Resposta completa da análise OpenAI |
| `benchmark_scenario_draft_json` | Rascunho de cenário gerado automaticamente |
| `conversation_id` | ID da conversa original |
| `status` | `open` → `triaged` → `promoted` → `archived` |

---

## Tipos de problema disponíveis

### Agendamento
- `double_booking` — Agendamento em horário já ocupado
- `ignored_availability` — Ignorou disponibilidade
- `reagendamento_incorreto` — Reagendamento incorreto
- `falha_fechamento` — Falha no fechamento do agendamento

### Conversação
- `abertura_robotizada` — Abertura robotizada / sem naturalidade
- `loop_conversacional` — Loop conversacional
- `pergunta_duplicada` — Pergunta duplicada / repetida
- `erro_retomada_tool` — Erro na retomada após tool failure

### Segurança / Exposição
- `uuid_leak` — Mostrou ID/UUID
- `asked_phone` — Pediu telefone do cliente
- `exposicao_erro_tecnico` — Exposição de erro técnico
- `hallucination` — Resposta incoerente / inventou

### Memória e Contexto
- `memoria_incorreta` — Memória do cliente usada incorretamente
- `wrong_policy` — Política errada

### Tom e Estilo
- `tone_issue` — Problema de tom

### Pós-atendimento
- `follow_up_ruim` — Follow-up inadequado
- `lembrete_inadequado` — Lembrete inadequado
- `cobranca_ruim` — Cobrança problemática

### Operacional
- `concorrencia_ruido` — Concorrência / ruído operacional

---

## CLI de incidentes

```bash
# Listar incidentes salvos
npx tsx benchmark/cli.ts incidents list

# Listar apenas abertos
npx tsx benchmark/cli.ts incidents list --status open

# Listar de uma barbearia específica
npx tsx benchmark/cli.ts incidents list --barbershop <uuid>

# Exportar rascunho de cenário como JSON
npx tsx benchmark/cli.ts incidents export --id <uuid>

# Atualizar status de um incidente
npx tsx benchmark/cli.ts incidents status --id <uuid> --set triaged
npx tsx benchmark/cli.ts incidents status --id <uuid> --set promoted
```

---

## Como promover um incidente ao benchmark

1. Exporte o rascunho do cenário:
   ```bash
   npx tsx benchmark/cli.ts incidents export --id <uuid> > /tmp/draft.json
   ```

2. Abra o arquivo de cenários adequado em `backend/benchmark/scenarios/barbershop/`

3. Crie um novo objeto `Scenario` no array, usando o JSON exportado como base:
   - Renomeie o `id` (ex: `book-12-loop-apos-falha`)
   - Ajuste `turns` para incluir apenas o essencial
   - Defina `expected.asserts` com as verificações corretas
   - Adicione `expected.noViolations` conforme o tipo

4. Rode o benchmark para validar:
   ```bash
   npx tsx benchmark/cli.ts run --mock --scenario book-12-loop-apos-falha
   ```

5. Marque o incidente como promovido:
   ```bash
   npx tsx benchmark/cli.ts incidents status --id <uuid> --set promoted
   ```

---

## Ciclo de refinamento completo

```bash
# 1. Após promover incidentes, rodar candidato
npx tsx benchmark/cli.ts run --live --commit $(git rev-parse HEAD)

# 2. Comparar com baseline
npx tsx benchmark/cli.ts compare

# 3. Se gate passou, promover
npx tsx benchmark/cli.ts promote

# 4. Gerar relatório de sugestões
npx tsx benchmark/cli.ts refine
```

---

## Limitações atuais

| Limitação | Impacto | Próximo passo |
|---|---|---|
| Rascunho gerado é determinístico (sem LLM) | Turns extraídos podem ser repetitivos ou longos demais | Adicionar chamada OpenAI opcional para gerar turns sintéticos a partir da falha |
| Não há promoção automática de incidente → cenário | Dev precisa copiar/colar o JSON manualmente | Implementar `benchmark incidents promote` que gera o arquivo de cenário automaticamente |
| Sem painel de incidentes na UI | Não há listagem de histórico no app | Criar aba simples de "Incidentes" no Atendimento ou Configurações |
| `tool_trace` não é capturado | Falhas de tool call não têm contexto completo | Expor `tool_trace` por conversa na API de mensagens |
| Status manual | Não atualiza automaticamente quando promovido | Atualizar status ao promover via CLI |

---

## Arquitetura

```
UI (InboxView)
  └─ IncidentReportModal
       ├─ POST /api/integrations/whatsapp/ai-incidents/diagnose  → análise OpenAI
       └─ POST /api/integrations/whatsapp/ai-incidents/save      → persiste no DB

DB: ai_incidents (tabela)
  └─ benchmark_scenario_draft_json (rascunho gerado pelo backend)

CLI: benchmark incidents
  └─ benchmark/incidents.ts  → queries diretas ao DB
```
