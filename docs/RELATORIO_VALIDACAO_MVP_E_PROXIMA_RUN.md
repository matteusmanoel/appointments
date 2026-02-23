# Relatório de validação do MVP e itens para próxima run

**Data:** 2026-02-21  
**Objetivo:** Garantir que o plano em [ESTRATEGIA_CONSOLIDACAO_MVP.md](./ESTRATEGIA_CONSOLIDACAO_MVP.md) esteja concluído e o MVP pronto para venda; mapear ajustes/correções/melhorias para implementação futura.

---

## 1. Testes executados via linha de comando

### 1.1 Backend (`backend/`)

```bash
cd backend && npm run test
```

| Resultado | Detalhe |
|-----------|---------|
| **4 arquivos, 29 testes — todos passando** | OK |

| Arquivo | Testes |
|---------|--------|
| `prompt-builder.test.ts` | 9 |
| `agent-violations.test.ts` | 5 |
| `webhook-uazapi.test.ts` | 9 |
| `whatsapp-ai-routes.test.ts` | 6 |

### 1.2 Frontend (raiz do projeto)

```bash
npm run test
```

| Resultado | Detalhe |
|-----------|---------|
| **3 arquivos, 8 testes — todos passando** | OK |

| Arquivo | Testes |
|---------|--------|
| `example.test.ts` | 1 |
| `slots.test.ts` | 3 |
| `serviceLabel.test.ts` | 4 |

**Resumo:** Nenhuma falha nos testes automatizados. Build e testes de unidade estão verdes.

---

## 2. Validação via interface (checklist recomendado)

Executar manualmente com o app rodando (front em 3002, API em 3003, DB + workers via Docker). Use [MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md) como base e complemente com os itens abaixo, alinhados ao MVP “pronto para vender”.

### 2.1 Setup Essencial (plano utilizável)

- [ ] **Login** com usuário de plano Essencial (ou barbershop com `billing_plan = 'essential'`).
- [ ] **Serviços:** criar/editar pelo menos um serviço; lista atualiza.
- [ ] **Barbeiros:** criar/editar pelo menos um barbeiro.
- [ ] **Configurações > Horário:** editar dias e horários; salvar; em Agendamentos, slots refletem o novo horário.
- [ ] **Configurações > Link de Agendamento:** visualizar/copiar link; editar slug (apenas a-z, 0-9, -); salvar.
- [ ] **Agendamentos:** criar agendamento manual (cliente, barbeiro, serviço, data/hora); grade mostra o agendamento.
- [ ] **Link público:** acessar `/b/{slug}`; fluxo completo (serviço → barbeiro → data/horário → nome/telefone); agendamento aparece na área logada como pendente.
- [ ] **Sidebar:** itens Agendamentos, Barbeiros, Serviços, Clientes, Integrações, Configurações **sem** badge “Pro” bloqueando (Essencial pode acessar). Fidelidade pode manter gate Pro.

### 2.2 Pro/Premium — WhatsApp + IA + automação

- [ ] **Integrações > WhatsApp:** conectar número (Uazapi); status “Conectado”.
- [ ] **IA:** enviar mensagem para o número conectado; resposta da IA; “Quero agendar amanhã às 15h”; agendamento criado após confirmação.
- [ ] **Dashboard:** bloco de status exibe “WhatsApp: Conectado” e, se houver, “Automações: X na fila, Y falhas, Z ignoradas”.
- [ ] **Lembrete 24h:** após criar agendamento (público ou IA), job em `scheduled_messages` com `type = 'reminder_24h'`; dentro da janela 9–20h o worker envia (ou marca `skipped` se fora da janela/opt-out/sem token).
- [ ] **Cancelar agendamento (painel):** excluir agendamento; job de lembrete correspondente deve ser marcado como `skipped` (não enviar depois).
- [ ] **Reagendar via link:** acessar `/reagendar/:token` ou `/cancelar/:token`; cancelar ou escolher nova data/hora; validação de cutoff 2h e de expediente/closures; sucesso atualiza agendamento e recria lembrete no reagendamento.

### 2.3 Reagendar/cancelar (regras)

- [ ] **Cutoff 2h:** para agendamento em menos de 2h, tentar cancelar/reagendar pelo link; deve retornar erro tipo “Só é possível cancelar/reagendar até 2 horas antes”.
- [ ] **Horário no passado:** data/hora no passado no reagendamento; deve retornar erro “Horário não pode ser no passado”.
- [ ] **Fora do expediente:** reagendar para dia/hora fora do `business_hours` ou em closure; deve retornar erro de validação (ex.: “Barbearia fechada” ou “Horário fora do expediente”).

### 2.4 Multi-unidade

- [ ] **Login** com usuário que tem mais de uma unidade (múltiplos `barbershops` em `/api/auth/me`).
- [ ] **Seletor de unidade** na sidebar; trocar unidade; loading/feedback “Trocando...”; dados (agendamentos, serviços, etc.) passam a ser da unidade selecionada.
- [ ] **Persistência:** recarregar a página; unidade selecionada deve permanecer (localStorage `selected_barbershop_id`).

### 2.5 Landing e coerência

- [ ] **Landing:** hero e bullets **sem** promessa de “pagamento antecipado” ou “cobrar cliente”; foco em “lembretes + confirmação + reagendamento fácil”.
- [ ] **Prova visual:** seções com imagens ou fallback (ícones) para WhatsApp e painel; links para `/screenshots/whatsapp-demo.png` e `dashboard.png` (ou placeholder).
- [ ] **FAQ / planos:** 1 número incluso; número extra (ex.: R$ 39) e multi-unidade (assinatura por unidade) mencionados quando aplicável.

---

## 3. Critérios de aceite do MVP (estrategia) — conferência rápida

| Critério (ESTRATEGIA_CONSOLIDACAO_MVP.md) | Estado no código |
|-------------------------------------------|------------------|
| Configurar unidade (dados, horários, serviços, barbeiros) | Rotas liberadas para Essencial; sem UpgradeGate em Serviços, Barbeiros, Agendamentos, Clientes, Configurações. |
| Link público funcional | Rota `/b/:slug` e fluxo de agendamento público implementados. |
| Conectar WhatsApp e ativar IA | Integrações > WhatsApp + worker-ai; status no Dashboard. |
| Lembretes automáticos + 1 follow-up (30d) | `scheduled_messages`, worker, templates, dedupe, timezone, skip se cancelado, opt-out, sweep com lock. |
| Reagendar/cancelar (link + WhatsApp) | Rotas públicas `/reagendar/:token`, `/cancelar/:token`; validações (cutoff, expediente, closures); tools de IA com validação por `client_phone`. |
| Visão mínima de status | Dashboard com WhatsApp conectado/desconectado e resumo de automações (queued/failed/skipped). |
| Multi-unidade light | accounts/memberships, `/api/auth/me` com `barbershops`, `switch-barbershop`, seletor e persistência no front. |
| Automação: falhas registradas, janela de horário, opt-out | Worker marca sent/failed/skipped; janela 9–20h; opt-out no webhook (incl. upsert cliente se não existir). |
| IA: sem vazamento de IDs, sem pedir telefone | Guardrails e strip de UUIDs nos testes; tools cancel/reschedule exigem `client_phone` do contexto. |

Implementações dos “ajustes restantes” (dedupe follow-up, timezone `run_after`, skip cancelado, validações públicas, segurança IA, dashboard status, sidebar Essencial, multi-unidade persistência, multi-modelo por erros, landing proof, sweep lock, opt-out upsert) estão presentes no código.

---

## 4. Itens mapeados para próxima run (ajustes, correções, melhorias)

Itens abaixo não bloqueiam o MVP vendável, mas devem ser tratados em uma próxima rodada de implementação/testes.

### 4.1 Testes automatizados

- [ ] **Backend:** adicionar testes para `scheduled-messages` (agendamento de lembrete, dedupe, cancelReminder) e para rotas públicas de cancel/reschedule (cutoff, validação de slot).
- [ ] **Backend:** testes para `validateSlotForPublicReschedule` e para `getAppointmentStartUtc` / cutoff no cancel.
- [ ] **Frontend:** testes para componentes que dependem de `integrationsApi.getScheduledMessagesSummary()` e do bloco de status do Dashboard (mock da API).
- [ ] **E2E (opcional):** fluxo mínimo E2E (login → criar serviço/barbeiro → link público → agendar) com Playwright ou Cypress para regressão.

### 4.2 Interface e UX

- [ ] **Onboarding:** revisar checklist pós-checkout (serviços, barbeiro, horário, slug, WhatsApp para Pro) e mensagens de estado; garantir que redireciona e preenche conforme estratégia.
- [ ] **Configurações:** separar claramente o que é Essencial (Dados, Horários, Link) do que é Pro/Premium (WhatsApp/IA, Notificações); usar UpgradeGate por seção/aba se necessário.
- [ ] **Dashboard:** em caso de erro ao carregar resumo de automações (ex.: 403/404), não quebrar a página; tratar estado de erro ou ocultar bloco.
- [ ] **Multi-unidade:** em caso de falha no `switchBarbershop` (ex.: token expirado), exibir mensagem amigável e opção de refresh/login.

### 4.3 Backend e operação

- [ ] **Migrations:** garantir que todas as migrations listadas em RELATORIO_TESTES_LOCAIS.md (incl. `20260222140000_scheduled_messages_followup_dedupe.sql`) estejam aplicadas em todos os ambientes (local, staging, produção).
- [ ] **Worker scheduled:** documentar variáveis de ambiente necessárias para disparo real (UAZAPI_*, APP_ENCRYPTION_KEY); manter números de teste (45999325199 remetente, 45988230845 destinatário) apenas em ambiente de desenvolvimento.
- [ ] **Health/readiness:** endpoint de health do worker-scheduled (ou métrica) para orquestração (Kubernetes/Docker); opcional para MVP.

### 4.4 Landing e conversão

- [ ] **Screenshots reais:** substituir placeholders por imagens reais em `public/screenshots/` (whatsapp-demo.png, dashboard.png) quando houver material aprovado.
- [ ] **Prova social:** quando houver pilotos reais, substituir depoimentos genéricos por citações com contexto (com autorização).
- [ ] **FAQ:** revisar respostas sobre handoff humano, tempo de setup (15–30 min), mais de um número (R$ 39) e múltiplas unidades (assinatura por unidade).
- [ ] **Planos:** na tabela de preços, deixar explícito “1 número incluso”; “Número extra: R$ 39/mês (sob solicitação)”; “Multi-unidade: uma assinatura por unidade”.

### 4.5 Produto e estratégia (decisões)

- [ ] **Handoff humano:** definir comportamento no MVP (ex.: botão “Assumir” e pausa da IA por X horas) e refletir na UI e no fluxo.
- [ ] **Limites Pro/Premium:** definir limites de uso (ex.: conversas/mês ou “fair use”) e exibir ou não no painel; documentar na landing se necessário.
- [ ] **Métricas de produto:** no-show rate, lembretes enviados/falhas, follow-ups enviados (já existe resumo; evoluir para cards dedicados no Dashboard se desejado).

---

## 5. Resumo executivo

| Aspecto | Status |
|---------|--------|
| Testes automatizados (CLI) | **Todos passando** (backend 29, frontend 8). |
| Implementação do plano de ajustes | **Concluída** (dedupe, timezone, skip cancelado, validações públicas, segurança IA, status no painel, sidebar, multi-unidade, multi-modelo, landing, sweep lock, opt-out). |
| Validação via interface | **Checklist fornecido** (secções 2.1–2.5); executar manualmente com app e DB rodando. |
| Itens para próxima run | **Mapeados** na secção 4 (testes adicionais, UX, backend/ops, landing, decisões de produto). |

O MVP está **pronto para venda** do ponto de vista de código e testes automatizados. Recomenda-se executar o checklist de validação via interface (secção 2) em ambiente local ou staging antes de considerar o ciclo fechado e, em seguida, tratar os itens da secção 4 na próxima run.
