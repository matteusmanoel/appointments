# Aceite do aviso de risco do WhatsApp antes de pagar (lp-correcoes §16.2/§16.5, parecer B-05)

- **UI** (`src/components/CheckoutModal.tsx`, texto em `src/lib/whatsapp-risk-notice.ts`): no passo do plano, um checkbox resume o aviso e inclui o link «Termos de Uso». A caixa começa desmarcada. «Ir para pagamento» não fica desativado em silêncio; sem o aceite, o clique mostra a mensagem e não chama a API. A caixa volta a ser desmarcada ao fechar o modal.
- **Servidor** (`backend/src/routes/billing.ts`, rotas `/api/billing/checkout` e `/checkout_embedded`): sem `whatsapp_risk_accepted: true` → `400 {code: "whatsapp_risk_not_accepted"}` e nenhuma sessão do Stripe é criada.
- **Prova**: a sessão do Stripe recebe `metadata.whatsapp_risk_accepted_at` (ISO) e `metadata.whatsapp_risk_notice_version` (`2026-11-13b`). Mudou o texto do aviso → troque `WHATSAPP_RISK_NOTICE_VERSION` no front **e** em `billing.ts`.
- **Deploy**: publicar o front antes da API (a API antiga ignora o campo extra). Se precisar de janela, `CHECKOUT_REQUIRE_RISK_ACCEPTANCE=false` na API desliga a exigência (padrão `true`).
- **Fora do escopo**: o segundo aceite (Termos de Uso/Política de Privacidade) depende de os textos jurídicos existirem; o aceite que já existe no app (`ConnectTab`, depois da compra) continua. Não toca a copy da landing (B-01) nem o portal do Stripe.

## Aceite dentro de `validateCheckoutForm` e merge com `fix/ui-high` (#20)

- O botão «Ir para pagamento» **nunca fica desabilitado em silêncio**: o aceite faz parte de `validateCheckoutForm` (`src/lib/checkout-validation.ts`, campo `risk`, último em `CHECKOUT_FIELD_ORDER`). Ao clicar sem aceitar, a mensagem aparece sob a caixa (`role="alert"`), a caixa ganha borda de erro e recebe o foco (campo inválido anterior tem prioridade). O servidor continua exigindo o aceite.
- **Como evitar conflito com o #20 sem rebase:** `CheckoutModal.tsx`, `checkout-validation.ts`, `checkout-validation.test.ts`, `whatsapp-risk-notice.ts`, `CheckoutModal.risk-consent.test.tsx` e o trecho de `billingApi` em `api.ts` têm **conteúdo idêntico** nas duas branches (a versão final combinada dos dois PRs). O git trata alterações idênticas dos dois lados como uma só, então o merge sai limpo em qualquer ordem. Se um dos lados mudar esses arquivos de novo, aplique a mesma mudança no outro.
