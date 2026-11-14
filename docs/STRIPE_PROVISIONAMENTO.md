# Provisionamento pelo Stripe: idempotência e regra do e-mail

## Evento (webhook `/api/billing/webhook`)
- Reivindicação atômica: `INSERT … ON CONFLICT (event_id) DO UPDATE … WHERE processed_at IS NULL AND received_at < now() - lease RETURNING` (`processStripeEventOnce`). Só uma entrega concorrente processa; as outras recebem `duplicate` (200) ou `in_progress` (409, o Stripe reenvia).
- `processed_at` só depois do sucesso. Falha do handler → a linha é liberada (DELETE) e o reenvio processa de novo. Erro ao gravar `processed_at` sobe (500).
- Lease de 5 min cobre processo que morreu no meio. Tabela `stripe_events` ausente é o único caso que segue sem idempotência (com aviso).
- `checkout.session.completed` e `checkout.session.async_payment_succeeded` só provisionam com `payment_status` `paid` ou `no_payment_required`. Se for habilitar boleto/Pix no Stripe, assine também `checkout.session.async_payment_succeeded` (e `async_payment_failed`) no endpoint; com só cartão nada muda.

## Tenant (`provisionFromCheckoutSession`)
Serializado por `pg_advisory_xact_lock` (cliente Stripe → e-mail → slug, nessa ordem). Índice único parcial em `barbershops(stripe_customer_id)`.
1. Mesmo `stripe_customer_id` → mesmo tenant (reentrega, fallback de `/billing/session`); assinatura nova do mesmo cliente atualiza assinatura/plano e reativa.
2. Senão, e-mail já existente em `profiles` (índice único global):
   - barbearia com cliente Stripe cuja assinatura terminou (`canceled`/`unpaid`/`incomplete_expired`) → **reativa**: vincula o novo cliente, grava plano/assinatura/status. Sem perfil novo, sem senha nova, sem e-mail de boas-vindas.
   - qualquer outro caso (assinatura viva de outro cliente, tenant sem cliente Stripe, e-mail de outro tenant) → **não vincula**; grava `billing_manual_reviews`, loga `[REVISAO_MANUAL]` e responde 200.
3. Sem match → cria conta, barbearia, perfil admin, chave de API (como antes).

Por quê: o e-mail do formulário não prova posse. Vincular o novo pagador ao tenant de outra pessoa, somado à troca de `session_id` por JWT, entregaria a conta alheia. Por isso `GET /billing/session` só emite JWT quando esta compra **criou** o perfil (existe `checkout_onboarding`); em reativação responde 409 `login_required`.

Conferência: `SELECT * FROM public.billing_manual_reviews WHERE resolved_at IS NULL;`

## Migrations (aplicar em ordem; Neon develop primeiro)
- `20261114000000_barbershops_stripe_customer_unique.sql`: pré-checagem que **falha com mensagem clara** se houver `stripe_customer_id` duplicado (não apaga nada); depois o índice.
- `20261114000100_billing_manual_reviews.sql`: tabela de revisão manual (RLS ligado, sem policies).
