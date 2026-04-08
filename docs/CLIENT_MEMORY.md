# Client AI Memory — Documentação

## Visão Geral

O sistema de memória do cliente (`client_ai_memory`) permite que o agente de atendimento recorde preferências, histórico e contexto de cada cliente, oferecendo conveniência real sem parecer invasivo ou robótico.

**Princípio central:** A conversa atual sempre tem prioridade sobre a memória histórica.

---

## Onde a Memória Vive

```
Banco de dados (Postgres)
└── public.client_ai_memory      ← uma linha por (cliente × barbearia)

Código de acesso
└── backend/src/ai/memory/client-memory.ts   ← único ponto de acesso SQL
```

A migration está em:
```
supabase/migrations/20260402120000_client_ai_memory.sql
```

---

## Esquema da Tabela

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `preferred_services` | `jsonb` | Array de nomes de serviços mais frequentes |
| `preferred_services_conf` | `numeric(3,2)` | Confiança 0.0–1.0 |
| `preferred_barber_id` | `uuid` | Barbeiro preferido (NULL = sem preferência) |
| `preferred_barber_conf` | `numeric(3,2)` | Confiança |
| `preferred_days` | `integer[]` | Dias da semana preferidos (0=Dom…6=Sáb) |
| `preferred_time_start/end` | `time` | Faixa horária preferida |
| `last_completed_services` | `jsonb` | Serviços do último atendimento concluído |
| `last_completed_at` | `timestamptz` | Data do último atendimento |
| `communication_style` | `text` | `formal/informal/direct/chatty/unknown` |
| `payment_pending` | `boolean` | Pagamento pendente |
| `no_show_count` | `integer` | Total de não-comparecimentos |
| `notes_safe` | `text` | Observações curtas para uso no prompt (max 200 chars) |
| `overall_confidence` | `numeric(3,2)` | Confiança composta 0.0–1.0 |

---

## Como a Memória é Lida

**Fluxo em `runAgent`:**

1. Após resolver o cliente (`upsertClient`), verifica se a tabela `client_ai_memory` existe
2. Se sim, chama `getClientMemory(barbershopId, clientPhone)`
3. Passa o resultado para `buildClientMemoryPromptBlock(memory)`
4. Injeta o bloco no system prompt, **depois** do RAG, **antes** do contexto de agendamento

### Bloco no Prompt

O bloco gerado é conciso e inclui regras de uso explícitas:

```
--- Contexto do cliente (memória histórica) ---
• Serviço: costuma fazer *Corte + Barba*
• Último atendimento: *Corte + Barba* (há 22 dias)
• Barbeiro: costuma preferir *Lucas*
• Horário: costuma preferir *manhã*
• Comunicação: estilo *direto*
[USO]: memória auxiliar apenas. A conversa atual tem prioridade absoluta.
Use para reduzir perguntas e oferecer conveniência. Se o cliente indicar preferência diferente, siga o cliente.
Não afirme preferências com certeza — use 'costuma' ou 'costumava'.
--- fim da memória ---
```

### Threshold de Confiança

- **Campo invisível**: `overall_confidence < 0.5` → bloco omitido do prompt
- **Campo individual**: `field_conf < 0.5` → aquele campo é omitido do bloco
- Configurável em `buildClientMemoryPromptBlock(memory, { minConfidence: 0.5 })`

---

## Como a Memória é Escrita

### Via Eventos Operacionais (alta confiança)

A função `updateClientMemoryFromAppointmentEvent` é chamada automaticamente:

| Evento | Integrado em | O que atualiza |
|--------|-------------|----------------|
| `appointment_created` | `agent.ts` após `create_appointment` | `preferred_services` (conf=0.6), `preferred_barber` (conf=0.5) |
| `appointment_completed` | `routes/appointments.ts` PATCH `/:id` | `last_completed_services`, `preferred_services` (conf=0.7), `preferred_barber` (conf=0.7), `preferred_time`, `reactivation_status=active` + dispara `reinforceMemoryFromHistory` |
| `appointment_cancelled` | `agent.ts` após `cancel_appointment` + `routes/appointments.ts` | `reactivation_status=at_risk` |
| `appointment_no_show` | `routes/appointments.ts` PATCH `/:id` | `no_show_count++`, `last_no_show_at`, `reactivation_status=at_risk` (se ≥2 no-shows), `overall_confidence -= 0.1` |

**Todos os hooks são fire-and-forget** — nunca bloqueiam a resposta principal.

### Via Reforço por Histórico (`reinforceMemoryFromHistory`)

Disparada automaticamente após cada `appointment_completed`, analisa os últimos 12 atendimentos concluídos do cliente e infere preferências com regras conservadoras:

| Campo inferido | Threshold mínimo | Threshold de ratio |
|----------------|------------------|--------------------|
| `preferred_barber` | ≥ 2 atendimentos com mesmo barbeiro | ≥ 50% do total |
| `preferred_services` | ≥ 2 atendimentos com mesmo combo | ≥ 50% do total |
| `preferred_days` | ≥ 2 atendimentos no mesmo dia da semana | ≥ 50% do total |
| `preferred_time` | ≥ 2 atendimentos no mesmo período | ≥ 50% do total |

**Escala de confiança por frequência:**

| Ocorrências | Confiança atribuída |
|-------------|---------------------|
| 1 | 0 (não infere) |
| 2 | 0.45–0.55 |
| 3 | 0.60–0.70 |
| 5+ | 0.75–0.85 |

A confiança nunca é reduzida por reforço — usa `GREATEST(existing, new)`.

### Via Sinais da Conversa (média confiança)

A função `updateClientMemoryFromConversation` é chamada no final de cada turno do agente:

| Sinal detectado | O que atualiza |
|----------------|----------------|
| Linguagem formal | `communication_style=formal` (conf=0.5) |
| Linguagem informal/gíria | `communication_style=informal` |
| Mensagens muito curtas | `communication_style=direct` |
| Muitas exclamações/emojis | `communication_style=chatty` |
| "prefiro manhã / tarde" | `preferred_time_start/end` (conf=0.5) |
| Agendamento criado | `reactivation_status=active` |

### Via Sinais da Conversa (média confiança)

A função `updateClientMemoryFromConversation` é chamada no final de cada turno do agente:

| Sinal detectado | O que atualiza |
|----------------|----------------|
| Linguagem formal | `communication_style=formal` (conf=0.5) |
| Linguagem informal/gíria | `communication_style=informal` |
| Mensagens muito curtas | `communication_style=direct` |
| Muitas exclamações/emojis | `communication_style=chatty` |
| "prefiro manhã / tarde" | `preferred_time_start/end` (conf=0.5) |
| Agendamento criado | `reactivation_status=active` |

---

## Como a Confiança Funciona

### Escala
- **1.0** — confirmado explicitamente pelo cliente
- **0.8** — fortemente inferido (múltiplas visitas ou conclusão de atendimento)
- **0.6** — inferido de um agendamento criado
- **0.5** — inferido de um sinal único na conversa (ex.: preferência de horário)
- **< 0.5** — não usado no prompt
- **0.0** — desconhecido ou expirado

### Reforço
Cada novo evento reforça a confiança via `GREATEST(existing_conf, new_conf)`, nunca reduzindo sem causa.

### Decay automático
A função `decay_client_ai_memory_confidence()` reduz em 50% todos os campos de confiança para clientes sem visita há 180+ dias. Deve ser chamada periodicamente (ex.: job diário).

```sql
SELECT public.decay_client_ai_memory_confidence();
```

### `overall_confidence`
É recomputed automaticamente após qualquer atualização, como média ponderada:
- `preferred_services_conf` tem peso 2.0 (mais importante)
- `preferred_barber_conf` tem peso 1.5
- Demais campos têm peso 0.5

---

## O Que Pode e o Que Não Pode Virar Memória

### ✅ Pode virar memória
- Serviço escolhido em agendamento confirmado
- Barbeiro escolhido em agendamento confirmado
- Atendimento concluído (via evento operacional)
- Preferência explícita de horário ("prefiro manhã")
- Estilo de comunicação observado na conversa
- No-show (via evento)
- Cancelamento (via evento)

### ❌ Não deve virar memória
- Palpites do modelo
- Inferências de uma única frase ambígua
- Dado contradito na mesma conversa
- Preferência mencionada pelo agente (não pelo cliente)
- Serviço apenas consultado (sem confirmação de agendamento)

---

## Como Depurar

### Verificar memória de um cliente
```sql
SELECT m.*, c.name, c.phone
FROM public.client_ai_memory m
JOIN public.clients c ON c.id = m.client_id
WHERE regexp_replace(c.phone, '[^0-9]', '', 'g') LIKE '%11999999999%';
```

### Clientes com alta confiança
```sql
SELECT * FROM public.v_client_ai_memory_confident;
```

### Ver logs
Os updates de memória geram warnings no console apenas em caso de falha:
```
[client-memory] updateFromAppointmentEvent failed: <mensagem>
[client-memory] updateFromConversation failed: <mensagem>
```

---

## Separação entre Memória e RAG

| | RAG (`rag.ts`) | Client Memory (`memory/client-memory.ts`) |
|--|--|--|
| **Conteúdo** | Conhecimento institucional da barbearia (serviços, políticas, FAQ) | Preferências e histórico do cliente específico |
| **Fonte** | `knowledge_chunks` (embeddings) | `client_ai_memory` (relacional) |
| **Escopo** | Por barbearia | Por (cliente × barbearia) |
| **No prompt** | Bloco `--- Conhecimento ---` | Bloco `--- Contexto do cliente ---` |
| **Atualização** | Manual (admin) | Automática (eventos + conversa) |

Ambos aparecem no system prompt como blocos separados e independentes.

---

## Como Expandir para Outros Nichos

O módulo foi projetado para ser agnóstico ao nicho:
- Campos são genéricos (`preferred_services`, `preferred_barber`, `preferred_time`)
- Nenhuma lógica é específica de barbearia
- `AppointmentEventType` pode ser extendido com novos tipos de eventos

Para um novo nicho (ex.: clínica):
1. Os mesmos campos se aplicam
2. Adicionar campos específicos via `ALTER TABLE client_ai_memory ADD COLUMN ...`
3. Ou criar uma tabela filha `client_ai_memory_clinic` com FK para `client_ai_memory.id`

---

## Limitações Atuais

1. **Migration precisa ser aplicada** — a tabela `client_ai_memory` só existe após executar `supabase/migrations/20260402120000_client_ai_memory.sql`. Em ambientes sem ela, todas as operações de memória falham silenciosamente (comportamento intencional).
2. **`notes_safe` não é preenchido automaticamente** — requer preenchimento manual ou pipeline LLM separado.
3. **Sem memória de longo prazo entre múltiplas unidades** — cada `(client_id, barbershop_id)` é independente.
4. **`preferred_days` por conversa** — não inferido da conversa, apenas por histórico de agendamentos.
5. **Eventos `appointment_rescheduled`** — não atualiza memória ainda; poderia reforçar `preferred_barber` e `preferred_time`.

---

## Próximos Passos Priorizados

1. **Aplicar migration** em staging/produção: `supabase/migrations/20260402120000_client_ai_memory.sql`
2. **Decay job** — agendar `SELECT public.decay_client_ai_memory_confidence()` como cron diário
3. **Pipeline de `notes_safe`** — LLM leve para extrair observações relevantes da conversa (ex.: "traz os filhos", "prefere música baixa")
4. **Dashboard de memória** — painel admin para visualizar e corrigir memória de clientes
5. **Hook de `appointment_rescheduled`** — reforçar `preferred_barber` e `preferred_time` quando cliente reagenda para mesmo barbeiro/período
