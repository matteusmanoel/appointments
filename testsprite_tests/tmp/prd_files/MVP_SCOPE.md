# MVP Scope — NavalhIA On-Prem

## Modelo de instalação

- **Single-tenant por cliente**: cada instalação on-prem atende **um estabelecimento**.
- Uma instância = um `barbershop_id` (fixo ou único no banco).
- Multi-tenant no schema é mantido para evolução futura (SaaS); no MVP o painel e as tools operam sobre o estabelecimento da instalação.

## Features mínimas do painel (Admin)

| Área | Funcionalidade | Incluso no MVP |
|------|----------------|----------------|
| **Acesso** | Login (email/senha ou magic link) | Sim |
| **Acesso** | Perfis: `admin`, `attendant` (opcional: só `admin`) | Sim (mínimo `admin`) |
| **Estabelecimento (NavalhIA)** | Dados básicos (nome, telefone, email, endereço) | Sim |
| **Barbeiros** | CRUD; status (active/inactive/break); horário de trabalho (schedule) | Sim |
| **Serviços** | CRUD; preço, duração, categoria, ativo | Sim |
| **Clientes** | CRUD; nome, telefone, email, notas; histórico (visitas, gasto, pontos) | Sim |
| **Agenda** | Criar / editar / cancelar agendamento | Sim |
| **Agenda** | Regra de conflito: um horário por barbeiro por slot | Sim |
| **Agenda** | Status: pending, confirmed, completed, cancelled, no_show | Sim |
| **Fidelidade** | Listar recompensas e resgates (somente leitura no MVP) | Sim (leitura) |
| **Configurações** | Seções de configuração (dados do estabelecimento, horários, etc.) | Sim (navegação + dados do estabelecimento) |
| **Logs** | Log de conversas WhatsApp (telefone, timestamps, ações) | Sim (mínimo) |

## Features mínimas do WhatsApp Bot (BarbeiroBot)

| Funcionalidade | Incluso no MVP |
|----------------|----------------|
| Receber mensagens (webhook Meta) | Sim |
| Responder com texto (agente IA) | Sim |
| Consultar serviços | Sim |
| Consultar barbeiros | Sim |
| Consultar agenda (horários ocupados por data) | Sim |
| Criar cliente se não existir (por telefone) | Sim |
| Criar agendamento **somente após confirmação explícita** | Sim |
| Log de conversas (id, telefone, timestamps, ações) | Sim |

## Fora do escopo do MVP

- Múltiplos estabelecimentos na mesma instalação (multi-tenant ativo).
- Pagamentos integrados.
- Lembretes automáticos (cron/notificações).
- App mobile nativo.
- Outros canais (Instagram, webchat) além do WhatsApp.

## Critérios de “MVP pronto para venda”

1. Deploy on-prem reprodutível (`docker compose`).
2. Painel admin com login e CRUD de estabelecimento, barbeiros, serviços, clientes e agenda.
3. WhatsApp: receber → agente (n8n) → tools na Product API → responder.
4. Regra de conflito de agenda aplicada na API.
5. Documentação de operação (runbook) e checklist de onboarding do primeiro cliente.
