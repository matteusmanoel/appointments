# E2E (Playwright)

Smoke tests do fluxo mínimo. Requer o app rodando (front).

## Rodar localmente

1. Em um terminal: `npm run dev` (ou `npm run build && npm run preview -- --port 3002`).
2. Em outro: `npx playwright install chromium` (só na primeira vez) e `npm run test:e2e`.

Ou com base URL customizada: `PLAYWRIGHT_BASE_URL=http://localhost:3002 npm run test:e2e`.

## CI

Com `CI=true`, o Playwright sobe o app automaticamente (`npm run build && vite preview --port 3002`) antes dos testes.
