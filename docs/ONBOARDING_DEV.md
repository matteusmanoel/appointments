# Fluxo de Onboarding — Guia de Testes em Desenvolvimento

Guia prático para testar o ciclo completo de entrada de um novo cliente (tenant) na NavalhIA, do cadastro ao primeiro acesso ao painel, sem depender de Stripe ou SES em ambiente local.

---

## Pré-requisitos

| Serviço | Verificação |
|---|---|
| Docker (DB + API + workers) | `docker compose ps` → todos `healthy` |
| Frontend Vite | `npm run dev` rodando em `http://localhost:3002` |
| API | `curl -s http://localhost:3003/healthz` → `{"ok":true}` |
| Stripe CLI (opcional, para fluxo real) | `stripe --version` |

```bash
# Confirmar que a API está respondendo
curl -s http://localhost:3003/healthz
```

---

## Caminho A — Bypass Stripe (recomendado para dev)

Provisiona um novo tenant diretamente no banco, replicando o que o webhook de produção faz.

### 1. Rodar o script de simulação

```bash
# Básico (usa defaults)
./scripts/simulate-onboarding.sh

# Customizado
./scripts/simulate-onboarding.sh \
  --nome   "Barbearia Central" \
  --email  "dono@central.com" \
  --senha  "MinhaSenh@123" \
  --plano  "premium"
```

**O que o script faz (idêntico ao webhook de produção):**
1. Cria um `account` (grupo multi-filial)
2. Cria a `barbershop` com slug único derivado do nome
3. Cria o `profile` admin com `must_change_password = true`
4. Vincula o perfil à conta como `owner` em `account_memberships`
5. Insere 3 serviços padrão (Corte, Barba, Combo)
6. Faz `POST /api/auth/login` e imprime o JWT

**Saída esperada:**
```
✓ JWT obtido!
  must_change_password = true

╔══════════════════════════════════════════════════════╗
║                   ACESSO CRIADO                      ║
║  Email  : dono@central.com                           ║
║  Senha  : MinhaSenh@123                              ║
║  Painel : http://localhost:3002                      ║
╚══════════════════════════════════════════════════════╝
```

### 2. Acessar o painel

1. Abra `http://localhost:3002` no browser
2. Faça login com o email/senha gerados
3. **O modal "Defina sua senha" deve aparecer** — preencha uma nova senha
4. Após confirmar, você está dentro do painel como admin da barbearia

### 3. Verificar o estado completo via API

```bash
# Copie o JWT exibido pelo script e use:
TOKEN="<cole aqui>"

# Perfil + barbearia(s) do tenant
curl -s http://localhost:3003/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .

# Barbershop slug (para booking público)
curl -s http://localhost:3003/api/public/<slug> | jq .name
```

### 4. Limpar o tenant de teste

```bash
# Remove o perfil — ON DELETE CASCADE remove barbershop, serviços e dados vinculados
PGPASSWORD=navalhia_secret psql -h localhost -p 5432 -U navalhia -d navalhia \
  -c "DELETE FROM public.profiles WHERE email = 'dono@central.com';"
```

---

## Caminho B — Fluxo real com Stripe CLI

Para validar o fluxo completo (landing → pagamento → webhook → `/onboarding`).

### 1. Abrir o Stripe CLI listener

```bash
stripe listen --forward-to localhost:3003/api/billing/webhook
```

Copie o `whsec_...` exibido e atualize no `.env`:
```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```
Reinicie a API (`docker compose restart api`) para carregar o novo secret.

### 2. Acessar a landing e fazer checkout

1. Abra `http://localhost:3002` (ou a landing se rodar separada)
2. Clique em **Assinar agora**, escolha o plano
3. Preencha o formulário: nome da barbearia, e-mail, telefone
4. No Stripe Checkout (modo test), use o cartão: `4242 4242 4242 4242` / `12/34` / `123`
5. Conclua o pagamento

### 3. Verificar o webhook e o provisionamento

No terminal do `stripe listen`, você verá:
```
--> checkout.session.completed [evt_xxx]
<-- [200] POST http://localhost:3003/api/billing/webhook
```

Na API (logs do Docker):
```bash
docker compose logs api --tail=30
# Procure: "[billing] Provisioned barbershop..."
```

### 4. Acessar via `/onboarding`

O Stripe redireciona para `APP_URL/onboarding?session_id=...`.

Em dev, `APP_URL=http://localhost:3002`, então acesse diretamente:
```
http://localhost:3002/onboarding?session_id=<id-da-sessão-stripe>
```

A página de onboarding chama `GET /api/billing/session?session_id=...` que:
- Localiza a barbershop pelo `stripe_customer_id`
- Retorna um JWT de acesso direto (sem senha)
- Exibe e-mail, senha temporária e passos para configurar

### 5. Simular o evento sem fazer checkout real

```bash
# Dispara um checkout.session.completed sintético (útil para testar o handler)
stripe trigger checkout.session.completed
```

> Atenção: o evento sintético não tem os `metadata` (barbershop_name, phone, etc.). Para testar a provisão completa, faça um checkout real em modo test.

---

## Caminho C — Multi-filial (adicionar branch a tenant existente)

```bash
# 1. Crie o primeiro tenant (Caminho A)
./scripts/simulate-onboarding.sh --email "admin@rede.com" --nome "Rede Barber - Unidade Centro" --keep

# 2. Adicione uma segunda filial via SQL
PGPASSWORD=navalhia_secret psql -h localhost -p 5432 -U navalhia -d navalhia <<'SQL'
DO $$
DECLARE
  v_account_id UUID;
  v_shop2_id   UUID;
BEGIN
  SELECT account_id INTO v_account_id
  FROM public.barbershops
  WHERE slug = 'rede-barber-unidade-centro';

  INSERT INTO public.barbershops (account_id, name, slug, billing_plan, subscription_status)
  VALUES (v_account_id, 'Rede Barber - Zona Sul', 'rede-barber-zona-sul', 'pro', 'active')
  RETURNING id INTO v_shop2_id;

  RAISE NOTICE 'Segunda filial criada: % (id: %)', 'rede-barber-zona-sul', v_shop2_id;
END $$;
SQL

# 3. Logar com admin@rede.com → seletor de unidade deve exibir as 2 filiais
```

---

## Checklist de validação do onboarding

Após qualquer um dos caminhos acima, valide estes pontos:

```bash
TOKEN="<jwt do tenant>"

# 1. /me retorna must_change_password = true
curl -s http://localhost:3003/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .must_change_password

# 2. Troca de senha funciona
curl -s -X POST http://localhost:3003/api/auth/first-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"new_password":"NovaSenha@456"}' | jq .

# 3. Login com a nova senha
curl -s -X POST http://localhost:3003/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dono@central.com","password":"NovaSenha@456"}' | jq .token

# 4. Serviços provisionados
curl -s http://localhost:3003/api/services \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
# Esperado: 3

# 5. Booking público (slug da barbearia)
curl -s http://localhost:3003/api/public/<slug> | jq .name
```

---

## Cenários de erro e como depurar

| Sintoma | Causa provável | Solução |
|---|---|---|
| `Email "x" já existe` | Script rodado duas vezes com mesmo email | Delete o perfil (ver seção Limpar) ou use email diferente |
| `Login: Invalid email or password` | API não refletiu o perfil novo | Cheque `docker compose logs api` |
| `must_change_password` não aparece no modal | Frontend não lê o campo do `/me` | Confirme que `must_change_password: true` vem no `/me` |
| Slug duplicado | Nome igual ao de outra barbershop | O script auto-incrementa (`nome-1`, `nome-2`, …) |
| Stripe webhook: `Invalid signature` | `STRIPE_WEBHOOK_SECRET` desatualizado | Copie o `whsec_` novo do `stripe listen` e reinicie a API |
| Onboarding page em branco | `APP_URL` não aponta para `http://localhost:3002` | Confirme `APP_URL` no `.env` |

---

## Referência rápida de endpoints de onboarding

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/api/billing/checkout` | Cria sessão Stripe + redirect |
| `GET` | `/api/billing/session?session_id=` | Troca session_id por JWT (pós-pagamento) |
| `POST` | `/api/auth/login` | Login com email/senha |
| `GET` | `/api/auth/me` | Perfil + barbershops do token |
| `POST` | `/api/auth/first-password` | Define nova senha (sem exigir senha atual) |
| `POST` | `/api/auth/change-password` | Troca senha (exige senha atual) |
| `POST` | `/api/auth/forgot-password` | Envia link de redefinição por e-mail |
