# TestSprite MCP — relatório consolidado (frontend + backend)

## 1️⃣ Document Metadata

| Campo | Valor |
|--------|--------|
| Projeto | barber-harmony (NavalhIA) |
| Data da execução | 2026-04-13 |
| Ferramenta | TestSprite MCP (`generateCodeAndExecute`) |
| Ambiente frontend | Vite dev em `http://localhost:3002` (execução 1) |
| Ambiente backend | API Express em `http://localhost:3000` com `/health` OK (execução 2) |
| Nota | `testsprite_tests/tmp/raw_report.md` reflete **somente a última execução** (backend). Este arquivo consolida **duas** rodadas. |

---

## 2️⃣ Requirement Validation Summary

### R1 — Autenticação admin (`/api/auth/login`)

| Caso | Tipo | Resultado | Evidência |
|------|------|-----------|-----------|
| TC001 — login válido/inválido | Backend | Falhou | Teste usa `admin@example.com` / `correct_password`. Resposta **401** — usuário não existe no Postgres local. |
| TC003–TC010 (fluxos autenticados) | Backend | Falhou em cadeia | Todos dependem de JWT obtido no login; **401** na origem impede o restante. |

**Análise:** não é regressão da API por si só: os scripts gerados assumem credenciais de exemplo. É necessário **usuário seed** no banco local ou **variáveis de ambiente / secrets do TestSprite** com e-mail e senha reais de teste (sem commitar).

### R2 — Onboarding “API”

| Caso | Tipo | Resultado | Evidência |
|------|------|-----------|-----------|
| TC002 — `POST http://localhost:3000/onboarding` | Backend | Falhou (**404**) | Neste repositório, **onboarding é rota do SPA** (`/onboarding` no Vite), não um endpoint REST na raiz da API. O fluxo de provisionamento passa por **billing/Stripe** e rotas em `backend/src/routes/billing.ts` / conta, não por `POST /onboarding` no servidor. |

**Análise:** o caso é **mal alinhado ao desenho atual**. Ajustar o plano para endpoints reais (ex.: rotas de billing/session conforme o produto) ou tratar onboarding apenas como **teste E2E no browser**.

### R3 — CRUD e regras de negócio (barbeiros, serviços, clientes, agenda, fidelidade)

| Caso | Tipo | Resultado | Evidência |
|------|------|-----------|-----------|
| TC004–TC008 | Backend | Falhou | 401 / token inválido após tentativa de login com placeholders. |

**Análise:** mesma causa raiz que R1 — falta **dados e credenciais de teste** no ambiente que o TestSprite usa.

### R4 — WhatsApp / inbox

| Caso | Tipo | Resultado | Evidência |
|------|------|-----------|-----------|
| TC009–TC010 | Backend | Falhou | `Invalid email or password` no login. |

**Análise:** dependência de R1; além disso, fluxos completos de bot exigem **Uazapi**, filas de IA e eventualmente n8n — fora do escopo de um smoke HTTP com credenciais fictícias.

### R5 — UI E2E (plano frontend, execução 1)

| Caso | Tipo | Resultado | Evidência |
|------|------|-----------|-----------|
| TC001–TC013 (Playwright gerado) | Frontend | **BLOCKED** (13/13) | Relatório anterior: viewport em branco, **0 elementos interativos** em `/` e `/login` quando o runner remoto acessa via **túnel** TestSprite. |

**Análise provável (combinação):**

1. **Modo dev + carga concorrente:** o próprio TestSprite recomenda **`npm run build` + `vite preview`** para estabilidade; o dev server é single-thread e pode falhar sob vários testes paralelos.
2. **Túnel / origem:** o runner na nuvem pode não reproduzir o mesmo comportamento que o browser local (HMR, `@vite/client`, timing). Tela branca costuma indicar **JS não hidratou** ou recurso bloqueado.
3. **Scripts gerados:** vários trechos pulam login e assertam texto (“Active”, “Test Service”) incompatível com o fluxo real — mesmo com UI carregando, falhariam depois.

---

## 3️⃣ Coverage & Matching Metrics

| Área | Casos | Passaram | Falharam / bloqueados |
|------|-------|----------|------------------------|
| Backend (última execução) | 10 | 0 | 10 (falha) |
| Frontend (primeira execução) | 13 | 0 | 13 (bloqueado) |
| **Total** | **23** | **0** | **23** |

Taxa de sucesso global: **0%** — majoritariamente por **pré-condições de ambiente e dados**, não por lista verificada de bugs de produto.

---

## 4️⃣ Key Gaps / Risks

1. **Credenciais e seed:** sem usuário válido no banco alinhado aos testes gerados, qualquer plano backend que comece em `/api/auth/login` falhará sempre. Mitigar: script `seed` de usuário `test@...` documentado, ou injeção segura de credenciais no TestSprite (não versionadas).
2. **Desenho API vs PRD legado:** `POST /onboarding` na API não existe; risco de **falsos negativos** até o PRD/planos TestSprite refletirem o fluxo real (Stripe + páginas React).
3. **E2E via TestSprite + Vite dev:** alto risco de **tela branca** no túnel. Mitigar: **`vite preview`** em modo produção, `serverMode: production` no execute, e validar com um smoke manual em `http://localhost:3002/login` pelo túnel (se exposto).
4. **Segurança:** o CLI TestSprite pode gravar **API keys** em `testsprite_tests/tmp/config.json`. O arquivo foi adicionado ao **`.gitignore`**; se algo foi commitado antes, **rotacione** a chave no painel TestSprite.
5. **Testes locais já existentes:** o repositório tem **Vitest** no backend (`backend/src/__tests__`) e **Playwright** no front — para CI confiável, priorizar esses com **mocks/fixtures** antes de depender só do TestSprite.

---

## Próximos passos recomendados (ordem prática)

1. Criar usuário de teste no ambiente local (ou documentar o existente) e reexecutar **backend** com credenciais configuradas no TestSprite.
2. Ajustar ou regenerar casos que chamem `POST /onboarding` na API para rotas reais ou mover para E2E.
3. Para **frontend** no TestSprite: `npm run build && npx vite preview --port 3002 --host` e reexecutar com `serverMode: production`.
4. Manter `testsprite_tests/tmp/config.json` fora do Git (já ignorado) e usar variáveis de ambiente para secrets.
