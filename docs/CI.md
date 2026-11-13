# CI (`.github/workflows/ci.yml`)

## O que roda
| Job | O que faz |
|---|---|
| `Test & Build (node 20)` | Postgres descartável (`pgvector/pgvector:pg16`, sem secrets) → `npx tsx scripts/run-all-migrations.ts` duas vezes (a 2ª deve ser no-op) → `npm test` com `DATABASE_URL` → `npm run build` → bundle das Lambdas + `verify-knowledge-zip` (quando os scripts existem no branch) → benchmark mock (não reprova). |
| `Test & Build (node 22)` | Igual, mas **não reprova** (`continue-on-error`): aviso antecipado de compatibilidade. |
| `Frontend (build & test)` | `npm ci`, `npm test`, `npm run build` na raiz. |
| `Terraform (fmt & validate, sem credenciais)` | `terraform fmt -check -recursive infra`, `init -backend=false`, `validate` em `infra/production` (Terraform 1.10.5). **Sem plan, sem apply, sem credenciais AWS.** |

Gatilhos: `pull_request` e `push` em `main`/`develop`, mais `workflow_dispatch`. `permissions: contents: read`, `concurrency` cancela runs antigas do mesmo ref, `timeout-minutes` em todos os jobs, `ubuntu-24.04` fixo.

## Por que o Postgres + `DATABASE_URL`
Sem `DATABASE_URL` os testes de banco (ex.: reaper do #19, trava de agendamento, opt-out) retornam cedo e **passam em 0 ms**: falso verde. Com o serviço, rodam de verdade. As migrations aplicam do zero na imagem com pgvector (`postgres:16` puro não tem a extensão `vector`).

## Node e runtime das Lambdas
O workflow usa Node 20 (e 22 como aviso). **O runtime das Lambdas continua `nodejs20.x`** (`infra/production/main.tf`) e **não foi alterado aqui**: a AWS marca `nodejs20.x` como depreciado, e a troca (para 22) é um PR de Terraform à parte, que precisa confirmar o binário `@napi-rs/canvas` do #8 no 22. O `deploy.yml` também segue em Node 20 (compila o zip que roda em `nodejs20.x`) e não foi tocado.

## Linha de base vermelha conhecida (NÃO corrigida neste PR)
Medido no `develop` @ `33bf413` com o banco do CI (migrations aplicadas do zero, sem seed e sem chaves):

| Teste | Falhas | Observação |
|---|---|---|
| `orchestrator-multi-intent.test.ts` | **2** (`resumes the offered pending intent on a bare yes after the transaction closed`, `clears a pending intent the client asks for directly`) | Já falham no `develop` puro, com ou sem banco (`expected { intents: ['plan'], offered: true } to deeply equal { intents: [], offered: false }`). |
| `agent-golden.test.ts` | **7** | Só falham **com** `DATABASE_URL` (sem banco são pulados): dependem de dados de seed (ids de serviço) que o banco vazio do CI não tem. |

Consequência: **o CI nasce vermelho** (9 testes) até alguém corrigir os 2 do orquestrador e semear/ajustar os 7 golden. O passo de teste **não** tem `continue-on-error` de propósito: marcar como não bloqueante recriaria o falso verde. Decisão do dono: corrigir esses testes em PR próprio, ou excluí-los explicitamente (com issue aberta) quando decidir.

Outros pontos conhecidos: `whatsapp-ai-routes` e `whatsapp-inbox-routes` oscilam sob carga quando a suíte inteira roda em paralelo (passam isoladas).

## Bloqueio externo
O job anterior falhou em 2 s sem executar nenhum step: "The job was not started because your account is locked due to a billing issue." Só o dono da conta resolve (GitHub → Settings → Billing) e reexecuta a run. Nada neste PR contorna isso.

## Checks obrigatórios (branch protection)
Os nomes dos jobs mudaram (`Test & Build (node 20)`, `Frontend (build & test)`, `Terraform (fmt & validate, sem credenciais)`). Se `main`/`develop` tiverem checks obrigatórios configurados com o nome antigo `Test & Build`, ajuste.

## Ordem de merge com #10 (db-connections)
O #10 também altera o bloco `services` e o passo de migrations deste arquivo. Para o merge ser trivial **sem rebase**, o `ci.yml` está **idêntico byte a byte** nos dois branches (o #10 recebeu um commit de acompanhamento com este mesmo arquivo). Qualquer ordem de merge funciona; depois do segundo merge o arquivo não muda.
