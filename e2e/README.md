# E2E (Playwright)

Smoke tests do fluxo mínimo. Requer o app rodando (front), exceto quando se aponta para produção ou staging.

## Rodar localmente

1. Em um terminal: `npm run dev` (ou `npm run build && npm run preview -- --port 3002`).
2. Em outro: `npx playwright install chromium` (só na primeira vez) e `npm run test:e2e`.

Ou com base URL customizada: `PLAYWRIGHT_BASE_URL=http://localhost:3002 npm run test:e2e`.

**Testes locais completos (gate antes de subir):**

- Backend: `cd backend && npm ci && npx tsc && npm test`
- Front + E2E: `CI=1 npx playwright test e2e/smoke.spec.ts e2e/debug-prod.spec.ts` (sobe o preview automaticamente)
- Checkout route (exige API em `http://localhost:3003`): `PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test e2e/checkout-route.spec.ts`

## Rodar contra produção

Smoke contra o app em produção (não inicia servidor local):

```bash
PLAYWRIGHT_BASE_URL=https://app.navalhia.com.br npx playwright test e2e/smoke.spec.ts
```

## Rodar contra staging

Com staging deployado (ver `docs/STAGING.md`), use a URL do CloudFront do static (ou `staging.app.navalhia.com.br` se domínio custom estiver configurado) e a URL da API de staging para o teste de checkout:

```bash
# Smoke + anti-tela-branca
PLAYWRIGHT_BASE_URL=https://<staging-app-url> npx playwright test e2e/smoke.spec.ts e2e/debug-prod.spec.ts

# Checkout route (API de staging)
PLAYWRIGHT_BASE_URL=https://<staging-app-url> E2E_API_URL=https://<staging-api-url> npx playwright test e2e/checkout-route.spec.ts
```

Substitua `<staging-app-url>` e `<staging-api-url>` pelos outputs dos stacks `navalhia-static-staging` (CloudFrontUrl) e `navalhia-api-staging` (ApiUrl).

**Nota:** Não rode `e2e/capture-screenshots.spec.ts` em produção: ele usa credenciais fixas e grava imagens no repo; use apenas em ambiente controlado (local/staging).

## CI

Com `CI=true`, o Playwright sobe o app automaticamente (`npm run build && vite preview --port 3002`) antes dos testes.
