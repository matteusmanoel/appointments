# Conexões de banco (Neon Free / staging)

| Variável | Quem usa | URL | Por quê |
|---|---|---|---|
| `DATABASE_URL` | API (Lambda `api`) | **com pooler** (`ep-xxxx-pooler...`) | muitas Lambdas concorrentes; o pooler de transação evita estourar o limite de conexões do plano Free |
| `DATABASE_URL_DIRECT` | `worker_ai`, `worker_scheduled`, sweeps, `dispatch-gate`, migrations | **sem pooler** (`ep-xxxx...`) | usam `pg_advisory_lock`/`pg_try_advisory_lock` **de sessão**; atrás de pooler de transação o lock vaza para outro cliente ou some |
| `DATABASE_SSL` | todos | `true` no Neon | |

Sem `DATABASE_URL_DIRECT`, tudo usa `DATABASE_URL` (comportamento antigo; ok em Postgres local).

## Timeouts (ms)
- `DATABASE_CONNECTION_TIMEOUT_MS` (10000): espera por conexão. Antes não havia limite.
- `DATABASE_IDLE_TIMEOUT_MS` (30000).
- `DATABASE_QUERY_TIMEOUT_MS` (30000): pool do pooler, lado cliente (`query_timeout`). Não usamos `statement_timeout` ali porque pooler de transação rejeita parâmetros de startup.
- `DATABASE_DIRECT_STATEMENT_TIMEOUT_MS` (120000): `statement_timeout` no servidor, só na conexão direta.
- `DATABASE_POOL_MAX` (10 em produção) / `DATABASE_DIRECT_POOL_MAX` (3).

## Migrations
`cd backend && DATABASE_URL_DIRECT=... DATABASE_SSL=true npm run migrate:all` (idempotente; controla em `public._migrations`).
O CI aplica as migrations duas vezes num Postgres descartável (sem secrets) para pegar migration quebrada antes do merge.
**Não rodar `scripts/seed-production.sql` no Neon novo.**

## Neon Free (staging)
Limites mudam; confira o painel. Regra prática: `DATABASE_POOL_MAX=5` na API, workers com `DATABASE_DIRECT_POOL_MAX=3`, e o compute do Free "dorme" — a primeira conexão após ociosidade pode demorar alguns segundos (cabe no `connectionTimeoutMillis` de 10 s; se não couber, aumente).
