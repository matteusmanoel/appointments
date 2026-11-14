# Proposta (NÃO aplicada): EXCLUDE constraint contra sobreposição na agenda

Status: **proposta**. Nada disto foi aplicado em nenhum banco, não foi executado nem em banco local, e não está em `supabase/migrations/` de propósito (por isso também não há ordem de execução automática nem teste no CI).
O que entra no PR é o lock por barbeiro/dia (`lib/booking-lock.ts`, `lockBarberDay`), usado por painel (POST e PATCH), link público (agendar e reagendar), `/tools` e agente (criar e remarcar).

## Por que considerar

O lock advisory só protege código que o chama. A constraint protege o dado contra qualquer caminho (script, SQL manual, um caminho novo que esqueça o lock).

## Correção em relação à versão anterior deste documento

- **`NOT VALID` NÃO existe para `EXCLUDE`.** O Postgres só aceita `NOT VALID` em `CHECK` e `FOREIGN KEY`; `ALTER TABLE … ADD CONSTRAINT … EXCLUDE … NOT VALID` dá erro de sintaxe. A versão anterior dizia o contrário. As saídas reais para dados que já se sobrepõem são: (a) resolver as linhas antes, ou (b) limitar a constraint a datas futuras com um **predicado `WHERE` de data de corte literal** (ver abaixo).
- O predicado de um índice precisa ser imutável: use um literal (`DATE '2026-12-01'`), **nunca** `now()`/`CURRENT_DATE`.
- A migração candidata agora tem `SET lock_timeout`, passo de repetição, `down` e roteiro de teste em cópia do banco.

## Migration candidata (up)

```sql
-- Janela de baixo uso. ADD CONSTRAINT … EXCLUDE constrói um índice GiST com ACCESS EXCLUSIVE na tabela
-- (bloqueia leituras e escritas da agenda). SEM lock_timeout, a migração ficaria na fila atrás de uma
-- transação longa e travaria TODA a agenda enquanto espera. Com ele, falha rápido e você repete.
SET lock_timeout = '5s';
SET statement_timeout = '10min';

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    barber_id WITH =,
    tsrange(
      (scheduled_date + scheduled_time),
      (scheduled_date + scheduled_time + (duration_minutes * interval '1 minute'))
    ) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));
-- Variante (b), só datas futuras (literal fixo, ex.: a data da migração):
--   … WHERE (status NOT IN ('cancelled', 'no_show') AND scheduled_date >= DATE '2026-12-01');
```

Se der `canceling statement due to lock timeout` (55P03): **nada foi alterado**; repita em outro momento (a transação do `ALTER` é atômica).

## Down (reversão)

```sql
SET lock_timeout = '5s';
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
-- A extensão btree_gist pode ficar (inofensiva); só remova se nada mais a usar:
-- DROP EXTENSION IF EXISTS btree_gist;
```

## Antes de aplicar (pré-requisitos)

1. **Dados existentes**: a constraint falha se já houver sobreposição. Auditar primeiro (somente leitura):

```sql
SELECT a.id, b.id AS conflita_com, a.barber_id, a.scheduled_date, a.scheduled_time
FROM public.appointments a
JOIN public.appointments b
  ON a.barber_id = b.barber_id AND a.id < b.id
 AND a.status NOT IN ('cancelled','no_show') AND b.status NOT IN ('cancelled','no_show')
 AND tsrange(a.scheduled_date + a.scheduled_time, a.scheduled_date + a.scheduled_time + a.duration_minutes * interval '1 minute')
  && tsrange(b.scheduled_date + b.scheduled_time, b.scheduled_date + b.scheduled_time + b.duration_minutes * interval '1 minute');
```

   Resolver as linhas encontradas (cancelar, mover) ou usar a variante (b) com data de corte posterior às sobreposições históricas. **Não existe `NOT VALID` para EXCLUDE.**
2. **`duration_minutes`**: a coluna é `INTEGER NOT NULL DEFAULT 30` (migration `20260131203523`), então nenhuma linha fica fora da proteção por NULL. `duration_minutes = 0` gera intervalo vazio, que nunca conflita (aceitável; o app não cria duração 0).
3. **Buffer entre atendimentos**: o agente aplica `getBookingBufferMinutes` (intervalo mínimo). A constraint não enxerga o buffer; ela só impede sobreposição pura. O lock continua necessário para o buffer.
4. **`completed` com `completed_time`**: o cálculo de ocupação do código usa `completed_time` como fim quando existe; a constraint usa `scheduled_time + duration`. Podem divergir (atendimento que acabou antes do previsto). Aceitável (a constraint é mais conservadora), mas muda o comportamento ao editar atendimentos já concluídos: o PATCH passaria a falhar com 23P01 em vez de 409.
5. **Erro 23P01 (exclusion_violation)**: mapear para 409/SLOT_CONFLICT nos 5 caminhos de escrita **no mesmo PR que aplicar a constraint**, com um teste por caminho.
6. A extensão `btree_gist` precisa estar disponível no Postgres de produção (RDS/Aurora/Neon a oferecem; confirmar na versão em uso).

## Roteiro de teste em CÓPIA do banco (nunca em produção)

1. Restaurar um dump recente numa instância descartável.
2. Rodar a auditoria acima (esperado: 0 linhas, ou tratar as que aparecerem).
3. Aplicar o `up` (com `lock_timeout`). Conferir `\d public.appointments` (constraint listada) e o tempo gasto.
4. Provocar sobreposição de propósito: `INSERT` de dois agendamentos do mesmo barbeiro no mesmo horário e status `pending`. Esperado: `ERROR 23P01 conflicting key value violates exclusion constraint "appointments_no_overlap"`.
5. Marcar um deles como `cancelled` e repetir o insert: deve passar (o predicado ignora cancelados).
6. Rodar a suíte do backend contra essa cópia (os testes de corrida do lock devem continuar passando; 23P01 só aparece se algum caminho esquecer o lock).
7. Aplicar o `down` e conferir que a constraint sumiu.

## Recomendação

Manter o lock agora (já resolve a corrida entre os 5 caminhos) e adotar a constraint depois da auditoria dos dados, como defesa em profundidade.
