# Aceite do aviso de risco do WhatsApp antes de pagar (lp-correcoes §16.2/§16.5, parecer B-05)

- **UI** (`src/components/CheckoutModal.tsx`, texto em `src/lib/whatsapp-risk-notice.ts`): o aviso aparece na íntegra com a caixa «Li e aceito este aviso.», desmarcada por padrão. «Ir para pagamento» fica desativado sem o aceite; forçar o submit mostra a mensagem e não chama a API. A caixa volta a ser desmarcada ao fechar o modal.
- **Servidor** (`backend/src/routes/billing.ts`, rotas `/api/billing/checkout` e `/checkout_embedded`): sem `whatsapp_risk_accepted: true` → `400 {code: "whatsapp_risk_not_accepted"}` e nenhuma sessão do Stripe é criada.
- **Prova**: a sessão do Stripe recebe `metadata.whatsapp_risk_accepted_at` (ISO) e `metadata.whatsapp_risk_notice_version` (`2026-11-13`). Mudou o texto do aviso → troque `WHATSAPP_RISK_NOTICE_VERSION` no front **e** em `billing.ts`.
- **Deploy**: publicar o front antes da API (a API antiga ignora o campo extra). Se precisar de janela, `CHECKOUT_REQUIRE_RISK_ACCEPTANCE=false` na API desliga a exigência (padrão `true`).
- **Fora do escopo**: o segundo aceite (Termos de Uso/Política de Privacidade) depende de os textos jurídicos existirem; o aceite que já existe no app (`ConnectTab`, depois da compra) continua. Não toca a copy da landing (B-01) nem o portal do Stripe.
