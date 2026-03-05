# Deploy econômico dos workers (AI + scheduled-messages)

Os workers hoje são processos long-running com polling (ai ~1,5s, scheduled ~30s). Abaixo, opções por custo e esforço.

---

## Comparativo rápido

| Opção | Custo estimado/mês | Esforço | Latência AI | Observação |
|-------|--------------------|---------|-------------|------------|
| **1. Lambda + EventBridge** | ~$0–5 | Refactor | 1–2 min | Máximo pay-per-use |
| **2. EC2 t4g.micro (1 instância)** | ~$6–8 | Baixo | Igual hoje | 2 processos na mesma máquina |
| **3. Fargate Spot (1 task, 2 containers)** | ~$3–8 | Médio | Igual hoje | Pode ser interrompido |
| **4. VPS (Hostinger/DigitalOcean)** | ~$4–6 | Baixo | Igual hoje | Você gerencia OS |

---

## Opção 1 — Lambda + EventBridge (implementada)

**Ideia:** Em vez de processo rodando 24/7, cada worker vira uma Lambda invocada a cada X minutos. A Lambda “acorda”, processa todos os jobs pendentes (ou um limite), e termina. Você paga só por invocações + tempo de execução.

- **scheduled-messages:** Lambda a cada **5 min**. Custo típico: ~2.880 invocações/mês × ~5–15 s = centavos.
- **ai-worker:** Lambda a cada **1 min**; latência de resposta sobe de ~1,5 s para até ~1 min. Custo: ~43.800 invocações/mês × duração variável = ordem de poucos dólares para uso moderado.

**Implementação:**

- Handlers: `backend/src/workers/lambda-ai.ts` e `backend/src/workers/lambda-scheduled.ts` (chamam `runAiWorkerCycle` e `runScheduledMessagesCycle` exportados dos workers, fecham o pool ao final).
- Stack: `infra/api/stack.yaml` — funções `navalhia-worker-ai-${Stage}` e `navalhia-worker-scheduled-${Stage}`, regras EventBridge `rate(1 minute)` e `rate(5 minutes)`.
- Deploy: `./scripts/aws/deploy-api.sh` (mesmo zip da API; variáveis opcionais `OPENAI_API_KEY`, `N8N_EVENTS_WEBHOOK_URL`, `N8N_EVENTS_SECRET` no `.env` para os workers).

**Vantagens:** Pay-per-use, escala automática, sem servidor para manter.  
**Desvantagens:** Latência da IA até ~1 min; cold start e nova conexão com o banco a cada invocação (mitigado com `DATABASE_POOL_MAX=2` e `pool.end()` no handler).

---

## Opção 2 — Uma EC2 pequena (recomendado para “zero refactor”)

Rodar **os dois workers na mesma instância**, igual ao Docker Compose, com systemd ou PM2.

- **Instância sugerida:** **t4g.micro** (ARM, 2 vCPU, 1 GB) ou **t4g.small** (2 GB) se 1 GB ficar apertado.
- **Custo:** ~US$ 6–8/mês (on-demand). Com Reserved 1 ano cai para ~US$ 4–5/mês.
- **Passos resumidos:**
  1. Subir uma Amazon Linux 2023 (ou Ubuntu) t4g.micro.
  2. Instalar Node 20, clonar o repo, `npm ci && npm run build` no backend.
  3. Configurar variáveis de ambiente (DATABASE_URL, APP_ENCRYPTION_KEY, UAZAPI_BASE_URL, OPENAI_API_KEY, etc.) em `/etc/environment` ou systemd unit.
  4. Dois serviços systemd (ou um PM2 com 2 processos):
     - `node dist/workers/ai-worker.js`
     - `node dist/workers/scheduled-messages-worker.js`
  5. (Opcional) CloudWatch agent para logs; alarme básico se os processos caírem.

**Vantagens:** Nenhuma mudança no código dos workers; mesmo comportamento que hoje.  
**Desvantagens:** Custo fixo mensal; você gerencia a instância (patches, reinício).

---

## Opção 3 — Fargate Spot (containers, sem EC2)

Um cluster ECS com uma **task definition** que sobe **dois containers** (ai-worker e scheduled-messages-worker) na mesma task, usando **Fargate Spot** para reduzir custo.

- **Custo:** variável; Spot costuma ser bem mais barato que on-demand (ex.: task 0,25 vCPU + 0,5 GB × 2 containers ≈ poucos dólares/mês).
- **Risco:** Spot pode ser interrompido; a task reinicia e os workers voltam a fazer polling (sem perda de jobs, que estão no banco).

**Vantagens:** Sem EC2 para administrar; deploy igual ao Docker (imagem do backend).  
**Desvantagens:** Configuração ECS + IAM + secrets (Parameter Store/Secrets Manager); Spot não é garantido.

---

## Opção 4 — VPS (Hostinger, DigitalOcean, etc.)

Um VPS de ~US$ 4–6/mês (1 GB RAM). Rodar os dois workers com Docker Compose ou Node + PM2, como em desenvolvimento.

**Vantagens:** Preço fixo, controle total, mesmo setup que local.  
**Desvantagens:** Você cuida de SO, backups e segurança; não é “serverless”.

---

## Recomendações práticas

- **Quer gastar o mínimo e aceita refatorar:** **Opção 1 (Lambda + EventBridge)**. Vale a pena pelo menos para o **scheduled-messages** (cron a cada 5 min); o ai-worker pode seguir Lambda a cada 1–2 min ou, se a latência for crítica, manter em uma instância.
- **Quer subir rápido sem mudar código:** **Opção 2 (uma EC2 t4g.micro)** com os dois workers e systemd/PM2.
- **Quer containers e não quer EC2:** **Opção 3 (Fargate Spot)** com uma task de 2 containers.
- **Já tem ou prefere VPS:** **Opção 4** com o mesmo `docker-compose` (apenas os serviços dos workers).

Se quiser, o próximo passo pode ser: (a) esqueleto de handlers Lambda + EventBridge para os dois workers, ou (b) um script/CloudFormation mínimo para subir a EC2 com systemd para os dois processos.
