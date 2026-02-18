# Runbook — Operação e venda (MVP)

Checklist e procedimentos para colocar o Barber Harmony em produção e abrir vendas.

---

## 1. CORS

- **Antes de vender**: restrinja origens em produção.
- No deploy da API, defina `CorsOrigin` com a URL do front (ex.: `https://d123.cloudfront.net`).
- Se tiver domínio: `https://app.seudominio.com,https://seudominio.com`.
- Nunca use `*` em produção quando o front usar credenciais (cookies/Authorization).
- O backend lê `CORS_ORIGIN` (lista separada por vírgula) e o API Gateway está configurado no stack; para HTTP API o CORS é tratado pelo Lambda, então o valor no env é o que vale.

---

## 2. Rate limit

- A API aplica **express-rate-limit**: 120 requisições por minuto por IP (exceto `POST /api/billing/webhook`).
- Ajuste em `backend/src/app.ts` (`windowMs`, `max`) se precisar.
- Para limites por tenant (por API key), considerar middleware adicional no futuro.

---

## 3. Alarmes (CloudWatch)

- O stack da API (`infra/api/stack.yaml`) cria dois alarmes:
  - **Lambda errors**: mais de 5 erros em 1 minuto.
  - **Lambda duration**: duração média > 25 s em 2 períodos de 1 minuto.
- Opcional: parâmetro `AlarmEmail` no stack para criar tópico SNS e enviar notificações por email (requer confirmação do email na AWS).
- Consulte alarmes no console: CloudWatch → Alarmes.

---

## 4. AWS Budgets

- Crie um orçamento no console: **Billing → Budgets → Create budget**.
- Sugestão MVP: budget mensal (ex.: USD 50) com alertas em 80% e 100%.
- Configure alertas por email para não ter surpresas de custo.

---

## 5. Backups (Supabase)

- Supabase gerencia backups conforme o plano (ver documentação do plano).
- Confirme no painel do Supabase: **Project Settings → Database** (backups automáticos / point-in-time recovery).
- Para dump manual (opcional): use `pg_dump` com a `DATABASE_URL` em ambiente seguro e armazene o resultado em local seguro.

---

## 6. Deploy

- **API**: `./scripts/aws/deploy-api.sh` (exige `ARTIFACT_BUCKET`, `DATABASE_URL`, `JWT_SECRET` no `.env`; opcional Stripe/SES).
- **Static**: `./scripts/aws/deploy-static.sh` (usa ou cria o stack `barber-harmony-static-prod`; defina `VITE_API_URL` para o build).
- **CI/CD**: push na `main` dispara o workflow em `.github/workflows/deploy.yml` (requer OIDC role e secrets configurados).

---

## 7. Checklist antes de abrir vendas

- [ ] CORS restrito à URL do front (não usar `*`).
- [ ] Rate limit ativo (padrão 120 req/min).
- [ ] Alarmes CloudWatch criados (e opcionalmente SNS/email).
- [ ] Budget AWS configurado com alertas.
- [ ] Backups do Supabase conferidos.
- [ ] API keys por barbearia e webhook de billing testados.
- [ ] Docs públicas (OpenAPI/Redoc) publicadas em `/docs/` no CloudFront.
- [ ] Fluxo de onboarding (checkout → webhook → email com senha temporária e API key) testado de ponta a ponta.
