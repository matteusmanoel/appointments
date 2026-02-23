# Screenshots para a Landing

Imagens usadas na seção "Produto em ação" da landing:

- **whatsapp-demo.png** — captura do modal de demo do chat (cliente agendando).
- **dashboard.png** — captura do painel NavalhIA (agenda/visão do dia). Se não existir, a landing exibe placeholder.

## Gerar screenshots com Playwright

Com o frontend rodando em `http://localhost:3002` (e, para dashboard, a API + login funcionando):

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test e2e/capture-screenshots.spec.ts --project=chromium --timeout=60000
```

- **dashboard.png**: requer login (admin@navalhia.com.br / admin123) e API ativa.
- **whatsapp-demo.png**: usa a landing sem login; abre o modal "Testar demo agora" e captura o diálogo.

Recomendado: 4:3 ou 16:10, PNG. Se os arquivos não existirem, a landing exibe placeholders com ícones.
