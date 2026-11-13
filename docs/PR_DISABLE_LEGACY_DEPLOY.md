# Deploy legado desativado + role OIDC estreitado (texto para o corpo do PR)

## O que muda
1. `.github/workflows/deploy.yml`: sem gatilho `push` na `main`; só `workflow_dispatch` com confirmação digitada ("legado"). Teste: `backend/src/__tests__/legacy-deploy-disabled.test.ts`.
2. **Proposta, não aplicada:** `infra/ci/oidc-github-role.yaml` deixa de confiar em `repo:<repo>:*` (qualquer branch, tag ou `pull_request` do repositório assumia o role de deploy) e passa a exigir `StringEquals` em `repo:<repo>:ref:<GitHubRef>` (padrão `refs/heads/main`). O parâmetro `GitHubRef` já existia, mas não era usado.
   - Efeito: um `workflow_dispatch` rodado a partir de outra branch **deixa de conseguir** assumir o role (intencional).
   - Se algum job passar a usar `environment:`, o `sub` muda para `repo:<repo>:environment:<nome>`; ajustar a condição.
   - Aplicar só no ambiente legado, **pelo dono**: `aws cloudformation deploy --stack-name navalhia-ci --template-file infra/ci/oidc-github-role.yaml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides GitHubRepo=OWNER/REPO`. Nada foi aplicado, nem plan, nem AWS.

## Ações MANUAIS do dono (não dá para fazer por código)
Segredos do repositório (GitHub → Settings → Secrets and variables → Actions) que só o `deploy.yml` legado usa. **Revogar/apagar**:

| Segredo | Observação |
|---|---|
| `AWS_ROLE_ARN` | role da conta antiga (us-east-1); apagar o segredo e, se a conta antiga não for mais usada, a stack `navalhia-ci` (role `navalhia-github-deploy` + OIDC provider) |
| `ARTIFACT_BUCKET` | bucket de artefatos da conta antiga |
| `DATABASE_URL` | **rotacionar a senha no banco** se o valor for (ou foi) o de produção atual |
| `JWT_SECRET` | rotacionar se igual ao de produção (invalida sessões) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | revogar/rolar a chave no painel da Stripe se for a chave live em uso |
| `FROM_EMAIL`, `APP_URL` | não são sensíveis; apagar para não induzir erro |

Variáveis (não secretas) só do legado: `CORS_ORIGIN`, `JWT_EXPIRES_IN`.

**Manter**: `VITE_API_URL` (o `ci.yml` usa, com fallback; é um valor público).

Depois de revogar, confirmar em Settings → Actions que nenhum workflow ativo referencia os segredos removidos (`grep -rn "secrets\." .github/workflows`).
Também revisar: Settings → Actions → General → "Workflow permissions" (somente leitura) e se há *deploy keys*/*PATs* antigos.
