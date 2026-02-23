# Checkout com formulário de lead

Fluxo: lead preenche o formulário na landing → API cria sessão Stripe (Checkout) → cliente paga → redirect para `/onboarding` com senha temporária e tutorial.

## O que foi implementado

- **Landing**: landing de conversão com seções (hero, dor, como funciona, demo, planos, FAQ) + formulário de checkout com seleção de plano (Essencial, Profissional, Premium).
- **Checkout embutido**: Stripe Embedded Checkout renderizado no modal da landing (sem redirecionar), com fallback para redirect.
- **Backend**: `POST /api/billing/checkout` (redirect) e `POST /api/billing/checkout_embedded` (retorna `client_secret` para embedded). Ambos aceitam `plan` (essential|pro|premium) e `extra_numbers` (opcional, 0–20; add-on de número extra WhatsApp para Pro/Premium). `GET /api/billing/session?session_id=xxx` retorna credenciais de onboarding uma vez.
- **Webhook**: usa `metadata` (barbershop_name, cnpj, phone, contact_name) ao criar barbershop e perfil; grava senha temporária em `checkout_onboarding` para a página de sucesso.
- **Onboarding**: página `/onboarding?session_id=...` exibe e-mail, senha temporária (uma vez) e passos (alterar senha, configurar NavalhIA, barbeiros, integrações).

## Configuração necessária

### 1. Migração no banco (Supabase)

Rode a migração que adiciona `cnpj` em `barbershops` e a tabela `checkout_onboarding`:

```bash
# Supabase CLI (se configurado)
supabase db push

# Ou execute manualmente no SQL Editor do Supabase o conteúdo de:
# supabase/migrations/20260218140000_add_cnpj_and_checkout_onboarding.sql
```

### 2. Stripe: Price IDs e chave pública

- No Stripe Dashboard: **Products** → crie produtos para cada plano (Essencial, Profissional, Premium) → adicione **Price** recorrente em cada.
- Copie os **Price ID** (começa com `price_...`).
- No `.env` (backend):

```env
STRIPE_PRICE_ID=price_xxx          # fallback se planos individuais não definidos
STRIPE_PRICE_ID_ESSENTIAL=price_xxx
STRIPE_PRICE_ID_PRO=price_xxx
STRIPE_PRICE_ID_PREMIUM=price_xxx
STRIPE_PRICE_ID_EXTRA_NUMBER=price_xxx   # add-on número extra WhatsApp (R$ 39/mês); recorrente mensal
```

- Para o checkout embutido, defina a chave pública no `.env` (usada no build do front):

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxx   # ou pk_live_ em produção
```

### 3. APP_URL para redirect pós-pagamento

O redirect após o pagamento (Stripe success_url) deve apontar para o seu front:

```env
APP_URL=https://d1xyhqiaa9ab5t.cloudfront.net
```

Domínio em uso: **navalhia.com.br** → `APP_URL=https://app.navalhia.com.br`. E-mail (SES): verificar domínio e usar `FROM_EMAIL=no-reply@navalhia.com.br` (ver `docs/SES_NAVALHIA_DOMAIN.md`).

### 4. Redeploy

- API: após definir `STRIPE_PRICE_ID`, `APP_URL` e (opcional) `STRIPE_PRICE_ID_*` no `.env`:

```bash
./scripts/aws/deploy-api.sh
```

- Front: para checkout embutido e botão WhatsApp, defina `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_SALES_WHATSAPP_NUMBER`, `VITE_SALES_WHATSAPP_MESSAGE` e rode:

```bash
./scripts/aws/deploy-static.sh
```

## Recorrência e verificação da empresa no Stripe

- **Recorrência**: o checkout está em `mode: "subscription"` e usa `STRIPE_PRICE_ID`; o webhook já trata `customer.subscription.updated` e `customer.subscription.deleted` para atualizar `subscription_status` na barbershop.
- **Verificação da empresa**: para receber pagamentos reais e recorrência em produção, conclua o processo de verificação da conta no Stripe (Dashboard → **Settings → Account**). Isso é independente do código.

## Fluxo resumido

1. Cliente acessa a landing e clica em **Começar agora** ou **Assinar agora**.
2. Abre o formulário: nome da NavalhIA, CNPJ (opcional), telefone, e-mail, nome do responsável (opcional).
3. **Confirmar e ir para pagamento** → `POST /api/billing/checkout` → redirect para Stripe Checkout.
4. Cliente paga no Stripe; Stripe dispara o webhook → backend cria barbershop, perfil (senha temporária, `must_change_password`), API key e grava em `checkout_onboarding`.
5. Stripe redireciona para `APP_URL/onboarding?session_id=...`.
6. Página de onboarding chama `GET /api/billing/session` → exibe e-mail e senha temporária (uma vez) + passos (alterar senha, configurar painel, integrações).
7. Cliente clica em **Ir para o painel** → `/login` → entra com e-mail e senha temporária → modal de troca de senha no primeiro acesso.

## Teste local com Stripe CLI (stripe listen)

Para testar o webhook de checkout em ambiente local (sem expor URL pública):

### 1. Instalar e autenticar o Stripe CLI

```bash
# macOS (Homebrew)
brew install stripe/stripe-cli/stripe

# Login (abre o browser)
stripe login
```

### 2. Encaminhar eventos para o backend local

Com o backend rodando (ex.: porta 3000):

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

O CLI exibe um **webhook signing secret** (começa com `whsec_...`). Use-o no `.env` do backend:

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
```

**Importante:** esse secret muda a cada execução de `stripe listen`. Ao reiniciar o comando, atualize o `STRIPE_WEBHOOK_SECRET` no `.env` e reinicie o backend.

### 3. Testar o fluxo

1. Abra a landing no front (ex.: `http://localhost:3002`), clique em **Assinar** e preencha o formulário (plano, opcionalmente números extras).
2. Conclua o pagamento no Stripe (cartão de teste: `4242 4242 4242 4242`).
3. No terminal onde rodou `stripe listen`, confira o evento `checkout.session.completed`.
4. Verifique que o backend provisionou barbershop e perfil e que a página `/onboarding?session_id=...` exibe as credenciais.

### 4. Criar/confirmar Prices no Stripe

Se ainda não tiver os Price IDs:

- **Dashboard**: Stripe Dashboard → **Products** → crie produtos (Essencial, Profissional, Premium, Número extra) e adicione um **Price** recorrente mensal em BRL a cada um.
- **CLI** (opcional): use `stripe products create` e `stripe prices create` para gerar os prices; depois preencha as variáveis `STRIPE_PRICE_ID_*` no `.env`.

Exemplo de variáveis necessárias para o checkout com add-on:

- `STRIPE_PRICE_ID_ESSENTIAL`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_PREMIUM`
- `STRIPE_PRICE_ID_EXTRA_NUMBER` (recomendado R$ 39/mês para número extra WhatsApp)
