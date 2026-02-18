# Relatório de Teste Walkthrough – BarberFlow

**Data:** 12/02/2025 | **URL:** http://localhost:3002 | **Método:** Análise de código + snapshot inicial

---

## 1. Resumo

O app carregou corretamente. Dashboard usa API real para agendamentos; gráficos são estáticos. Principais gaps: botões CRUD sem ação, Agendamentos com dados mockados, layout mobile fixo, sem toggle dark mode.

---

## 2. Login

- Rota `/login` existe. Campos email/senha. Placeholder: admin@barbearia.com
- Credenciais sugeridas: admin@barbearia.com / admin123
- AuthContext lê profile de localStorage; ProtectedRoute redireciona se não logado
- 401 na API redireciona para /login

---

## 3. Walkthrough por Página

### Dashboard (/)
- **API:** appointmentsApi.list({ date: today })
- **Estado vazio:** "Nenhum agendamento para hoje."
- **BUG:** Taxa de Ocupação mostra "—" quando há agendamentos (deveria calcular %)
- **Gráficos:** RevenueChart e TopServices usam dados mockados

### Agendamentos (/agendamentos)
- **Dados:** 100% mock (barbers, appointments, timeSlots)
- **Navegação data:** ChevronLeft/Right sem onClick
- **CRUD:** Novo Agendamento, células Plus, MoreVertical – nenhuma ação

### Barbeiros (/barbeiros)
- **API:** barbersApi.list()
- **CRUD:** Adicionar Barbeiro e MoreVertical – sem ação

### Serviços (/servicos)
- **API:** servicesApi.list()
- **CRUD:** Adicionar Serviço e MoreVertical – sem ação

### Clientes (/clientes)
- **API:** clientsApi.list(search)
- **CRUD:** Adicionar Cliente e MoreVertical – sem ação

### Fidelidade (/fidelidade)
- **Dados:** 100% mock (topClients, rewards)

### Configurações (/configuracoes)
- Seções são buttons sem destino. Excluir Conta sem confirmação.

---

## 4. Dark Mode e Acessibilidade

- **Dark:** Tailwind darkMode:class. CSS .dark existe. Sem ThemeProvider. Sonner usa useTheme() – risco de erro. Sem toggle.
- **A11y:** Labels em Login ok. Ícones (MoreVertical, Plus) sem aria-label.
- **Contraste:** Gráficos com cores fixas – podem falhar em dark.

---

## 5. Responsividade Mobile

- MainLayout pl-64 fixo. Sidebar w-64 fixa.
- Sem drawer/hamburger. Em ~390px sidebar sobrepõe ou empurra conteúdo.

---

## 6. Bugs

| # | Sev | Descrição |
|---|-----|-----------|
| 1 | Alta | Taxa de Ocupação "—" quando há agendamentos |
| 2 | Alta | Botões Adicionar sem ação |
| 3 | Alta | MoreVertical sem menu |
| 4 | Alta | Navegação data em Agendamentos não funciona |
| 5 | Média | Agendamentos usa mock |
| 6 | Média | Fidelidade mock |
| 7 | Média | Configurações sem ação |
| 8 | Média | Layout mobile: sidebar fixa |
| 9 | Baixa | Sonner sem ThemeProvider |
| 10 | Baixa | Título "Lovable App" |

---

## 7. Console

0 erros. 2 warnings React Router Future Flag.

---

## 8. Melhorias Sugeridas

**Alta:** Modais CRUD, conectar Agendamentos à API, corrigir Taxa de Ocupação, datas em Agendamentos, menu MoreVertical.

**Média:** Sidebar mobile, Fidelidade API, Configurações funcionais, confirmação Excluir Conta, título.

**Baixa:** ThemeProvider, toggle dark, aria-label, gráficos dark.

---

## 9. Checklist MVP-Pronto

- [x] Login, ProtectedRoute, Logout
- [x] Dashboard cards dinâmicos
- [ ] Taxa de Ocupação correta
- [ ] Gráficos com dados reais
- [ ] Agendamentos API + datas + CRUD
- [ ] Barbeiros/Serviços/Clientes CRUD modals
- [ ] Fidelidade real ou placeholder
- [ ] Configurações editáveis
- [ ] Sidebar mobile
- [ ] ThemeProvider (Sonner)
- [ ] index.html title correto

---

## 10. Reprodução

**Bug 1:** Ter ≥1 agendamento hoje → Dashboard → Taxa de Ocupação mostra "—".

**Bugs 2–4:** Clicar em Adicionar Barbeiro, MoreVertical, setas em Agendamentos → nada acontece.

**Bug 8:** DevTools 390px → sidebar sobrepõe.

---

## Atualização pós-MVP (12/02/2025)

Os itens acima foram tratados no MVP. Para **ajustes nas funcionalidades atuais** e **novas features** sugeridas para a próxima run, ver: **[LEVANTAMENTO_AJUSTES_E_FEATURES.md](./LEVANTAMENTO_AJUSTES_E_FEATURES.md)**.
