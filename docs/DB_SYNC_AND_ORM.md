# Sincronização dev/prod e uso de ORM

## Objetivo
Manter o banco local (container ou Supabase local) e o banco de produção (Supabase) com o mesmo schema, à medida que novas features (e migrações) são deployadas.

---

## Conclusão direta: ORM não é obrigatório para sincronizar

A sincronização dev/prod é feita **pela mesma sequência de migrações SQL** aplicada nos dois ambientes. Hoje isso já está bem endereçado com:

- **Fonte única de verdade:** `supabase/migrations/*.sql` (ordenadas por timestamp).
- **Dev:** aplicar migrações no Postgres local (container ou `supabase start`).
- **Prod:** aplicar as mesmas migrações no Supabase (via CLI, CI ou SQL Editor).

Um ORM ajuda em **tipos, ergonomia de queries e (opcionalmente) geração de migrações**, mas **não é necessário** só para “manter dev e prod sincronizados”. O que mantém sincronizado é o processo: **sempre** criar alterações em arquivos em `supabase/migrations/` e rodá-los nos dois ambientes.

---

## Opção 1: Manter como está (recomendado para “só sync”)

- **Migrações:** apenas SQL em `supabase/migrations/`.
- **Backend:** continua com `pg` (raw SQL ou query builder leve se quiser).
- **Tipos:** front pode seguir usando `supabase gen types typescript` a partir do banco (ou tipos já gerados em `src/integrations/supabase/types.ts`).

**Workflow sugerido:**

1. Nova feature → novo arquivo `supabase/migrations/YYYYMMDDHHMMSS_descricao.sql`.
2. **Local:**  
   - Com Supabase local: `supabase db reset` (ou `supabase migration up`).  
   - Com container Postgres: rodar os `.sql` na ordem (por exemplo com `psql` ou script que aplica tudo).
3. **Prod:**  
   - `supabase link` + `supabase db push`, ou  
   - CI que aplica as migrações no Supabase (por exemplo usando `supabase db push` ou executando os SQLs na ordem).

Assim, dev e prod ficam sincronizados **sem introduzir ORM**.

---

## Opção 2: Adotar um ORM (por DX e type-safety)

Se a ideia for melhorar **tipos no backend** e **organização das queries** (e não apenas “sincronizar”), aí faz sentido avaliar ORM. Os dois que melhor se encaixam com Postgres + Supabase são **Drizzle** e **Prisma**.

### Drizzle

- **Vantagens:** leve, TypeScript nativo, schema-as-code, funciona bem com banco já existente (introspect). Pode gerar migrações a partir do diff do schema; você pode **manter** Supabase como dono das migrações (gerar SQL com Drizzle e colar em `supabase/migrations/`) ou usar Drizzle Kit para aplicar.
- **Desvantagens:** ecossistema menor que o Prisma; menos “mágica” (mais próximo de SQL).
- **Sync dev/prod:** continua sendo “a mesma sequência de migrações” (seja SQL do Drizzle em `supabase/migrations/`, seja Drizzle Kit apontando para cada banco). O importante é **não** ter duas fontes de verdade (ex.: Drizzle e Supabase gerando migrações independentes).

### Prisma

- **Vantagens:** ecossistema grande, Prisma Migrate maduro, DX muito boa, tipos gerados a partir do `schema.prisma`.
- **Desvantagens:** mais “peso”; o schema fica em `schema.prisma`. Para **não** duplicar fonte de verdade, o fluxo típico é: Prisma como única fonte de schema → `prisma migrate dev` gera SQL → em prod usar `prisma migrate deploy`. Usar **ao mesmo tempo** Prisma Migrate e migrações manuais no Supabase pode dar conflito se não houver disciplina (um único dono do schema).
- **Sync dev/prod:** mesmo conceito: uma única sequência de migrações (a do Prisma) aplicada no banco local e no Supabase. Supabase continua sendo “Postgres”; Prisma só precisa da connection string.

### Recomendações práticas se escolher ORM

| Cenário | Sugestão |
|--------|----------|
| Quer **mínima mudança** e já tem muitas migrações em `supabase/migrations/` | **Não adote ORM** para migrações. Use Opção 1; eventualmente Drizzle só para **queries** (introspect no banco, sem Drizzle ser dono das migrações). |
| Quer **schema-as-code** e está disposto a centralizar migrações no ORM | **Prisma** ou **Drizzle**. Prisma: schema em `schema.prisma`, migrações geradas por ele, rodar `migrate deploy` em dev e em prod. Drizzle: schema em TS, gerar SQL e colocar em `supabase/migrations/` ou usar Drizzle Kit em ambos os ambientes. |
| Quer **tipos no backend** sem mudar quem manda nas migrações | **Drizzle** com introspect: manter `supabase/migrations/` como fonte de verdade, rodar `drizzle-kit introspect` e usar Drizzle só para consultas. Sync dev/prod continua 100% via Supabase migrations. |

---

## Resumo

- **Sincronizar dev e prod:** use **uma única fonte de migrações** (hoje: `supabase/migrations/`) e aplique a mesma sequência nos dois ambientes. **ORM não é necessário para isso.**
- **Se quiser ORM:** use para tipos e queries. Decida quem é o dono do schema: **ou** Supabase migrations **ou** Prisma/Drizzle Migrate, e discipline o processo para não ter duas fontes de verdade.
- **Recomendação para o navalhia:** manter migrações em `supabase/migrations/`, formalizar o workflow (local + prod) como na Opção 1. Se no futuro quiserem type-safety no backend, considerar **Drizzle com introspect** sem mudar o dono das migrações, ou **Prisma** se quiserem centralizar tudo no Prisma.

Se quiser, no próximo passo podemos descrever um **checklist de comandos** (Supabase CLI + um script opcional) para aplicar migrações em dev e em prod de forma repetível.
