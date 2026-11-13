# Matriz de permissões do painel (RBAC)

Papéis (`profiles.role`, `CHECK ('admin','manager','attendant')`, já viajam no JWT):

- **admin** — dono da conta. É o papel criado no checkout (`routes/billing.ts`) e no registro (`routes/auth.ts`).
- **manager** — gerente. Opera e configura a barbearia, sem acesso ao que é de titularidade da conta.
- **attendant** — recepção. Só o dia a dia: agenda, clientes, fila de espera, fidelidade, inbox do WhatsApp.

Base no que o produto já sugere: `docs/MVP_SCOPE.md` (perfis `admin` e `attendant`) e o CHECK do banco (`manager` é o default da coluna).
Papel ausente ou desconhecido → **403** (fail closed). Comparação normalizada para minúsculas. Sem token → 401 (inalterado).

Implementação: `backend/src/middleware/rbac.ts` (`requireRole(...)` para rota única e `accessRules([...], fallback)` por router, "primeira regra que casa vence"). Testes: `backend/src/__tests__/rbac-routes.test.ts` (a própria matriz abaixo, em forma de dados).

| Área (prefixo `/api`) | Leitura | Escrita (criar/editar) | Exclusão |
|---|---|---|---|
| `appointments` | A M T | A M T | — |
| `clients` | A M T | A M T | A M |
| `waitlist`, `loyalty` (inclui resgate) | A M T | A M T | A M T |
| `barbers` (equipe) | A M T | A M | A M |
| `services` (catálogo) | A M T | A M | A M |
| `barbershops` (dados, horários, fechamentos) | A M T | A M | A M |
| `barbershops` POST `/` (criar nova unidade) | — | A | — |
| `plans` (planos, assinaturas, cobranças/Pix) | A M T | A M | A M |
| `reports` (receita, serviços, comissões, métricas) | A M | — | — |
| `reports/agenda-activity` | A M T | — | — |
| `intelligence` (reativação, filas) | A M | A M | — |
| `intelligence/day-summary` | A M T | — | — |
| `integrations/whatsapp` — inbox (`/`, `/status`, `/connectivity`, `/usage`, `/conversations/*`, `/assume`, `/resume`, `/contact-photo/sync`) | A M T | A M T | A M (`DELETE /conversations/:id`) |
| `integrations/whatsapp` — conexão, `number-mode`, `uazapi/*`, IA (`ai-*`), base de conhecimento (`knowledge/*`), figurinhas | A M | A M | A M |
| `integrations` — automações, modelos, mensagens agendadas, campanhas | A M | A M | A M |
| `integrations/api-keys`, `integrations/n8n-webhook` | A | A | A |
| `billing/portal`, `billing/credits_checkout` (Stripe) | — | A | — |
| `account` (excluir unidade / excluir conta) | — | — | A |

A = admin, M = manager, T = attendant (atendente).

Fora da matriz (não mudam): `auth/*` (login, `me`, troca de senha — qualquer usuário autenticado), `public/*` (agendamento público), `/tools` (chave de API por barbearia), webhooks.

Observações para o PR:

1. **Compatibilidade**: hoje todos os usuários criados pelo produto são `admin` (checkout/registro) e não há tela para criar manager/attendant; portanto nenhum usuário existente perde acesso. Contas criadas manualmente com o default do banco (`manager`) mantêm tudo, exceto as ações exclusivas de admin acima.
2. O papel vem do JWT emitido no login: alterar `profiles.role` só vale após novo login (o token dura o seu TTL).
3. Pendência de UI (não incluída): esconder no frontend os itens que o atendente não pode usar; hoje ele receberia 403 com a mensagem "Seu perfil não tem permissão para esta ação".
4. Quando existir gestão de usuários, a rota de convite/edição de papéis deve ser `requireRole("admin")`.
