# Levantamento: Ajustes e Novas Features – NavalhIA

**Data:** 02/02/2025 (atualizado)  
**Método:** Análise de código + referência ao estado pós-implementação do plano  
**Base:** Funcionalidades já implementadas (MVP + relatórios, horário de funcionamento, link público)

---

## 1. Estado atual (o que já foi implementado)

| Área | Status | Observação |
|------|--------|------------|
| **Dashboard** | OK | Taxa de Ocupação em %; gráficos com dados reais (reportsApi); período configurável no RevenueChart; AppointmentsList com loading/erro |
| **Serviços** | OK | CRUD completo; preço default 35; placeholder "Ex: 35,00"; comissão na tabela |
| **Clientes** | OK | Lista + busca (debounce); CRUD; máscara de telefone (formatPhoneBR/parsePhoneBR) |
| **Barbeiros** | OK | CRUD + editor de escala (schedule); menu de ações |
| **Agendamentos** | OK | Grade por `barber_id`; slots por `business_hours`; toast 409 para conflito; edição por IDs; suporte a múltiplos serviços (`service_ids`), status e seletor de período (date range) |
| **Configurações** | OK | Dados da NavalhIA com loading/skeleton; Horário de Funcionamento (modal por dia); Link de Agendamento (slug, copiar link); Excluir Conta com diálogo "Em breve" |
| **Fidelidade** | Preview | Placeholder honesto "Em breve"; cards com "—" |
| **Agendamento público** | OK | Rota `/b/:slug`; fluxo serviço → barbeiro → data/horário → dados; criação com status pending |
| **Tema / Mobile** | OK | Toggle tema na sidebar; drawer no mobile |
| **CSS** | Corrigido | `@import` de fontes movido para o topo do `index.css` (evita warning "must precede all other statements") |

---

## 2. Ajustes recomendados nas funcionalidades atuais

### 2.1 Agendamentos

- **Conflito ao editar data/hora**  
  Garantir que, ao alterar data ou horário no modal de edição, o backend seja chamado com validação de conflito (409) e que o mesmo toast amigável ("Horário já ocupado…") apareça.

- **Múltiplos serviços por agendamento**  
  Se o backend ainda não suportar N serviços por agendamento, alinhar o formulário (e a API) ao modelo atual (1 serviço por agendamento) ou documentar a regra (ex.: primeiro serviço do array como principal).

- **Filtros e vista lista**  
  Além da grade por dia, considerar filtro por barbeiro, por status e/ou vista em lista para facilitar busca em períodos longos.

### 2.2 Configurações

- **Notificações, Pagamentos, Segurança**  
  Seções continuam com "Em breve.". Próximos passos: Notificações (lembretes), Pagamentos/Comissões (já existe comissão em serviços/barbeiros), Segurança (alterar senha).

- **Excluir Conta**  
  Quando houver endpoint de exclusão de conta no backend, implementar confirmação destrutiva (ex.: digitar "EXCLUIR") e chamada ao endpoint.

### 2.3 Dashboard

- **Taxa de Ocupação**  
  O cálculo pode ser refinado para usar a capacidade real do dia (slots disponíveis a partir de `business_hours` × barbeiros ativos) em vez de um divisor fixo, quando os dados estiverem disponíveis no front.

- **Período dos gráficos**  
  RevenueChart já aceita `range`; garantir que o seletor de período (date range) esteja visível e integrado na página do Dashboard quando existir.

### 2.4 Auth e perfil

- **GET /api/auth/me**  
  O `AuthContext` tem TODO para buscar perfil real após login. Implementar endpoint no backend e usar em `refetchProfile` para manter dados atualizados (ex.: após alterar nome no backend).

### 2.5 Acessibilidade e DX

- **React Router**  
  Avaliar future flags do React Router para remover warnings no console.

- **Focus em modais**  
  Validar que o foco fica preso nos modais (Radix já auxilia; conferir em todos os fluxos).

---

## 3. Novas features sugeridas para próxima run

### 3.1 Prioridade alta

- **Notificações / lembretes**  
  Lembrete 24h ou 1h antes do agendamento (e-mail ou WhatsApp). Depende de integração (já existe webhook WhatsApp; pode ser estendido).

- **Alterar senha (Configurações > Segurança)**  
  Fluxo "Alterar senha" (senha atual + nova + confirmação). Backend: endpoint para troca de senha do usuário autenticado.

- **Confirmação do agendamento público**  
  Após o cliente agendar via `/b/:slug`, enviar confirmação (e-mail ou WhatsApp) com resumo e opção de cancelar/reagendar (link ou integração n8n).

### 3.2 Prioridade média

- **Programa de fidelidade**  
  Regras (pontos por real gasto / por visita); backend: tabelas e cálculo; front: página Fidelidade com dados reais (ranking, recompensas, resgates). Tabelas `loyalty_rewards` e `reward_redemptions` já existem no schema.

- **Filtros e vista lista em Agendamentos**  
  Filtro por barbeiro, status, período; vista lista além da grade por dia.

- **Exportação (CSV/Excel)**  
  Exportar agendamentos do dia ou do mês para planejamento e contabilidade.

### 3.3 Prioridade baixa

- **Dashboard configurável**  
  Usuário escolher quais widgets exibir ou ordem (preferências no backend ou localStorage).

- **Múltiplas estabelecimentos (multi-tenant)**  
  Se o produto for usado por mais de uma unidade: seletor de estabelecimento, escopo por `barbershop_id`.

- **Página 404 customizada**  
  Manter ou melhorar a página NotFound com link de volta ao Dashboard.

---

## 4. Checklist de verificação (pós-ajustes já feitos)

- [x] Agendamentos: uso de `barber_id` na grade e tipo da API.
- [x] Tratamento de 409 (conflito de horário) no criar/editar agendamento.
- [x] Serviços: default de preço 35 e placeholder.
- [x] Configurações: loading ao abrir "Dados da NavalhIA".
- [x] Dashboard: gráficos com API de relatórios; loading/erro/empty nos cards.
- [x] Horário de funcionamento: DB, backend GET/PATCH, editor no front, slots em Agendamentos.
- [x] Link público: slug, rotas públicas, página `/b/:slug`, seção em Configurações.
- [x] CSS: `@import` no topo do `index.css`.
- [ ] GET /api/auth/me e uso no AuthContext.
- [ ] Testes manuais completos (ver `docs/MANUAL_TEST_CHECKLIST.md`).

---

## 5. Referências

- RUNBOOK: `docs/RUNBOOK.md`
- Checklist de teste manual: `docs/MANUAL_TEST_CHECKLIST.md`
- API frontend: `src/lib/api.ts`
- Relatório QA anterior: `docs/QA_WALKTHROUGH_REPORT.md`
