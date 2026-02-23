# Isolamento por tenant (multi-tenant SaaS)

## Convenção

- **Rotas protegidas por JWT** (`requireJwt`): o `barbershop_id` usado em todas as queries é **sempre** `req.auth.barbershopId` (vindo do token). Nunca usar `barbershop_id` vindo de query, body ou params do cliente.
- **Rotas de tools** (`/api/tools/*`, `requireToolsKey`): o `barbershop_id` é **sempre** `req.barbershopId`, definido pelo middleware após validar a API key (lookup em `barbershop_api_keys`). O cliente não deve enviar `barbershop_id`; se enviar, é ignorado/sobrescrito.
- **Registro de usuário** (`POST /api/auth/register`): não aceita `barbershop_id` no body. Apenas `BARBERSHOP_ID` do ambiente é usado (fluxo de seed/bootstrap). Novos tenants e admins são criados **apenas** pelo webhook de billing (provisionamento pós-pagamento).

## Rotas auditadas

- `barbershops`, `barbers`, `services`, `clients`, `appointments`, `reports`: usam `getBarbershopId(req)` (JWT).
- `tools`: usa `req.barbershopId` injetado pelo middleware após validar API key.
- `public`: usa `slug` na URL para resolver estabelecimento (dados públicos de um estabelecimento por slug).

## Resultado

Nenhum usuário ou integração pode acessar ou criar dados em nome de outro estabelecimento; o tenant é sempre derivado do token ou da API key.
