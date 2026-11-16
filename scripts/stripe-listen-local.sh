#!/usr/bin/env bash
# Encaminha para a API local só os eventos que o handler de billing trata.
# A CLI 1.55 exige --events (ou --all-snapshot). O signing secret é estável
# entre reinícios do listen na mesma conta; o valor fica em STRIPE_WEBHOOK_SECRET.
set -euo pipefail

forward_to="${STRIPE_FORWARD_URL:-localhost:3003/api/billing/webhook}"

exec stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_succeeded,invoice.payment_failed \
  --forward-to "$forward_to"
