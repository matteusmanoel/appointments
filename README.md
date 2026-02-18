# BarberFlow (barber-harmony)

Sistema web (SPA) para **gestão de barbearias** com foco em operação diária: **agenda**, **barbeiros**, **serviços**, **clientes**, **fidelidade** e **configurações**.  
Frontend em React + Vite conectado à **Product API** (backend em Node/Express); banco Postgres com schema em `supabase/migrations/`. Deploy on-prem via Docker Compose; integração WhatsApp e n8n (agente + tools) documentada em `docs/`.

> O painel usa login (JWT) e dados reais da API. Configure `VITE_API_URL` (ex.: `http://localhost:3000`) no `.env` do frontend.

## Visão geral

- **Tipo**: SPA (Single Page Application) em React
- **Rotas**: React Router
- **Dados/Cache**: TanStack React Query (configurado no app)
- **UI/UX**: TailwindCSS + shadcn/ui (Radix UI) + ícones Lucide + gráficos Recharts
- **Backend**: Supabase (Postgres + Row Level Security + funções e triggers)
- **Objetivo do domínio**: operação multi-tenant por barbearia (`barbershop_id`), com perfis e permissões.

## Módulos (funcionalidades)

### Dashboard (`/`)

Painel de visão geral com:

- KPIs (faturamento do dia, agendamentos, clientes atendidos, ocupação)
- Gráfico semanal de faturamento
- Ranking de serviços mais contratados
- Lista de próximos agendamentos

### Agendamentos (`/agendamentos`)

Agenda diária com:

- Navegação por data
- Grade por horário x barbeiro
- Slots vazios e cartões de agendamento (cliente, serviço, telefone)

### Barbeiros (`/barbeiros`)

Gestão de equipe:

- Lista de barbeiros e status (ativo/intervalo/offline)
- Serviços por barbeiro
- Indicadores (agenda hoje, atendimentos/mês, receita/mês, avaliação)

### Serviços (`/servicos`)

Catálogo de serviços:

- Nome/descrição
- Preço, duração, comissão
- Categoria (corte/barba/combo/tratamento/adicional)
- Indicadores de uso e receita

### Clientes (`/clientes`)

CRM simplificado:

- Busca por nome/telefone
- Histórico (visitas, total gasto, pontos, última visita)
- Preferências (barbeiro/serviço favorito)

### Fidelidade (`/fidelidade`)

Programa de pontos:

- Top clientes por pontos
- Recompensas disponíveis
- Métricas de retorno e resgates

### Configurações (`/configuracoes`)

Seções de configuração:

- Dados da barbearia
- Horário de funcionamento
- Link público de agendamento
- Notificações
- Pagamentos/comissões
- Segurança e conta

## Arquitetura (como o projeto está organizado)

### Fluxo principal da aplicação

- `src/main.tsx` monta o React no DOM.
- `src/App.tsx` define providers globais (React Query, tooltips, toasts) e as rotas.

Rotas registradas hoje:
