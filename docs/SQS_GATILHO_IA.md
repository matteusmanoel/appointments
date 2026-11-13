# Gatilho por evento do worker de IA (SQS)

**Problema:** o worker de IA só rodava via EventBridge `rate(1 minute)` → a resposta do agente demorava até ~1 min + `AI_INBOUND_QUIET_SECONDS` (8 s).

**Solução (arquivos; nada aplicado):**
1. `backend/src/queue/ai-queue.ts`: depois de gravar/empurrar o `ai_job` (`inbound.ts`), envia mensagem SQS com `DelaySeconds = janela de silêncio`.
2. `infra/production/sqs.tf`: fila + DLQ (3 tentativas), IAM mínimo (API só envia, worker só consome), `event_source_mapping` no `worker_ai` (`ReportBatchItemFailures`, concorrência limitada por `ai_jobs_queue_max_concurrency`).
3. `backend/src/workers/lambda-ai.ts`: mesma função atende SQS e EventBridge. O EventBridge **continua** como rede de segurança (retries/backoff).
4. Sem `AI_JOBS_QUEUE_URL`, nada muda (comportamento antigo).

**Debounce:** cada mensagem do cliente empurra `run_after` no banco e envia novo aviso; avisos antigos acordam o worker cedo, ele não acha job elegível e volta a dormir.

## Bundles por função (esbuild)
`cd backend && npm run bundle:lambdas` → `backend/build/lambda/{api,worker_ai,worker_scheduled,worker_knowledge}.zip` (≈1 MB, 0,4 MB, 0,05 MB e **20,3 MB** o `worker_knowledge`; antes: um zip único com `node_modules` inteiro).
Terraform: `-var 'lambda_zip_paths={api="…/api.zip",worker_ai="…/worker_ai.zip",worker_scheduled="…/worker_scheduled.zip",worker_knowledge="…/worker_knowledge.zip"}'`.
Os handlers não mudam; o runtime `nodejs20.x` resolve `dist/lambda.mjs` para `dist/lambda.handler`.

### `worker_knowledge`: pdf-parse precisa de pdfjs-dist e @napi-rs/canvas
`pdf-parse@2` carrega `pdfjs-dist` (ESM, por `import()`) e `@napi-rs/canvas` (binário nativo) em runtime. Como o `pdf-parse` é `external` (carregado por `createRequire`), o esbuild não os incorpora; o script os copia para `node_modules/` do zip: `pdf-parse`, `pdfjs-dist`, `@napi-rs/canvas` e **`@napi-rs/canvas-linux-x64-gnu`** (o Lambda `nodejs20.x` é x86_64/glibc; se a arquitetura virar arm64, trocar por `-linux-arm64-gnu` em `FUNCTIONS.worker_knowledge.copyModules`). `.map`, `types/` e `web/` do pdfjs são podados. O build falha se algum arquivo obrigatório faltar.
- Antes: zip de 5,5 MB; o worker carrega, mas o primeiro PDF falha (`Cannot find module '@napi-rs/canvas'`/`pdfjs-dist`).
- Depois: 20,3 MB (limite do Lambda: 50 MB zipado / 250 MB descompactado).
- Validação local, fora do repositório: `cd backend && npm run bundle:lambdas worker_knowledge && npm run verify:knowledge-zip` (extrai o zip em /tmp, importa o bundle e lê um PDF real). Coberto por `src/__tests__/bundle-knowledge-zip.test.ts`.

## Trava contra placeholder
Sem zip real, `terraform apply` **falha** (precondition em cada Lambda) em vez de trocar o código por um placeholder. Para `plan`/conta vazia: `-var allow_placeholder_deploy=true`.

## Decisão do dono (não tomada aqui)
SQS (Lambda) × host sempre ligado para a latência: este patch reduz a latência do Lambda, mas não resolve o requisito do Evolution/Baileys de processo sempre ligado (ver revisão de arquitetura B1/B6).
Pendências: alarme na DLQ, `terraform apply`, limite de concorrência da conta Free.
