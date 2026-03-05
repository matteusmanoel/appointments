# Próximos ajustes (backlog pós-deploy)

Itens mapeados após o redeploy da API + workers e testes e2e (smoke). Executar numa próxima sessão conforme prioridade.

---

## Feito nesta sessão

- **Deploy API:** Corrigido script `scripts/aws/deploy-api.sh`: verificação do zip antes do upload, retry do upload S3 (3 tentativas, 15 s entre elas), timeouts maiores (`--cli-connect-timeout 60`, `--cli-read-timeout 120`) para reduzir falhas por rede.
- **Redeploy:** Executado com sucesso; API e workers (worker-ai, worker-scheduled) atualizados no stack `navalhia-api-prod`.
- **E2E:** Smoke (`e2e/smoke.spec.ts`) executado contra produção; 2 testes passando (landing + login).
- **Verificação:** `https://api.navalhia.com.br/health` e `https://app.navalhia.com.br/` retornando 200.

---

## Ajustes recomendados (próxima execução)

### Build e frontend

1. **Browserslist desatualizado**  
   Aviso no build: "browsers data (caniuse-lite) is 8 months old".  
   **Ação:** Rodar `npx update-browserslist-db@latest` na raiz e no backend (se aplicável).

2. **Chunk size (Vite)**  
   Aviso: "Some chunks are larger than 500 kB after minification".  
   **Ação:** Avaliar code-split com `import()` ou `manualChunks` em `vite.config.ts` para reduzir o bundle principal (ex.: `index-*.js` ~1,4 MB).

### Testes e2e

3. **E2E contra produção de forma explícita**  
   Smoke foi rodado com `PLAYWRIGHT_BASE_URL=https://app.navalhia.com.br`; o config não inicia webServer quando não está em CI.  
   **Ação:** Documentar no `e2e/README.md` ou no `playwright.config.ts` o comando para smoke em prod:  
   `PLAYWRIGHT_BASE_URL=https://app.navalhia.com.br npx playwright test e2e/smoke.spec.ts`

4. **Teste E2E do checkout (Stripe)**  
   Smoke não cobre o fluxo de checkout.  
   **Ação:** Criar cenário e2e opcional para "abrir modal de checkout e verificar redirecionamento ou formulário" (sem concluir pagamento real), ou marcar como teste manual no checklist de release.

### Infra e operação

5. **Upload S3: path no log**  
   O AWS CLI ainda exibe `../dist.zip` no log de conclusão do upload (path relativo na mensagem). O script já usa path absoluto; é cosmético.  
   **Ação:** Opcional — fazer `cd "$REPO_ROOT"` antes do `aws s3 cp` e usar `./dist.zip` para o log mostrar path consistente.

6. **Workers Lambda: validação pós-deploy**  
   Confirmar no console AWS (CloudWatch Logs) que as funções `navalhia-worker-ai-prod` e `navalhia-worker-scheduled-prod` estão sendo invocadas pelos schedules e que não há erros recorrentes (ex.: timeout, falta de OPENAI_API_KEY).

### Documentação

7. **RUNBOOK / manual de deploy**  
   Atualizar RUNBOOK ou checklist de deploy com: (a) variáveis obrigatórias para workers (OPENAI_API_KEY se usar IA); (b) comando de smoke e2e contra prod; (c) link para este backlog.

---

## Referências

- Deploy API: `./scripts/aws/deploy-api.sh`
- Smoke E2E (prod): `PLAYWRIGHT_BASE_URL=https://app.navalhia.com.br npx playwright test e2e/smoke.spec.ts`
- Workers: `docs/WORKERS.md`, `docs/WORKERS_DEPLOY_ECONOMICO.md`
