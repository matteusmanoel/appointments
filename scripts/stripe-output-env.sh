#!/usr/bin/env bash
# Gera as linhas de STRIPE_PRICE_ID_* para você colar no .env ou usar com cat.
# Uso: substitua os price_xxx pelos IDs reais (do Stripe Dashboard ou da saída do stripe prices create) e depois:
#   ./scripts/stripe-output-env.sh
#   ./scripts/stripe-output-env.sh >> .env   # para acrescentar ao .env (revise antes)
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Substitua pelos seus Price IDs (Stripe Dashboard → Products → cada preço)
STRIPE_PRICE_ID_ESSENTIAL="${STRIPE_PRICE_ID_ESSENTIAL:-price_xxx}"
STRIPE_PRICE_ID_PRO="${STRIPE_PRICE_ID_PRO:-price_xxx}"
STRIPE_PRICE_ID_PREMIUM="${STRIPE_PRICE_ID_PREMIUM:-price_xxx}"
STRIPE_PRICE_ID_EXTRA_NUMBER="${STRIPE_PRICE_ID_EXTRA_NUMBER:-price_xxx}"

echo "# Stripe Price IDs (gerado por scripts/stripe-output-env.sh)"
echo "STRIPE_PRICE_ID_ESSENTIAL=$STRIPE_PRICE_ID_ESSENTIAL"
echo "STRIPE_PRICE_ID_PRO=$STRIPE_PRICE_ID_PRO"
echo "STRIPE_PRICE_ID_PREMIUM=$STRIPE_PRICE_ID_PREMIUM"
echo "STRIPE_PRICE_ID_EXTRA_NUMBER=$STRIPE_PRICE_ID_EXTRA_NUMBER"
echo ""
echo "# Para acrescentar ao .env, defina os IDs e rode:"
echo "#   STRIPE_PRICE_ID_ESSENTIAL=price_1xxx STRIPE_PRICE_ID_PRO=price_2xxx STRIPE_PRICE_ID_PREMIUM=price_3xxx STRIPE_PRICE_ID_EXTRA_NUMBER=price_4xxx ./scripts/stripe-output-env.sh | grep -v '^#' | grep -v '^$' >> .env"
