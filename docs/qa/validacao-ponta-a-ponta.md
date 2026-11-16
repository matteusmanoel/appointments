# Checklist de validação ponta a ponta (simulador local → backend na AWS)

Validação ordenada, do agente no Postgres local até o backend na conta AWS de produção (`214976551341`, região `us-east-2`). **Nada a clientes reais.** Cada passo tem pré-requisito, ação, critério objetivo de passa/falha e quem executa. Horários neste documento são em **America/Sao_Paulo (UTC-3)**.

O `terraform apply` e qualquer mudança em webhook, DNS, domínio ou instância WhatsApp **só acontecem depois de aprovação explícita do Mateus**. Este checklist não substitui `infra/README.md`, `docs/DB_CONEXOES_NEON.md`, `docs/STAGING.md`, `docs/RUNBOOK.md` nem `docs/WHATSAPP_PROVIDER.md`.

---

## 0. Regras que valem em todos os passos

| | |
| --- | --- |
| **Pré-requisito** | Bundle/PR revisado; ninguém dispara mensagem para número que não seja de teste do próprio Mateus. |
| **Ação** | Em toda conversa e em todo log visível ao cliente: o bot não se apresenta como humano, não revela que é IA, não usa «secretária virtual» nem «no-show», e não troca «amanhã» pelo nome do dia. |
| **Passa** | Nenhuma fala viola as regras acima; nenhum envio a cliente real. |
| **Falha** | Qualquer envio a cliente real, ou fala que quebra o combinado. |
| **Quem executa** | Mateus (aprovação e testes no próprio número) e quem opera o checklist (execução local / conferência). |

---

## 1. Banco e testes locais

| | |
| --- | --- |
| **Pré-requisito** | Postgres em `127.0.0.1:55432`. `DATABASE_URL` aponta só para esse host (a guarda recusa host não local). |
| **Ação** | Na raiz do repo: testes do backend (incluindo goldens, simulador, lembretes e `simulate:compare` com cliente fake), `tsc` no backend, testes do front e `build` do front. Não usar `--llm openai` nesta etapa. |
| **Passa** | Todos os testes passam; `tsc` e o build do front terminam sem erro. Se o Postgres cair, os testes **falham** (não passam em silêncio). |
| **Falha** | Qualquer teste vermelho, falha de tipo ou de build, ou teste que passou sem o banco. |
| **Quem executa** | Quem valida o branch localmente (neste box ou no Mac do Mateus). |

---

## 2. Simulador local (`--llm none`)

| | |
| --- | --- |
| **Pré-requisito** | Passo 1 verde. Barbearia de laboratório no Postgres local (slug conhecido). Nenhuma chave de LLM é necessária. |
| **Ação** | `cd backend` e rodar, todos com `--llm none`: os roteiros em `scripts/examples/` (`cliente-decidido`, `cliente-indeciso`, `fora-do-horario`, `voce-e-robo` e, com agendamento devido, `lembrete-confirmo` via `--run-reminders` ou `{"role":"system","event":"reminders"}`). Conferir a fala «Já estamos encerrando por hoje, mas podemos encontrar um horário pra você amanhã». |
| **Passa** | O decidido chega no card e confirma; o indeciso recebe 2 a 3 horários; o fora do horário usa a fala combinada com «amanhã» (sem o nome do dia); «você é robô?» desvia e segue o card sem revelar IA; o lembrete entra na conversa `sim:…` pelo provider noop, **sem** linha nova em `scheduled_messages`, e o «Confirmo» confirma presença. |
| **Falha** | LLM chamado, mensagem enfileirada/enviada, fala fora do combinado, ou fluxo que não fecha. |
| **Quem executa** | Quem valida o branch localmente. |

---

## 3. Comparação none vs openai no Mac do Mateus

| | |
| --- | --- |
| **Pré-requisito** | Passo 2 verde. Postgres local no Mac (`127.0.0.1:55432`). `OPENAI_API_KEY` **exportada no terminal** — o comando **não lê `.env`**. Modelo barato `gpt-4o-mini`. |
| **Ação** | No Mac do Mateus: ```bash
cd backend
export DATABASE_URL='postgresql://USER:SENHA@127.0.0.1:55432/navalhia'
export OPENAI_API_KEY='sk-...'
npm run simulate:compare -- --tenant <slug-da-barbearia-local> --out /tmp/navalhia-simulate-compare.md --model gpt-4o-mini --max-runs 1 --max-tokens 300000
``` |
| **Passa** | O comando termina (ou aborta de forma explícita se passar de 300 mil tokens). O Markdown e o terminal trazem, por roteiro: resposta final de cada modo, passou/falhou nos contratos do golden, se a fala mudou, se `ai_exposure` ou o fallback agiram, latência, tokens de entrada e de saída, custo estimado. As falas continuam dentro do combinado. Nada é enviado pelo WhatsApp. |
| **Falha** | Chamada sem a chave no ambiente (o comando não pode “adivinhar” pelo `.env`); modelo que não é mini; host de banco não local; envio a cliente; custo ou tokens sem registro. |
| **Quem executa** | **Mateus, no Mac dele.** |

---

## 4. Terraform plan no Mac do Mateus

| | |
| --- | --- |
| **Pré-requisito** | Conta AWS `214976551341`, perfil `personal`, região `us-east-2`. Variáveis sensíveis **não** estão no repositório (`TF_VAR_*` ou `terraform.tfvars` local, fora do git). Ver `infra/README.md`. |
| **Ação** | No Mac: `export AWS_PROFILE=personal` e `aws sts get-caller-identity --profile personal` (conta deve ser `214976551341`). Em seguida `make infra-plan` (ou `cd infra/production && terraform plan` com o var-file adequado). **Não aplicar.** |
| **Passa** | O plan roda na conta certa e produz um plano revisável, sem imprimir segredos. Nenhuma mudança é aplicada. |
| **Falha** | Conta/perfil errado, plan quebrado, ou apply acidental. |
| **Quem executa** | Mateus no Mac. |

---

## 5. Terraform apply (só com aprovação explícita)

| | |
| --- | --- |
| **Pré-requisito** | Passo 4 revisado. Aprovação **explícita** do Mateus para este apply (não vale um “ok” genérico de outra conversa). `make infra-deploy` / `terraform apply` **sem** `-auto-approve`. |
| **Ação** | Mateus confirma o plan e aplica no Mac. Conferir outputs públicos (endpoint da API, etc.) sem colar segredos em chat ou ticket. |
| **Passa** | Apply conclui no estado esperado; outputs conferidos; nenhum segredo vazado. |
| **Falha** | Apply recusado, parcial, na conta errada, ou com `-auto-approve`. |
| **Quem executa** | Mateus no Mac, depois da aprovação explícita. |

---

## 6. Neon novo: migrations, sem seed de produção

| | |
| --- | --- |
| **Pré-requisito** | Projeto Neon **novo** (não reutilizar banco com dados de cliente). `DATABASE_URL` = pooler (API). `DATABASE_URL_DIRECT` = conexão direta (workers e migrations). Ver `docs/DB_CONEXOES_NEON.md`. |
| **Ação** | `cd backend && DATABASE_URL_DIRECT=... DATABASE_SSL=true npm run migrate:all`. **Não rodar** `scripts/seed-production.sql` (nem `npm run seed:production`) neste Neon. |
| **Passa** | `_migrations` registra as migrations; o schema sobe. Não há linhas de seed de produção (admin/demo de `seed-production`). |
| **Falha** | Migration quebrada, seed de produção aplicado, ou workers apontando só para pooler sem `DATABASE_URL_DIRECT`. |
| **Quem executa** | Mateus (credenciais do Neon) com quem opera as migrations. |

---

## 7. `VITE_API_URL` e redeploy do front

| | |
| --- | --- |
| **Pré-requisito** | API na AWS acessível (passo 5). URL pública da API conhecida (API Gateway ou domínio, **sem** misturar com o ambiente antigo). |
| **Ação** | Build e deploy do front com `VITE_API_URL` apontando para essa API (Vercel e/ou `./scripts/aws/deploy-static.sh`, conforme o alvo do momento). Redeploy depois de gravar a variável. |
| **Passa** | O front em produção/teste chama a API nova (inspecionar uma requisição `/api/...` no navegador). Health da API responde. |
| **Falha** | Front ainda aponta para API antiga, 404 generalizado, ou `VITE_API_URL` vazio no build. |
| **Quem executa** | Mateus (deploy) e quem confere no navegador. |

---

## 8. Webhook Stripe de teste (nunca o flordoestudante)

| | |
| --- | --- |
| **Pré-requisito** | API pública com `POST /api/billing/webhook`. Stripe em **modo Test**. Identificar os webhooks atuais no Dashboard. |
| **Ação** | Criar um **webhook de teste novo** apontando para `https://<api-nova>/api/billing/webhook`. Colocar o Signing secret de teste em `STRIPE_WEBHOOK_SECRET` do stack novo. **Desativar os 2 webhooks antigos** de teste que não devem mais receber evento. **Nunca desativar nem alterar o webhook/conta do flordoestudante.** |
| **Passa** | O endpoint novo aparece como ativo no Stripe Test; um checkout de teste (`4242 4242 4242 4242`) gera evento recebido pela API nova (log do Lambda). Os 2 antigos estão desativados. O flordoestudante permanece intacto. |
| **Falha** | Evento cai no endpoint antigo, secret errado, ou qualquer alteração no flordoestudante. |
| **Quem executa** | Mateus no Dashboard Stripe e no deploy da API. |

---

## 9. Instância WhatsApp (provider a decidir)

| | |
| --- | --- |
| **Pré-requisito** | Provider escolhido **explicitamente** (Evolution ou Uazapi — o example de Terraform hoje cita Evolution; o código aceita os dois). URL pública de webhook HTTPS da API nova. Número **de teste do próprio Mateus**, nunca de cliente. |
| **Ação** | Provisionar ou ligar uma instância de **teste**. Configurar o webhook para o endpoint do provider na API nova (`/api/webhooks/uazapi` ou o equivalente Evolution). Conferir `docs/WHATSAPP_PROVIDER.md`. |
| **Passa** | A instância mostra status conectado. Um evento de teste chega na API (`[uazapi webhook]` ou log equivalente) e enfileira job, **sem** falar com cliente real. |
| **Falha** | Instância em número de cliente, webhook no ambiente antigo, ou mensagem saindo para fora do número de teste. |
| **Quem executa** | Mateus (QR / token da instância de teste). |

---

## 10. Onboarding e e-mail (SES ou Resend)

| | |
| --- | --- |
| **Pré-requisito** | Decisão explícita: **SES** (`us-east-2`, hoje a conta pode estar em sandbox — só destinatários verificados recebem) **ou Resend**. `FROM_EMAIL` / remetente conferido. Checkout de teste do passo 8. |
| **Ação** | Completar um onboarding de teste (checkout test → `/onboarding?session_id=...`). Verificar se o e-mail com senha temporária (e API key, se aplicável) chega à caixa **de teste do Mateus**. |
| **Passa** | Conta de teste criada no banco novo; e-mail entregue (ou, em SES sandbox, claramente recusado só por destinatário não verificado — e aí verifica-se o destinatário e repete). Login de onboarding funciona. |
| **Falha** | E-mail para endereço que não é de teste, onboarding sem credenciais, ou envio pela conta/domínio errado. |
| **Quem executa** | Mateus (caixa de e-mail de teste e decisão SES vs Resend). |

---

## 11. Agendar, reagendar, cancelar e lembrete no número de teste do Mateus

| | |
| --- | --- |
| **Pré-requisito** | Passos 7–10 verdes. Instância WhatsApp no **número de teste do Mateus**. Relógio da barbearia em America/Sao_Paulo. |
| **Ação** | No próprio número: (1) agendar um horário; (2) remarcar (sem hora → 2–3 opções; hora livre; hora ocupada → alternativas); (3) cancelar só depois do card «Posso cancelar…? Se preferir, posso remarcar.» e de um «sim»; (4) receber o lembrete 24h (ajustar o horário do agendamento / relógio de teste para o job vencer) e responder confirmo / remarcar / cancelar. |
| **Passa** | Os quatro fluxos fecham no painel e no WhatsApp de teste, com as falas combinadas. Um «sim» atrasado ou com card expirado **não** remarca nem confirma. Agendamento `cancelled` não é remarcado. Nada sai para outro número. |
| **Falha** | Cancelamento imediato sem card, envio a terceiro, fala proibida, ou lembrete que não chegou / chegou a outro destino. |
| **Quem executa** | Mateus no próprio número de teste. |

---

## 12. Encerramento

| | |
| --- | --- |
| **Pré-requisito** | Passos 1–11 preenchidos com passa ou falha anotada. |
| **Ação** | Desligar ou pausar a instância de teste se não for mais usada. Confirmar de novo: flordoestudante intacto; nenhum webhook antigo de teste ativo por engano; nenhum cliente real contactado. |
| **Passa** | Checklist preenchido; ambiente de teste isolado; produção de terceiros (flordoestudante e clientes reais) intocada. |
| **Falha** | Qualquer dúvida sobre envio a cliente real — **parar** e investigar antes de continuar. |
| **Quem executa** | Mateus. |
