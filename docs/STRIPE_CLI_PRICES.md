# Configurar preços no Stripe via CLI

Use os comandos abaixo para criar os produtos e preços recorrentes (BRL/mês) e obter os IDs para o `.env`.

**Pré-requisito:** [Stripe CLI](https://stripe.com/docs/stripe-cli) instalado e logado (`stripe login`). Use **Test mode** ou **Live mode** conforme o ambiente.

## 1. Criar produtos e preços (modo teste ou live)

Exporte a chave secreta e use o Stripe CLI. Para cada plano: crie o produto e depois o preço. A saída de cada comando mostra o `"id"` — use-o no próximo comando ou no `.env`.

```bash
export STRIPE_SECRET_KEY=sk_test_xxx   # ou sk_live_xxx

# 1) Essencial — R$ 97/mês
stripe products create --name "NavalhIA Essencial" -d "description=Painel + Link de agendamento" --api-key "$STRIPE_SECRET_KEY"
# Copie o "id" (prod_xxx) da saída e use no próximo comando no lugar de prod_ESSENTIAL
stripe prices create -d "product=prod_ESSENTIAL" -d "currency=brl" -d "unit_amount=9700" -d "recurring[interval]=month" --api-key "$STRIPE_SECRET_KEY"
# Copie o "id" (price_xxx) → STRIPE_PRICE_ID_ESSENTIAL

# 2) Profissional — R$ 197/mês
stripe products create --name "NavalhIA Profissional" -d "description=IA, lembretes e follow-ups" --api-key "$STRIPE_SECRET_KEY"
stripe prices create -d "product=prod_PRO" -d "currency=brl" -d "unit_amount=19700" -d "recurring[interval]=month" --api-key "$STRIPE_SECRET_KEY"
# → STRIPE_PRICE_ID_PRO

# 3) Premium — R$ 349/mês
stripe products create --name "NavalhIA Premium" -d "description=NavalhIA escalável" --api-key "$STRIPE_SECRET_KEY"
stripe prices create -d "product=prod_PREMIUM" -d "currency=brl" -d "unit_amount=34900" -d "recurring[interval]=month" --api-key "$STRIPE_SECRET_KEY"
# → STRIPE_PRICE_ID_PREMIUM

# 4) Número extra WhatsApp — R$ 39/mês
stripe products create --name "Número extra WhatsApp" -d "description=Número adicional" --api-key "$STRIPE_SECRET_KEY"
stripe prices create -d "product=prod_EXTRA" -d "currency=brl" -d "unit_amount=3900" -d "recurring[interval]=month" --api-key "$STRIPE_SECRET_KEY"
# → STRIPE_PRICE_ID_EXTRA_NUMBER
```

Substitua `prod_ESSENTIAL`, `prod_PRO`, etc. pelos IDs reais retornados por cada `stripe products create`.

## 2. Adicionar ao `.env`

Com os Price IDs em mãos (da saída dos comandos ou do Dashboard):

```bash
# Stripe Price IDs (substitua price_xxx pelos IDs reais)
STRIPE_PRICE_ID_ESSENTIAL=price_xxx
STRIPE_PRICE_ID_PRO=price_xxx
STRIPE_PRICE_ID_PREMIUM=price_xxx
STRIPE_PRICE_ID_EXTRA_NUMBER=price_xxx
```

Para acrescentar ao `.env` sem abrir o editor (substitua os `price_xxx` antes de rodar):

```bash
cat >> .env << 'ENVBLOCK'
STRIPE_PRICE_ID_ESSENTIAL=price_xxx
STRIPE_PRICE_ID_PRO=price_xxx
STRIPE_PRICE_ID_PREMIUM=price_xxx
STRIPE_PRICE_ID_EXTRA_NUMBER=price_xxx
ENVBLOCK
```

Ou edite o `.env` manualmente e adicione as linhas acima com os IDs corretos.

## 3. Variável de ambiente para os comandos

Para usar `--api-key` nos comandos, exporte a chave secreta do Stripe (modo teste ou live):

```bash
export STRIPE_SECRET_KEY=sk_test_xxx   # ou sk_live_xxx
```

Não commite essa variável; use-a só no terminal para rodar os comandos.

## 4. Conferir no Dashboard

Em [Stripe Dashboard → Products](https://dashboard.stripe.com/products) (test ou live) confira os produtos e os preços recorrentes em BRL. Os IDs aparecem ao clicar em cada preço.
