# Conectividade ao banco Supabase (IPv4 / DNS)

## Problema 1: "could not translate host name" ou falha ao conectar

A **conexão direta** do Supabase usa o host `db.<project-ref>.supabase.co`, que resolve **apenas para IPv6**. Em redes ou máquinas sem IPv6 (ou com DNS que não retorna AAAA), você pode ver:

- `could not translate host name "db.xxx.supabase.co" to address`
- Ou timeout/falha de conexão ao usar `psql`, backend ou Lambda

## Problema 2: "FATAL: Tenant or user not found" (pooler)

Esse erro aparece ao usar o **pooler** com **região ou project-ref incorretos**. O pooler identifica o projeto (tenant) pelo usuário `postgres.<project-ref>` e pelo **host da região** onde o projeto está. Se você usar `aws-0-us-east-1.pooler.supabase.com` e o projeto estiver em outra região (ex.: `sa-east-1`), o pooler dessa região não conhece seu tenant.

**Solução:** use **sempre** a string de conexão **copiada do Dashboard** do seu projeto (veja abaixo). Não monte a URL manualmente com região inventada.

---

## Solução: usar o Connection pooler (Supavisor)

O **pooler** do Supabase usa um host com **IPv4** (ex.: `aws-0-<REGIAO>.pooler.supabase.com`). A **região** deve ser a do seu projeto.

### Onde pegar a URL (obrigatório)

1. Abra o [Dashboard do Supabase](https://supabase.com/dashboard) e selecione **o projeto**.
2. Clique em **Connect** (canto superior, ou **Project Settings** → **Database**).
3. Em **Connection string**:
   - Aba **Session** (porta 5432) → para `psql`, backend local, scripts.
   - Aba **Transaction** (porta 6543) → para Lambda/serverless.
4. **Copie a URI completa** que o Dashboard mostrar (inclui a região correta e o `postgres.<project-ref>`). Cole no `.env` ou use no `psql` **exatamente** como está, só trocando `[YOUR-PASSWORD]` pela senha do banco.

Não use `us-east-1` (ou qualquer região) por chute: o projeto pode estar em **South America (São Paulo)** → `aws-0-sa-east-1.pooler.supabase.com`, ou em outra região. Só o Dashboard mostra a URL certa.

### Formato da URL (apenas referência – prefira copiar do Dashboard)

- **Session:** `postgresql://postgres.[PROJECT_REF]:[SENHA]@aws-0-[REGIAO].pooler.supabase.com:5432/postgres`
- **Transaction:** `postgresql://postgres.[PROJECT_REF]:[SENHA]@aws-0-[REGIAO].pooler.supabase.com:6543/postgres`

Regiões comuns: `us-east-1`, `sa-east-1` (São Paulo), `eu-west-1`, etc. A sua está em **Connect** no Dashboard.

### Onde configurar no projeto

| Uso              | Onde configurar | Modo recomendado   |
|------------------|------------------|---------------------|
| Local / psql     | `DATABASE_URL` no `.env` ou terminal | Session (5432)     |
| Lambda / deploy  | `DatabaseUrl` no stack (API)         | Transaction (6543)  |

Mantenha **`DATABASE_SSL=true`** ao usar o pooler (Supabase exige SSL). Na URI, pode usar `?sslmode=require`.

### Resumo

- **Conexão direta** (`db.xxx.supabase.co`) = só IPv6 → falha em muitas redes.
- **Pooler** = IPv4, mas a URL deve ser a **do Dashboard**, com a **região correta**, senão aparece "Tenant or user not found".
- Não existe "criar tenant" no Supabase hospedado: o tenant é o próprio projeto. O erro de tenant é sempre **URL/região errada**.
