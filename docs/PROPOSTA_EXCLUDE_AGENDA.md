# Proposta (NÃO aplicada): EXCLUDE constraint contra sobreposição na agenda

Status: **proposta**. Nada disto foi aplicado em nenhum banco, e não está em `supabase/migrations/` de propósito.
O que entra no PR é o lock por barbeiro/dia (`lib/booking-lock.ts`, `lockBarberDay`), usado por painel (POST e PATCH), link público (agendar e reagendar), `/tools` e agente (criar e remarcar).

## Por que considerar

O lock advisory só protege código que o chama. A constraint protege o dado contra qualquer caminho (script, SQL manual, um caminho novo que esqueça o lock).

## Migration candidata

```sql
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

   Resolver as linhas encontradas (ou usar `NOT VALID`, que só vale para linhas novas/atualizadas, e validar depois).
2. **Buffer entre atendimentos**: o agente aplica `getBookingBufferMinutes` (intervalo mínimo). A constraint não enxerga o buffer; ela só impede sobreposição pura. O lock continua necessário para o buffer.
3. **`completed` com `completed_time`**: o cálculo de ocupação do código usa `completed_time` como fim quando existe; a constraint usa `scheduled_time + duration`. Podem divergir (atendimento que acabou antes do previsto). Aceitável (a constraint é mais conservadora), mas muda o comportamento ao editar atendimentos já concluídos: o PATCH passaria a falhar com 23P01 em vez de 409; mapear o erro `23P01` para 409.
4. **Erro 23P01 (exclusion_violation)**: tratar nos 5 caminhos de escrita, devolvendo 409/SLOT_CONFLICT.
5. **Migração em tabela grande**: `ADD CONSTRAINT ... EXCLUDE` constrói índice GiST com lock `ACCESS EXCLUSIVE` na tabela; fazer em janela de baixo uso.
6. A extensão `btree_gist` precisa estar disponível no Postgres de produção (RDS/Aurora a oferecem; confirmar na versão em uso).

## Recomendação

Manter o lock agora (já resolve a corrida entre os 5 caminhos) e adotar a constraint depois da auditoria dos dados, como defesa em profundidade.
