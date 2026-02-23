# Relatório de Validação — MVP Consolidado Ponta a Ponta

**Data:** 21/02/2025  
**Escopo:** Validação funcional e técnica do MVP (frontend, backend, integração, auditoria de consolidação).

---

## 1. Status Geral do MVP

### Está funcional ponta a ponta?

**Sim**, com ressalvas.

- **Backend:** Testes unitários (Vitest) passam (41 testes). Endpoints de appointments, reports, integrations (scheduled-messages, commissions_by_barber), auth, barbers, services, clients, public, billing estão implementados e cobertos por uso no frontend.
- **Frontend:** Rotas protegidas e públicas mapeadas; fluxos de barbeiros, agendamentos (grade Dia/Mês/Ano, lista/Agenda), relatórios, configurações (link público, notificações, pagamentos/comissões) implementados conforme plano.
- **Integração:** Contratos de API (frontend `api.ts` vs backend routes) estão alinhados. Uso de `commission_amount`, `from`/`to`, `status`, `barber_id` está consistente.

### Principais riscos identificados

1. **E2E atuais falham** — Smoke tests (landing + login) não passam: seletores e/ou estado de carregamento (auth) não batem com o DOM real; possível redirect quando já autenticado.
2. **Período “últimos 30 dias” em Comissões** — Modal Pagamentos e Comissões usa “desde o primeiro dia do mês passado até hoje”, mas o rótulo diz “últimos 30 dias”; período real é variável (~30–60 dias).
3. **Página `LinkPublico.tsx` órfã** — Arquivo existe mas a rota `/app/link` foi trocada por redirect para Configurações; código morto se ninguém importar.
4. **Dependência de backend real** — Validação completa de fluxos (criar agendamento, relatórios, notificações) exige backend + DB rodando; testes E2E atuais não cobrem fluxos autenticados.

---

## 2. Lista de Bugs Encontrados

### 2.1 E2E — Smoke tests falham

| Item        | Descrição |
|------------|-----------|
| **Localização** | `e2e/smoke.spec.ts` |
| **Descrição** | Os dois testes (landing carrega + login com formulário) falham por timeout: elementos esperados não aparecem. |
| **Severidade** | 🟡 Médio (não bloqueia uso real; impacta CI/confiança em regressão). |
| **Reproduzir** | Rodar `PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test`. App em `npm run dev` na porta 3002. |
| **Causas prováveis** | (1) Landing retorna `null` enquanto `useAuth().loading` é true, então não há `h1` no primeiro paint. (2) Login usa `<h1>NavalhIA</h1>`, mas o teste esperava heading com texto "login|entrar". (3) Se houver token no localStorage, Landing redireciona para `/app` e não mostra hero. |
| **Sugestão** | Ajustar seletores: landing — aguardar link "Entrar" ou `h1` com timeout maior; login — heading com nome `/navalhia|login|entrar/i`. Garantir que testes rodem em contexto sem token (nova sessão/contexto sem storage) ou aceitar redirect para `/app` quando autenticado. |

### 2.2 Comissão — Rótulo “últimos 30 dias” vs período real

| Item        | Descrição |
|------------|-----------|
| **Localização** | `src/pages/Configuracoes.tsx` — `PaymentsCommissionsModal` |
| **Descrição** | Label: "Comissão prevista (últimos 30 dias)". Cálculo usa `from = primeiro dia do mês passado`, `to = hoje`, ou seja, ~30–60 dias. |
| **Severidade** | 🟢 Melhoria |
| **Reproduzir** | Configurações → Pagamentos e Comissões → abrir modal. |
| **Sugestão** | Alinhar texto e dados: ou trocar para "desde o início do mês passado" ou usar intervalo fixo de 30 dias (ex.: `subDays(today, 30)` até `today`) e manter "últimos 30 dias". |

### 2.3 Código órfão — `LinkPublico.tsx`

| Item        | Descrição |
|------------|-----------|
| **Localização** | `src/pages/LinkPublico.tsx` |
| **Descrição** | Página não está mais em nenhuma rota; `/app/link` redireciona para `/app/configuracoes?open=booking`. |
| **Severidade** | 🟢 Melhoria |
| **Sugestão** | Remover arquivo ou mantê-lo apenas como referência; evitar import em outros arquivos. |

---

## 3. Melhorias Técnicas Recomendadas

### 3.1 UI/UX

- **Loading na Landing:** Enquanto `loading` do auth for true, a Landing renderiza `null`; considerar skeleton ou placeholder para evitar “tela em branco” no primeiro carregamento.
- **Grade Mês/Ano:** Na view Ano, ao clicar no mês, navega para Mês; considerar indicar na UI que é clique para focar naquele mês.
- **Relatórios:** Persistência de colunas por `profileId` está ok; garantir que em multi-tenant o `profileId` seja estável para não misturar preferências entre contas.
- **Modais:** Guideline de layout (body com `px-4 sm:px-6`, footer fixo) está aplicada no `EntityFormDialog`; conferir em modais customizados (ex.: WhatsApp stepper) em mobile.

### 3.2 Performance

- **Agendamentos:** Queries separadas para day vs month; uso de `gradeBarberIds`/`gradeStatus` está correto. Para muitos barbeiros, considerar virtualização na grade ou limite de colunas.
- **Relatórios:** Export CSV em memória; para conjuntos muito grandes, considerar streaming ou aviso de limite (ex.: 500 linhas).

### 3.3 Estrutura de código

- **Agendamentos.tsx:** Arquivo muito grande (~2k linhas); extrair componentes (ex.: `DayGridView`, `MonthGridView`, `AppointmentCard`, toolbar da grade) e hooks (`useAppointmentsGrade`, `useListFilters`) para facilitar manutenção e testes.
- **Configuracoes.tsx:** Modais `NotificationsModal` e `PaymentsCommissionsModal` já estão em funções separadas; manter padrão para novas seções.

### 3.4 Reuso e componentização

- **DatePicker / DateRangePicker:** Já reutilizados em Agendamentos, PublicBooking, RescheduleOrCancel, Dashboard, Relatórios; manter como fonte única para seleção de datas.
- **Status labels:** Mapeamentos (pending → Pendente, etc.) repetidos em mais de um arquivo; considerar constante compartilhada (ex.: `src/lib/status-labels.ts`).

### 3.5 Validações e tratamento de erro

- **API:** 401 dispara redirect para login e `AuthError` evita retry em cascata; tratamento genérico `data?.error ?? res.statusText` está ok.
- **Formulários:** Zod + react-hook-form nos formulários principais; manter validação de datas (minDate, horários) nos agendamentos.
- **Feedback:** Toasts para sucesso/erro em mutações; loading states nos botões e listas estão presentes.

---

## 4. Backend

### 4.1 Inconsistências

- Nenhuma inconsistência crítica encontrada entre rotas e uso no frontend. `GET /api/appointments` retorna `commission_amount`; frontend usa em Relatórios e no modal de agendamento (view).
- `GET /api/reports/commissions_by_barber` recebe `from`/`to`; frontend envia datas em `yyyy-MM-dd`. Ok.

### 4.2 Melhorias estruturais

- **Scheduled messages list:** Endpoint `GET /api/integrations/automations/scheduled-messages` com query params `type`, `status`, `limit`; máscara de telefone aplicada. Estrutura adequada para diagnóstico.
- **Comissões:** Agregação por barbeiro para status `completed` no período; regra de cálculo (barber percentage) concentrada em `appointments.ts` (create/patch). Manter documentação da regra (ex.: TOOL_CONTRACT ou RUNBOOK).

### 4.3 Ajustes de contrato

- Não identificada necessidade de mudança de contrato. Tipos em `api.ts` (ex.: `AppointmentListItem.commission_amount?`) estão alinhados com o que o backend envia.

### 4.4 Pontos frágeis de regra de negócio

- **Comissão:** Cálculo usa apenas `barbers.commission_percentage`; `services.commission_percentage` e `barber_services.custom_commission_percentage` existem no schema mas não são usados. Documentado no plano como “fase posterior”; manter assim no MVP.
- **Lembretes:** Apenas `reminder_24h` está implementado (enqueue + worker); `reminder_2h` existe no DB mas sem pipeline. Consciente e aceitável para MVP.

---

## 5. Checklist Final de Consolidação

Antes de declarar o MVP consolidado para produção, recomenda-se:

- [ ] **E2E:** Corrigir smoke tests (landing + login) para passarem de forma estável (seletores + estado de auth) e, se possível, adicionar um fluxo mínimo autenticado (login → dashboard ou agendamentos).
- [ ] **Comissões (label):** Ajustar texto do modal Pagamentos e Comissões para refletir o período real (“desde o mês passado” ou “últimos 30 dias” com intervalo fixo de 30 dias).
- [ ] **Limpeza:** Remover ou documentar `LinkPublico.tsx` como órfão.
- [ ] **Manual:** Executar checklist manual do plano (login, dashboard, configurações link/WhatsApp, agendamentos grade/lista/modal view-edit, booking público, reagendar, relatórios, notificações/comissões) com backend real.
- [ ] **Console/Network:** Em ambiente de staging ou local, validar ausência de erros no console e respostas HTTP coerentes (sem 500 não tratados em telas críticas).
- [ ] **Mobile:** Validar modais (EntityFormDialog, WhatsApp stepper, Relatórios) e grade em viewport pequeno (overflow, botões acessíveis).

---

## 6. Resumo Executivo

- **Funcionalidade:** MVP está implementado ponta a ponta (rotas, telas, APIs, filtros, grade Dia/Mês/Ano, Agenda, relatórios com CSV, notificações e comissões em Configurações, link público em Configurações).
- **Qualidade técnica:** Backend com testes passando; frontend sem erros de compilação; contratos alinhados. E2E atuais falham por ajuste de seletores/estado.
- **Próximos passos prioritários:** (1) Ajustar e estabilizar smoke E2E; (2) Alinhar rótulo de comissão ao período usado; (3) Rodar checklist manual com backend real e (4) Validar em mobile.
