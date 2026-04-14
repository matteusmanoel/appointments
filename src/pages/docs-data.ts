/**
 * Estrutura da documentação da API para a UI no estilo docs.uazapi.com
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface DocParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  example?: string;
}

export interface DocResponse {
  status: number;
  label: string;
}

export interface DocEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  title: string;
  description: string;
  bodyParams?: DocParam[];
  queryParams?: DocParam[];
  responses: DocResponse[];
  bodyExample?: string;
}

export interface DocGroup {
  name: string;
  count: number;
  endpoints: DocEndpoint[];
}

const API_BASE = "/api";

const groups: DocGroup[] = [
  {
    name: "Autenticação",
    count: 4,
    endpoints: [
      {
        id: "auth-login",
        method: "POST",
        path: `${API_BASE}/auth/login`,
        title: "Login",
        description:
          "Autentica com email e senha. Retorna um token JWT no header Authorization e o perfil do usuário. Use o token em requisições subsequentes via header `Authorization: Bearer <token>`.",
        bodyParams: [
          { name: "email", type: "string", required: true, description: "Email do usuário", example: "admin@navalhia.com.br" },
          { name: "password", type: "string", required: true, description: "Senha" },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Dados inválidos" },
          { status: 401, label: "Credenciais inválidas" },
        ],
        bodyExample: JSON.stringify({ email: "admin@navalhia.com.br", password: "********" }, null, 2),
      },
      {
        id: "auth-register",
        method: "POST",
        path: `${API_BASE}/auth/register`,
        title: "Registrar",
        description: "Cria uma nova conta (barbershop + perfil).",
        bodyParams: [
          { name: "email", type: "string", required: true },
          { name: "password", type: "string", required: true, description: "Mínimo 8 caracteres" },
          { name: "full_name", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos" },
        ],
        bodyExample: JSON.stringify({ email: "novo@navalhia.com.br", password: "********", full_name: "João" }, null, 2),
      },
      {
        id: "auth-me",
        method: "GET",
        path: `${API_BASE}/auth/me`,
        title: "Perfil atual",
        description: "Retorna o perfil do usuário autenticado. Requer header Authorization: Bearer <token>.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Token inválido/expirado" },
        ],
      },
      {
        id: "auth-password",
        method: "PATCH",
        path: `${API_BASE}/auth/password`,
        title: "Alterar senha",
        description: "Altera a senha do usuário autenticado.",
        bodyParams: [
          { name: "current_password", type: "string", required: true },
          { name: "new_password", type: "string", required: true, description: "Mínimo 8 caracteres" },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Senha atual incorreta ou nova inválida" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ current_password: "***", new_password: "********" }, null, 2),
      },
    ],
  },
  {
    name: "NavalhIA (estabelecimentos)",
    count: 2,
    endpoints: [
      {
        id: "barbershops-list",
        method: "GET",
        path: `${API_BASE}/barbershops`,
        title: "Listar NavalhIA",
        description: "Retorna a NavalhIA do usuário autenticado.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "barbershops-patch",
        method: "PATCH",
        path: `${API_BASE}/barbershops`,
        title: "Atualizar NavalhIA",
        description: "Atualiza dados da NavalhIA (nome, slug, horários, etc.).",
        bodyParams: [
          { name: "name", type: "string", required: false },
          { name: "slug", type: "string", required: false },
          { name: "business_hours", type: "object", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ name: "NavalhIA do Zé", slug: "navalhia-do-ze" }, null, 2),
      },
    ],
  },
  {
    name: "Barbeiros",
    count: 5,
    endpoints: [
      {
        id: "barbers-list",
        method: "GET",
        path: `${API_BASE}/barbers`,
        title: "Listar barbeiros",
        description: "Lista barbeiros da NavalhIA.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "barbers-create",
        method: "POST",
        path: `${API_BASE}/barbers`,
        title: "Criar barbeiro",
        description: "Cadastra um novo barbeiro.",
        bodyParams: [
          { name: "name", type: "string", required: true },
          { name: "status", type: "string", required: false, description: "active | break | inactive" },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ name: "Carlos", status: "active" }, null, 2),
      },
      {
        id: "barbers-get",
        method: "GET",
        path: `${API_BASE}/barbers/:id`,
        title: "Obter barbeiro",
        description: "Retorna um barbeiro pelo ID.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "barbers-patch",
        method: "PATCH",
        path: `${API_BASE}/barbers/:id`,
        title: "Atualizar barbeiro",
        description: "Atualiza dados do barbeiro.",
        bodyParams: [
          { name: "name", type: "string", required: false },
          { name: "status", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ name: "Carlos Silva", status: "break" }, null, 2),
      },
      {
        id: "barbers-delete",
        method: "DELETE",
        path: `${API_BASE}/barbers/:id`,
        title: "Excluir barbeiro",
        description: "Remove o barbeiro (soft ou hard conforme implementação).",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Serviços",
    count: 5,
    endpoints: [
      {
        id: "services-list",
        method: "GET",
        path: `${API_BASE}/services`,
        title: "Listar serviços",
        description: "Lista serviços da NavalhIA.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "services-create",
        method: "POST",
        path: `${API_BASE}/services`,
        title: "Criar serviço",
        description: "Cadastra um novo serviço.",
        bodyParams: [
          { name: "name", type: "string", required: true },
          { name: "description", type: "string", required: false },
          { name: "price", type: "number", required: true },
          { name: "duration_minutes", type: "number", required: true },
          { name: "category", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({
          name: "Corte",
          description: "Corte masculino",
          price: 35,
          duration_minutes: 30,
          category: "corte",
        }, null, 2),
      },
      {
        id: "services-get",
        method: "GET",
        path: `${API_BASE}/services/:id`,
        title: "Obter serviço",
        description: "Retorna um serviço pelo ID.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "services-patch",
        method: "PATCH",
        path: `${API_BASE}/services/:id`,
        title: "Atualizar serviço",
        description: "Atualiza um serviço.",
        bodyParams: [
          { name: "name", type: "string", required: false },
          { name: "description", type: "string", required: false },
          { name: "price", type: "number", required: false },
          { name: "duration_minutes", type: "number", required: false },
          { name: "category", type: "string", required: false },
          { name: "is_active", type: "boolean", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ price: 40, is_active: true }, null, 2),
      },
      {
        id: "services-delete",
        method: "DELETE",
        path: `${API_BASE}/services/:id`,
        title: "Excluir serviço",
        description: "Remove o serviço.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Clientes",
    count: 5,
    endpoints: [
      {
        id: "clients-list",
        method: "GET",
        path: `${API_BASE}/clients`,
        title: "Listar clientes",
        description: "Lista clientes da NavalhIA.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "clients-create",
        method: "POST",
        path: `${API_BASE}/clients`,
        title: "Criar cliente",
        description: "Cadastra um novo cliente.",
        bodyParams: [
          { name: "name", type: "string", required: true },
          { name: "phone", type: "string", required: true },
          { name: "notes", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ name: "Maria", phone: "11999999999", notes: "" }, null, 2),
      },
      {
        id: "clients-get",
        method: "GET",
        path: `${API_BASE}/clients/:id`,
        title: "Obter cliente",
        description: "Retorna um cliente pelo ID.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "clients-patch",
        method: "PATCH",
        path: `${API_BASE}/clients/:id`,
        title: "Atualizar cliente",
        description: "Atualiza dados do cliente.",
        bodyParams: [
          { name: "name", type: "string", required: false },
          { name: "phone", type: "string", required: false },
          { name: "notes", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ name: "Maria Silva", phone: "11988887777" }, null, 2),
      },
      {
        id: "clients-delete",
        method: "DELETE",
        path: `${API_BASE}/clients/:id`,
        title: "Excluir cliente",
        description: "Remove o cliente.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Agendamentos",
    count: 5,
    endpoints: [
      {
        id: "appointments-list",
        method: "GET",
        path: `${API_BASE}/appointments`,
        title: "Listar agendamentos",
        description: "Lista agendamentos com filtros opcionais (date_from, date_to, status, barber_id).",
        queryParams: [
          { name: "date_from", type: "string", description: "YYYY-MM-DD" },
          { name: "date_to", type: "string", description: "YYYY-MM-DD" },
          { name: "status", type: "string", description: "scheduled | completed | cancelled | no_show" },
          { name: "barber_id", type: "string", description: "UUID do barbeiro" },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "appointments-create",
        method: "POST",
        path: `${API_BASE}/appointments`,
        title: "Criar agendamento",
        description: "Cria um novo agendamento.",
        bodyParams: [
          { name: "barber_id", type: "string", required: true },
          { name: "client_id", type: "string", required: true },
          { name: "scheduled_date", type: "string", required: true, description: "YYYY-MM-DD" },
          { name: "scheduled_time", type: "string", required: true, description: "HH:mm" },
          { name: "service_ids", type: "array", required: true, description: "UUIDs dos serviços" },
          { name: "notes", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos ou horário indisponível" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({
          barber_id: "uuid",
          client_id: "uuid",
          scheduled_date: "2025-02-20",
          scheduled_time: "10:00",
          service_ids: ["uuid"],
          notes: "",
        }, null, 2),
      },
      {
        id: "appointments-get",
        method: "GET",
        path: `${API_BASE}/appointments/:id`,
        title: "Obter agendamento",
        description: "Retorna um agendamento pelo ID.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "appointments-patch",
        method: "PATCH",
        path: `${API_BASE}/appointments/:id`,
        title: "Atualizar agendamento",
        description: "Atualiza status ou dados do agendamento.",
        bodyParams: [
          { name: "status", type: "string", required: false },
          { name: "scheduled_date", type: "string", required: false },
          { name: "scheduled_time", type: "string", required: false },
          { name: "notes", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ status: "completed" }, null, 2),
      },
      {
        id: "appointments-delete",
        method: "DELETE",
        path: `${API_BASE}/appointments/:id`,
        title: "Excluir/cancelar agendamento",
        description: "Cancela ou remove o agendamento.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Relatórios",
    count: 2,
    endpoints: [
      {
        id: "reports-revenue",
        method: "GET",
        path: `${API_BASE}/reports/revenue_by_day`,
        title: "Receita por dia",
        description: "Retorna receita agrupada por dia (query: date_from, date_to).",
        queryParams: [
          { name: "date_from", type: "string", description: "YYYY-MM-DD" },
          { name: "date_to", type: "string", description: "YYYY-MM-DD" },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "reports-top-services",
        method: "GET",
        path: `${API_BASE}/reports/top_services`,
        title: "Serviços mais vendidos",
        description: "Retorna ranking de serviços por quantidade (query: date_from, date_to).",
        queryParams: [
          { name: "date_from", type: "string", description: "YYYY-MM-DD" },
          { name: "date_to", type: "string", description: "YYYY-MM-DD" },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Fidelidade",
    count: 5,
    endpoints: [
      {
        id: "loyalty-stats",
        method: "GET",
        path: `${API_BASE}/loyalty/stats`,
        title: "Estatísticas de fidelidade",
        description: "Retorna totais de pontos, resgates e clientes no programa.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "loyalty-rewards",
        method: "GET",
        path: `${API_BASE}/loyalty/rewards`,
        title: "Listar recompensas",
        description: "Lista recompensas configuradas (pontos necessários, descrição).",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "loyalty-ranking",
        method: "GET",
        path: `${API_BASE}/loyalty/ranking`,
        title: "Ranking de pontos",
        description: "Retorna ranking de clientes por pontos.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "loyalty-redeem",
        method: "POST",
        path: `${API_BASE}/loyalty/redeem`,
        title: "Resgatar recompensa",
        description: "Resgata uma recompensa para um cliente (deduz pontos).",
        bodyParams: [
          { name: "client_id", type: "string", required: true },
          { name: "reward_id", type: "string", required: true },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Pontos insuficientes ou recompensa inexistente" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ client_id: "uuid", reward_id: "uuid" }, null, 2),
      },
      {
        id: "loyalty-redemptions",
        method: "GET",
        path: `${API_BASE}/loyalty/redemptions`,
        title: "Histórico de resgates",
        description: "Lista resgates realizados.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Agendamento público",
    count: 5,
    endpoints: [
      {
        id: "public-slug",
        method: "GET",
        path: `${API_BASE}/public/:slug`,
        title: "Dados da NavalhIA (público)",
        description: "Retorna dados básicos da NavalhIA pelo slug. Não requer autenticação.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "NavalhIA não encontrada" },
        ],
      },
      {
        id: "public-services",
        method: "GET",
        path: `${API_BASE}/public/:slug/services`,
        title: "Serviços (público)",
        description: "Lista serviços ativos da NavalhIA pelo slug.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "NavalhIA não encontrada" },
        ],
      },
      {
        id: "public-barbers",
        method: "GET",
        path: `${API_BASE}/public/:slug/barbers`,
        title: "Barbeiros (público)",
        description: "Lista barbeiros ativos da NavalhIA pelo slug.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "NavalhIA não encontrada" },
        ],
      },
      {
        id: "public-availability",
        method: "GET",
        path: `${API_BASE}/public/:slug/availability`,
        title: "Disponibilidade (público)",
        description: "Retorna horários já ocupados em uma data. Query: date=YYYY-MM-DD.",
        queryParams: [
          { name: "date", type: "string", required: true, description: "YYYY-MM-DD" },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Query date obrigatória" },
          { status: 404, label: "NavalhIA não encontrada" },
        ],
      },
      {
        id: "public-appointments",
        method: "POST",
        path: `${API_BASE}/public/:slug/appointments`,
        title: "Criar agendamento (público)",
        description:
          "Cria agendamento pela página pública. Não requer autenticação. Body: barber_id, scheduled_date, scheduled_time, client_name, client_phone, service_id ou service_ids, notes opcional.",
        bodyParams: [
          { name: "barber_id", type: "string", required: true },
          { name: "scheduled_date", type: "string", required: true, description: "YYYY-MM-DD" },
          { name: "scheduled_time", type: "string", required: true, description: "HH:mm" },
          { name: "client_name", type: "string", required: true },
          { name: "client_phone", type: "string", required: true },
          { name: "service_id", type: "string", required: false, description: "Ou use service_ids" },
          { name: "service_ids", type: "array", required: false },
          { name: "notes", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos ou horário indisponível" },
          { status: 404, label: "NavalhIA não encontrada" },
        ],
        bodyExample: JSON.stringify({
          barber_id: "uuid",
          scheduled_date: "2025-02-20",
          scheduled_time: "10:00",
          client_name: "João",
          client_phone: "11999999999",
          service_ids: ["uuid"],
        }, null, 2),
      },
    ],
  },
  {
    name: "Integrações",
    count: 8,
    endpoints: [
      {
        id: "integrations-api-keys-list",
        method: "GET",
        path: `${API_BASE}/integrations/api-keys`,
        title: "Listar chaves de API",
        description: "Lista chaves de API da NavalhIA.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "integrations-api-keys-create",
        method: "POST",
        path: `${API_BASE}/integrations/api-keys`,
        title: "Criar chave de API",
        description: "Gera uma nova chave de API (nome opcional).",
        bodyParams: [
          { name: "name", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ name: "n8n" }, null, 2),
      },
      {
        id: "integrations-api-keys-delete",
        method: "DELETE",
        path: `${API_BASE}/integrations/api-keys/:id`,
        title: "Revogar chave de API",
        description: "Remove uma chave de API.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "integrations-n8n-webhook-get",
        method: "GET",
        path: `${API_BASE}/integrations/n8n-webhook`,
        title: "URL do webhook n8n",
        description:
          "Retorna a Production URL do webhook n8n salva para a barbearia (agente quando IA nativa está desligada).",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "integrations-n8n-webhook-patch",
        method: "PATCH",
        path: `${API_BASE}/integrations/n8n-webhook`,
        title: "Salvar URL do webhook n8n",
        description:
          "Define ou remove a URL. Use null para limpar (fallback: variável de ambiente no servidor). Exige https em produção.",
        bodyParams: [{ name: "n8n_chat_webhook_url", type: "string | null", required: true }],
        bodyExample: JSON.stringify(
          { n8n_chat_webhook_url: "https://n8n.exemplo.com/webhook/abc" },
          null,
          2
        ),
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "URL inválida" },
          { status: 401, label: "Não autorizado" },
          { status: 503, label: "Migration não aplicada" },
        ],
      },
      {
        id: "integrations-whatsapp",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp`,
        title: "Status WhatsApp",
        description: "Retorna estado da conexão WhatsApp (UAZAPI) da NavalhIA.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "integrations-followup-credits",
        method: "GET",
        path: `${API_BASE}/integrations/automations/followup/credits`,
        title: "Créditos de follow-up",
        description: "Retorna saldo de créditos para follow-up manual (reativação de clientes).",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "integrations-followup-eligible",
        method: "GET",
        path: `${API_BASE}/integrations/automations/followup/eligible`,
        title: "Clientes elegíveis a follow-up",
        description: "Lista clientes inativos por N dias (última atividade = máximo entre último agendamento e último WhatsApp). Query: days, limit?, search?.",
        queryParams: [
          { name: "days", type: "number", required: true, description: "Dias sem atividade" },
          { name: "limit", type: "number", required: false },
          { name: "search", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "integrations-followup-dispatch",
        method: "POST",
        path: `${API_BASE}/integrations/automations/followup/dispatch`,
        title: "Disparar follow-up",
        description: "Enfileira mensagens follow-up (30d) para os clientes selecionados. Deduz créditos. Body: { client_ids: string[], days: number }.",
        bodyParams: [
          { name: "client_ids", type: "array", required: true },
          { name: "days", type: "number", required: true },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Créditos insuficientes ou dados inválidos" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ client_ids: ["uuid1", "uuid2"], days: 30 }, null, 2),
      },
      {
        id: "integrations-scheduled-messages-list",
        method: "GET",
        path: `${API_BASE}/integrations/automations/scheduled-messages`,
        title: "Listar mensagens agendadas",
        description: "Lista lembretes e follow-ups (tipo e status). Query: type?, status?, limit?.",
        queryParams: [
          { name: "type", type: "string", required: false, description: "reminder_24h | reminder_2h | followup_30d" },
          { name: "status", type: "string", required: false },
          { name: "limit", type: "number", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "WhatsApp e Agente de IA",
    count: 19,
    endpoints: [
      {
        id: "whatsapp-uazapi-connectivity",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/uazapi/connectivity`,
        title: "Testar conectividade UAZAPI",
        description: "Verifica se a API alcança a Uazapi. Retorna { api, uazapi: { ok, error? } }.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-uazapi-start",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/uazapi/start`,
        title: "Iniciar conexão WhatsApp (UAZAPI)",
        description: "Cria instância (se não existir), configura webhook e inicia pareamento. Body opcional: { phone?: string } para código de pareamento. Retorna status, qr?, pairingCode?, webhook_warning?.",
        bodyParams: [{ name: "phone", type: "string", required: false, description: "Número com DDD para código de pareamento" }],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({}, null, 2),
      },
      {
        id: "whatsapp-uazapi-status",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/uazapi/status`,
        title: "Status da conexão UAZAPI",
        description: "Retorna status atual, connected, qr e pairingCode (enquanto aguarda pareamento).",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-uazapi-disconnect",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/uazapi/disconnect`,
        title: "Desconectar WhatsApp (UAZAPI)",
        description: "Remove o pareamento da instância Uazapi.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-uazapi-send-test",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/uazapi/send-test`,
        title: "Enviar mensagem de teste (UAZAPI)",
        description: "Envia uma mensagem de teste para um número. Body opcional: { number?, text? }.",
        bodyParams: [
          { name: "number", type: "string", required: false },
          { name: "text", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
        bodyExample: JSON.stringify({ number: "11999999999", text: "Teste NavalhIA" }, null, 2),
      },
      {
        id: "whatsapp-assume",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/assume`,
        title: "Assumir atendimento (pausar IA)",
        description: "Pausa a IA para atendimento manual (handoff) na conversa atual.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-resume",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/resume`,
        title: "Retomar IA",
        description: "Retoma a IA após assumir atendimento manualmente.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-usage",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/usage`,
        title: "Uso de mensagens WhatsApp",
        description: "Retorna used, limit, softExceeded, hardExceeded e billingPlan do barbershop.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-ai-settings-get",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/ai-settings`,
        title: "Obter configurações do agente",
        description:
          "Retorna configurações de IA: enabled, timezone, model, temperature, agent_profile, additional_instructions, max_output_tokens, typing_simulation.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-ai-settings-put",
        method: "PUT",
        path: `${API_BASE}/integrations/whatsapp/ai-settings`,
        title: "Atualizar configurações do agente",
        description:
          "Atualiza agent_profile, additional_instructions, max_output_tokens, typing_simulation.",
        bodyParams: [
          { name: "agent_profile", type: "object", required: false },
          { name: "additional_instructions", type: "string", required: false },
          { name: "max_output_tokens", type: "number", required: false },
          { name: "typing_simulation", type: "object", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Body inválido" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-ai-settings-publish",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/ai-settings/publish`,
        title: "Publicar configurações",
        description: "Cria nova versão publicada do prompt e configurações.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-ai-settings-rollback",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/ai-settings/rollback`,
        title: "Reverter para versão anterior",
        description: "Body: { version_id }.",
        bodyParams: [{ name: "version_id", type: "string", required: true }],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-ai-settings-versions",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/ai-settings/versions`,
        title: "Listar versões publicadas",
        description: "Lista versões para rollback.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-config",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/knowledge/config`,
        title: "Config base de conhecimento",
        description: "Retorna { storage_configured: boolean }.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-sources-list",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/knowledge/sources`,
        title: "Listar fontes",
        description: "Lista categorias de documentos.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-sources-create",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/knowledge/sources`,
        title: "Criar fonte",
        description: "Body: { name }.",
        bodyParams: [{ name: "name", type: "string", required: true }],
        responses: [
          { status: 201, label: "Criado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-documents-list",
        method: "GET",
        path: `${API_BASE}/integrations/whatsapp/knowledge/documents`,
        title: "Listar documentos",
        description: "Query opcional: source_id.",
        queryParams: [{ name: "source_id", type: "string", required: false }],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-documents-create",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/knowledge/documents`,
        title: "Criar documento (obter URL de upload)",
        description:
          "Retorna upload_url. Fluxo: POST → PUT arquivo na URL → POST .../documents/:id/complete.",
        bodyParams: [
          { name: "title", type: "string", required: true },
          { name: "original_filename", type: "string", required: true },
          { name: "mime_type", type: "string", required: true },
          { name: "source_id", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 503, label: "S3 não configurado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-documents-complete",
        method: "POST",
        path: `${API_BASE}/integrations/whatsapp/knowledge/documents/:id/complete`,
        title: "Finalizar upload e processar",
        description: "Chamar após PUT do arquivo. Dispara processamento (chunks + embeddings).",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
      {
        id: "whatsapp-knowledge-documents-delete",
        method: "DELETE",
        path: `${API_BASE}/integrations/whatsapp/knowledge/documents/:id`,
        title: "Excluir documento",
        description: "Remove documento da base de conhecimento.",
        responses: [
          { status: 204, label: "Sucesso" },
          { status: 404, label: "Não encontrado" },
          { status: 401, label: "Não autorizado" },
        ],
      },
    ],
  },
  {
    name: "Ferramentas (API Key)",
    count: 5,
    endpoints: [
      {
        id: "tools-list-services",
        method: "GET",
        path: `${API_BASE}/tools/list_services`,
        title: "Listar serviços (tools)",
        description: "Lista serviços. Requer header X-API-Key com chave de API da NavalhIA.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "barbershop_id indisponível" },
          { status: 401, label: "API Key inválida" },
        ],
      },
      {
        id: "tools-list-barbers",
        method: "GET",
        path: `${API_BASE}/tools/list_barbers`,
        title: "Listar barbeiros (tools)",
        description: "Lista barbeiros. Requer X-API-Key.",
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 401, label: "API Key inválida" },
        ],
      },
      {
        id: "tools-list-appointments",
        method: "GET",
        path: `${API_BASE}/tools/list_appointments`,
        title: "Listar ocupação (tools)",
        description: "Lista agendamentos de uma data. Query: date=YYYY-MM-DD, barber_id opcional. Requer X-API-Key.",
        queryParams: [
          { name: "date", type: "string", required: true },
          { name: "barber_id", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "date obrigatório" },
          { status: 401, label: "API Key inválida" },
        ],
      },
      {
        id: "tools-upsert-client",
        method: "POST",
        path: `${API_BASE}/tools/upsert_client`,
        title: "Criar/atualizar cliente (tools)",
        description: "Upsert cliente por telefone. Body: phone, name, notes. Requer X-API-Key.",
        bodyParams: [
          { name: "phone", type: "string", required: true },
          { name: "name", type: "string", required: false },
          { name: "notes", type: "string", required: false },
        ],
        responses: [
          { status: 200, label: "Sucesso" },
          { status: 400, label: "Dados inválidos" },
          { status: 401, label: "API Key inválida" },
        ],
        bodyExample: JSON.stringify({ phone: "11999999999", name: "João" }, null, 2),
      },
      {
        id: "tools-create-appointment",
        method: "POST",
        path: `${API_BASE}/tools/create_appointment`,
        title: "Criar agendamento (tools)",
        description: "Cria agendamento. Body: barber_id, scheduled_date, scheduled_time, service_ids, client_id ou client_phone. Requer X-API-Key.",
        bodyParams: [
          { name: "barber_id", type: "string", required: true },
          { name: "scheduled_date", type: "string", required: true },
          { name: "scheduled_time", type: "string", required: true },
          { name: "service_ids", type: "array", required: true },
          { name: "client_id", type: "string", required: false },
          { name: "client_phone", type: "string", required: false },
        ],
        responses: [
          { status: 201, label: "Criado" },
          { status: 400, label: "Dados inválidos ou horário indisponível" },
          { status: 401, label: "API Key inválida" },
        ],
        bodyExample: JSON.stringify({
          barber_id: "uuid",
          scheduled_date: "2025-02-20",
          scheduled_time: "10:00",
          service_ids: ["uuid"],
          client_phone: "11999999999",
        }, null, 2),
      },
    ],
  },
];

export const docsGroups = groups;

export const totalEndpoints = groups.reduce((acc, g) => acc + g.count, 0);

export function findEndpointById(id: string): DocEndpoint | undefined {
  for (const group of groups) {
    const ep = group.endpoints.find((e) => e.id === id);
    if (ep) return ep;
  }
  return undefined;
}

export const SCHEMAS_COUNT = 0; // opcional: podemos adicionar schemas depois
