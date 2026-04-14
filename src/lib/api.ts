const API_BASE = import.meta.env.VITE_API_URL ?? "";

if (import.meta.env.DEV && typeof window !== "undefined") {
  const mode = API_BASE ? "direct" : "proxy (same-origin /api)";
  console.debug("[api] dev:", mode, API_BASE ? `→ ${API_BASE}` : "");
}

/** Erro lançado em 401 para que o React Query não faça retry (evita dezenas de requisições falhando). */
export class AuthError extends Error {
  constructor(message = "Sessão expirada") {
    super(message);
    this.name = "AuthError";
  }
}

export const getToken = (): string | null => localStorage.getItem("token");

export function setToken(token: string): void {
  localStorage.setItem("token", token);
}

export function clearToken(): void {
  localStorage.removeItem("token");
}

/** When "__all__", list endpoints request data for all barbershops in the account. Set by AuthContext. */
let barbershopScope: "__all__" | null = null;
export function setBarbershopScope(scope: "__all__" | null): void {
  barbershopScope = scope;
}
export function getBarbershopScope(): "__all__" | null {
  return barbershopScope;
}

/** Default request timeout (ms). Prevents infinite loading on slow/hung endpoints. */
const DEFAULT_API_TIMEOUT_MS = 15_000;

export async function api<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...fetchOptions } = options;
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: fetchOptions.signal ?? controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        throw new Error("A requisição demorou demais. Tente novamente.");
      }
      throw e;
    }
    throw e;
  }
  clearTimeout(timeoutId);

  if (res.status === 401) {
    clearToken();
    localStorage.removeItem("profile");
    window.location.href = "/login";
    throw new AuthError("Sessão expirada");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

export type AuthProfileBarbershop = {
  id: string;
  name: string;
  slug?: string;
  billing_plan: string;
};

export type AuthProfile = {
  id: string;
  email: string;
  full_name?: string;
  barbershop_id: string;
  role: string;
  must_change_password?: boolean;
  billing_plan?: BillingPlan;
  barbershops?: AuthProfileBarbershop[];
};

/**
 * Normaliza o perfil vindo da API ou de `localStorage` para que o modal de troca de senha
 * só apareça quando o backend realmente exigir (evita `!!"false"` truthy e strings legadas).
 */
export function normalizeAuthProfile<T extends AuthProfile>(raw: T): T {
  const v: unknown = raw.must_change_password;
  const must_change_password =
    v === true || v === "true" || v === 1 || v === "1";
  return { ...raw, must_change_password };
}

export type BillingPlan = "essential" | "pro" | "premium";

export const billingApi = {
  createCheckout: (body: { barbershop_name: string; cnpj?: string; phone: string; email: string; contact_name?: string; plan?: BillingPlan; extra_numbers?: number }) =>
    api<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify(body) }),
  createEmbeddedCheckout: (body: { barbershop_name: string; cnpj?: string; phone: string; email: string; contact_name?: string; plan: BillingPlan; extra_numbers?: number }) =>
    api<{ client_secret: string }>("/api/billing/checkout_embedded", { method: "POST", body: JSON.stringify(body) }),
  getSession: (sessionId: string) =>
    api<{ email: string; barbershop_name?: string; token?: string; message?: string }>(
      `/api/billing/session?session_id=${encodeURIComponent(sessionId)}`
    ),
  /** Create Stripe Customer Portal session (manage subscription, add-ons). Returns URL to open. */
  createPortalSession: () =>
    api<{ url: string }>("/api/billing/portal", { method: "POST" }),
  /** Create Stripe Checkout (payment) for follow-up credits. Returns URL to open. */
  creditsCheckout: (quantity: number) =>
    api<{ url: string }>("/api/billing/credits_checkout", {
      method: "POST",
      body: JSON.stringify({ quantity }),
    }),
};

export const authApi = {
  me: () =>
    api<AuthProfile>("/api/auth/me"),
  changePassword: (body: { current_password: string; new_password: string }) =>
    api<void>("/api/auth/password", { method: "PATCH", body: JSON.stringify(body) }),
  setFirstPassword: (newPassword: string) =>
    api<void>("/api/auth/first-password", { method: "POST", body: JSON.stringify({ new_password: newPassword }) }),
  login: (email: string, password: string) =>
    api<{ token: string; profile: AuthProfile }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) }
    ),
  register: (body: { email: string; password: string; full_name?: string; barbershop_id?: string }) =>
    api<{ token: string; profile: AuthProfile }>("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  switchBarbershop: (barbershopId: string) =>
    api<{ token: string; barbershop_id: string }>("/api/auth/switch-barbershop", {
      method: "POST",
      body: JSON.stringify({ barbershop_id: barbershopId }),
    }),
  forgotPassword: (email: string) =>
    api<void>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
};

export type DeleteBarbershopResponse = { deleted: true; redirect: "login" } | { deleted: true; switch_to: string };
export type DeleteAccountResponse = { deleted: true; redirect: "login" };

export const accountApi = {
  deleteBarbershop: () =>
    api<DeleteBarbershopResponse>("/api/account/barbershop", { method: "DELETE" }),
  deleteAccount: () =>
    api<DeleteAccountResponse>("/api/account", { method: "DELETE" }),
};

export type UnavailabilityInterval = {
  start: string;
  end: string;
  reason?: string;
};

export type BusinessHoursDay =
  | { start: string; end: string; unavailability_intervals?: UnavailabilityInterval[] }
  | null;
export type BusinessHours = {
  monday?: BusinessHoursDay;
  tuesday?: BusinessHoursDay;
  wednesday?: BusinessHoursDay;
  thursday?: BusinessHoursDay;
  friday?: BusinessHoursDay;
  saturday?: BusinessHoursDay;
  sunday?: BusinessHoursDay;
};

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  monday: { start: "09:00", end: "19:00" },
  tuesday: { start: "09:00", end: "19:00" },
  wednesday: { start: "09:00", end: "19:00" },
  thursday: { start: "09:00", end: "19:00" },
  friday: { start: "09:00", end: "19:00" },
  saturday: { start: "09:00", end: "18:00" },
  sunday: null,
};

export function getDefaultBusinessHours(): BusinessHours {
  return { ...DEFAULT_BUSINESS_HOURS };
}

export type BarbershopClosure = {
  id: string;
  barbershop_id: string;
  closure_date: string;
  status: "closed" | "open_partial";
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  unavailability_intervals?: UnavailabilityInterval[];
  created_at: string;
  updated_at: string;
};

export const barbershopsApi = {
  get: () =>
    api<{
      id: string;
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      latitude?: number | null;
      longitude?: number | null;
      business_hours?: BusinessHours;
      slug?: string;
    }>("/api/barbershops"),
  createBranch: (body: { name: string; slug?: string }) =>
    api<{ id: string; name: string; slug: string; created_at: string; updated_at: string }>("/api/barbershops", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patch: (body: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    latitude?: number | null;
    longitude?: number | null;
    business_hours?: BusinessHours;
    slug?: string;
  }) => api("/api/barbershops", { method: "PATCH", body: JSON.stringify(body) }),
  closures: {
    list: () => api<BarbershopClosure[]>("/api/barbershops/closures"),
    create: (body: {
      closure_date: string;
      status: "closed" | "open_partial";
      start_time?: string;
      end_time?: string;
      reason?: string;
      unavailability_intervals?: UnavailabilityInterval[];
    }) =>
      api("/api/barbershops/closures", {
        method: "POST",
        body: JSON.stringify(body),
      }) as Promise<BarbershopClosure>,
    get: (id: string) =>
      api<BarbershopClosure>(`/api/barbershops/closures/${id}`),
    update: (
      id: string,
      body: {
        status?: "closed" | "open_partial";
        start_time?: string | null;
        end_time?: string | null;
        reason?: string | null;
        unavailability_intervals?: UnavailabilityInterval[];
      }
    ) =>
      api(`/api/barbershops/closures/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }) as Promise<BarbershopClosure>,
    delete: (id: string) =>
      api(`/api/barbershops/closures/${id}`, { method: "DELETE" }),
  },
};

export const barbersApi = {
  list: () => {
    const q = new URLSearchParams();
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    const qs = q.toString();
    return api<Array<{ id: string; barbershop_id?: string; barbershop_name?: string; name: string; phone?: string; email?: string; status: string; commission_percentage: number; schedule?: unknown }>>(
      qs ? `/api/barbers?${qs}` : "/api/barbers"
    );
  },
  get: (id: string) => api(`/api/barbers/${id}`),
  create: (body: { name: string; phone?: string; email?: string; status?: string; commission_percentage?: number; schedule?: unknown; barbershop_id?: string }) =>
    api("/api/barbers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/barbers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api(`/api/barbers/${id}`, { method: "DELETE" }),
};

export const servicesApi = {
  list: () => {
    const q = new URLSearchParams();
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    const qs = q.toString();
    return api<
      Array<{
        id: string;
        barbershop_id?: string;
        barbershop_name?: string;
        name: string;
        description?: string;
        price: number;
        duration_minutes: number;
        commission_percentage?: number;
        category: string;
        is_active: boolean;
        points_to_earn?: number;
        points_to_redeem?: number | null;
      }>
    >(qs ? `/api/services?${qs}` : "/api/services");
  },
  get: (id: string) => api(`/api/services/${id}`),
  create: (body: {
    name: string;
    description?: string;
    price: number;
    duration_minutes?: number;
    category?: string;
    is_active?: boolean;
    points_to_earn?: number;
    points_to_redeem?: number | null;
    barbershop_id?: string;
  }) => api("/api/services", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api(`/api/services/${id}`, { method: "DELETE" }),
};

export const loyaltyApi = {
  stats: () =>
    api<{
      clients_with_points: number;
      points_distributed_this_month: number;
      redemptions_this_month: number;
    }>("/api/loyalty/stats"),
  rewards: () =>
    api<Array<{ id: string; name: string; points_to_redeem: number }>>("/api/loyalty/rewards"),
  ranking: (limit?: number) => {
    const q = limit != null ? `?limit=${limit}` : "";
    return api<Array<{ id: string; name: string; phone: string; loyalty_points: number }>>(
      `/api/loyalty/ranking${q}`
    );
  },
  redeem: (body: { client_id: string; service_id: string }) =>
    api<{
      id: string;
      client_id: string;
      service_id: string;
      points_spent: number;
      redeemed_at: string;
      client_name: string;
      service_name: string;
    }>("/api/loyalty/redeem", { method: "POST", body: JSON.stringify(body) }),
  redemptions: (limit?: number) => {
    const q = limit != null ? `?limit=${limit}` : "";
    return api<
      Array<{
        id: string;
        client_id: string;
        service_id: string;
        points_spent: number;
        redeemed_at: string;
        client_name: string;
        service_name: string;
      }>
    >(`/api/loyalty/redemptions${q}`);
  },
};

export type ClientMemory = {
  id: string;
  client_id: string;
  barbershop_id: string;
  preferred_services: string[] | null;
  preferred_services_conf: number;
  preferred_barber_id: string | null;
  preferred_barber_name?: string | null;
  preferred_barber_conf: number;
  preferred_days: number[] | null;
  preferred_days_conf: number;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  preferred_time_conf: number;
  last_completed_services: string[] | null;
  last_completed_at: string | null;
  communication_style: "formal" | "informal" | "direct" | "chatty" | "unknown";
  communication_style_conf: number;
  reactivation_status: "active" | "at_risk" | "churned" | "returning" | "unknown";
  payment_pending: boolean;
  payment_pending_amount: number | null;
  last_no_show_at: string | null;
  no_show_count: number;
  notes_safe: string | null;
  overall_confidence: number;
  created_at: string;
  updated_at: string;
};

export type Client = {
  id: string;
  barbershop_id?: string;
  barbershop_name?: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  total_visits: number;
  total_spent: number;
  loyalty_points: number;
  created_at?: string;
  updated_at?: string;
  // Enriched fields (from JOIN in GET /api/clients)
  last_appointment_at?: string | null;
  last_appointment_status?: string | null;
  no_show_count?: number;
  reactivation_status?: "active" | "at_risk" | "churned" | "returning" | "unknown";
  preferred_services?: string[] | null;
  memory_confidence?: number | null;
};

export type ClientAppointment = {
  id: string;
  barbershop_id: string;
  barber_id: string | null;
  barber_name: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  price: number;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  service_names: string[];
};

export const clientsApi = {
  list: (params?: { search?: string; reactivation_status?: string }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.reactivation_status) q.set("reactivation_status", params.reactivation_status);
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    const qs = q.toString();
    return api<Client[]>(qs ? `/api/clients?${qs}` : "/api/clients");
  },
  get: (id: string) => api<Client>(`/api/clients/${id}`),
  create: (body: { name: string; phone: string; email?: string; notes?: string; barbershop_id?: string }) =>
    api<Client>("/api/clients", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api<Client>(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api(`/api/clients/${id}`, { method: "DELETE" }),
  getAppointments: (id: string) => api<ClientAppointment[]>(`/api/clients/${id}/appointments`),
  getMemory: (id: string) => api<ClientMemory | null>(`/api/clients/${id}/memory`),
  updateMemory: (id: string, body: { notes_safe: string | null }) =>
    api<ClientMemory>(`/api/clients/${id}/memory`, { method: "PATCH", body: JSON.stringify(body) }),
  getMemoryByPhone: (phone: string) => api<ClientMemory | null>(`/api/clients/by-phone/${encodeURIComponent(phone)}/memory`),
};

export type ApiKeyItem = { id: string; name: string; last_used_at: string | null; created_at: string; revoked: boolean };
export type ScheduledMessagesSummary = { queued: number; sent: number; failed: number; skipped: number };

export type N8nWebhookSettings = { n8n_chat_webhook_url: string | null };

export const integrationsApi = {
  listApiKeys: () => api<ApiKeyItem[]>("/api/integrations/api-keys"),
  getN8nWebhook: () => api<N8nWebhookSettings>("/api/integrations/n8n-webhook"),
  updateN8nWebhook: (n8n_chat_webhook_url: string | null) =>
    api<N8nWebhookSettings>("/api/integrations/n8n-webhook", {
      method: "PATCH",
      body: JSON.stringify({ n8n_chat_webhook_url }),
    }),
  createApiKey: (name: string) =>
    api<{ id: string; name: string; created_at: string; api_key: string }>("/api/integrations/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revokeApiKey: (id: string) => api<void>(`/api/integrations/api-keys/${id}`, { method: "DELETE" }),
  getScheduledMessagesSummary: () =>
    api<ScheduledMessagesSummary>("/api/integrations/automations/scheduled-messages/summary"),
  listScheduledMessages: (params?: { type?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.status) q.set("status", params.status);
    if (params?.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api<Array<{
      id: string;
      type: string;
      to_phone: string;
      status: string;
      run_after: string;
      last_error?: string;
      created_at: string;
    }>>(`/api/integrations/automations/scheduled-messages${qs ? `?${qs}` : ""}`);
  },
  followup: {
    getEligible: (params?: { days?: number; limit?: number; search?: string; all?: boolean }) => {
      const q = new URLSearchParams();
      if (params?.all) q.set("all", "1");
      else if (params?.days != null) q.set("days", String(params.days));
      if (params?.limit != null) q.set("limit", String(params.limit));
      if (params?.search) q.set("search", params.search);
      const qs = q.toString();
      return api<Array<{
        id: string;
        name?: string;
        phone: string;
        last_activity: string;
        source: "appointment" | "whatsapp";
      }>>(`/api/integrations/automations/followup/eligible${qs ? `?${qs}` : ""}`);
    },
    getCredits: () =>
      api<{ balance: number; credit_type: string }>("/api/integrations/automations/followup/credits"),
    dispatch: (body: { client_ids: string[]; days?: number }) =>
      api<{
        enqueued: number;
        skipped_dedupe: number;
        skipped_opt_out: number;
        credits_remaining: number;
      }>("/api/integrations/automations/followup/dispatch", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
};

export type WhatsAppConnection = {
  connected: boolean;
  status: string;
  provider?: string;
  whatsapp_phone?: string;
  connected_at?: string;
  last_error?: string;
  /** ISO date when IA pause ends (handoff). */
  ai_paused_until?: string;
  /** 'auto' | 'manual' when paused. */
  ai_paused_by?: string;
};

/** Regra customizada da barbearia: instruções estruturadas que entram no prompt do agente. */
export type CustomRule = {
  id: string;
  title: string;
  enabled: boolean;
  priority: number;
  when?: { intents?: string[]; keywords?: string[]; stages?: string[] };
  do: string[];
  dont?: string[];
  examples?: Array<{ user: string; assistant: string }>;
};

export type AgentProfile = {
  tonePreset?: string;
  emojiLevel?: "none" | "low" | "medium";
  slangLevel?: "low" | "medium" | "high";
  verbosity?: "short" | "normal";
  salesStyle?: "soft" | "direct";
  hardRules?: Record<string, unknown>;
  customRules?: CustomRule[];
  displayName?: string;
  nickname?: string;
  role?: string;
  signMessages?: boolean;
  signatureStyle?: "short" | "full";
};

export type AiSettings = {
  enabled: boolean;
  timezone: string;
  model: string;
  model_premium?: string | null;
  temperature: number;
  system_prompt_override?: string | null;
  agent_profile?: AgentProfile | Record<string, unknown>;
  additional_instructions?: string | null;
  active_prompt_version_id?: string | null;
  max_output_tokens?: number | null;
  typing_simulation?: {
    enabled?: boolean;
    baseDelayMs?: number;
    msPerChar?: number;
    jitterMs?: number;
  } | null;
  updated_at: string;
};

export type AiPromptVersion = {
  id: string;
  status: string;
  created_at: string;
  settings_snapshot?: Record<string, unknown>;
  knowledge_snapshot?: { document_ids?: string[]; source_ids?: string[] };
};

export type WhatsAppInboxConversation = {
  id: string;
  client_name?: string;
  client_phone?: string;
  external_thread_id: string;
  last_message_at?: string;
  last_message?: {
    role: "user" | "assistant" | "tool";
    content: string;
    created_at: string;
  };
  paused_until?: string | null;
  paused_by?: string | null;
};

export type WhatsAppInboxMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
  tool_name?: string | null;
  provider_message_id?: string | null;
  delivery_status?: string | null;
  delivered_at?: string | null;
};

export const whatsappApi = {
  get: () => api<WhatsAppConnection>("/api/integrations/whatsapp"),
  getNumberMode: () =>
    api<{
      mode: "account_wide" | "per_branch";
      primary_barbershop_id?: string;
      barbershops: Array<{ id: string; name: string }>;
    }>("/api/integrations/whatsapp/number-mode"),
  updateNumberMode: (body: {
    mode: "account_wide" | "per_branch";
    primary_barbershop_id?: string | null;
  }) =>
    api<{ mode: string; primary_barbershop_id?: string }>("/api/integrations/whatsapp/number-mode", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  assume: () =>
    api<{ ok: boolean; message: string }>("/api/integrations/whatsapp/assume", { method: "POST" }),
  resume: () =>
    api<{ ok: boolean; message: string }>("/api/integrations/whatsapp/resume", { method: "POST" }),
  assumeConversation: (conversationId: string) =>
    api<{ ok: boolean; message: string }>(`/api/integrations/whatsapp/conversations/${conversationId}/assume`, {
      method: "POST",
    }),
  resumeConversation: (conversationId: string) =>
    api<{ ok: boolean; message: string }>(`/api/integrations/whatsapp/conversations/${conversationId}/resume`, {
      method: "POST",
    }),
  getUsage: () =>
    api<{ used: number; limit: number; softExceeded: boolean; hardExceeded: boolean; billingPlan: string }>(
      "/api/integrations/whatsapp/usage"
    ),
  start: (phone?: string) =>
    api<{
      status: string;
      qr?: string;
      pairingCode?: string;
      webhook_set?: boolean;
      webhook_warning?: string;
    }>("/api/integrations/whatsapp/uazapi/start", {
      method: "POST",
      body: JSON.stringify(phone != null ? { phone } : {}),
    }),
  status: () =>
    api<{ status: string; connected: boolean; qr?: string; pairingCode?: string }>(
      "/api/integrations/whatsapp/uazapi/status"
    ),
  getConnectivity: () =>
    api<{ api: string; uazapi: { ok: boolean; error?: string } }>(
      "/api/integrations/whatsapp/uazapi/connectivity"
    ),
  disconnect: () =>
    api<{ status: string }>("/api/integrations/whatsapp/uazapi/disconnect", { method: "POST" }),
  sendTest: (params?: { number?: string; text?: string }) =>
    api<{ sent: boolean }>("/api/integrations/whatsapp/uazapi/send-test", {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    }),
  getAiSettings: () => api<AiSettings>("/api/integrations/whatsapp/ai-settings"),
  updateAiSettings: (body: Partial<AiSettings> & { agent_profile?: AgentProfile | null; additional_instructions?: string | null }) =>
    api<AiSettings>("/api/integrations/whatsapp/ai-settings", { method: "PUT", body: JSON.stringify(body) }),
  publishAiSettings: () =>
    api<{ version_id: string; status: string }>("/api/integrations/whatsapp/ai-settings/publish", { method: "POST" }),
  listAiVersions: () =>
    api<{ versions: AiPromptVersion[] }>("/api/integrations/whatsapp/ai-settings/versions"),
  getCompiledPrompt: () =>
    api<{
      compiled_prompt: string;
      compiled_prompt_preview: string;
      active_prompt_version_id: string | null;
      sections: {
        base: string;
        style: string | null;
        customRules: string | null;
        additionalInstructions: string | null;
        guardrails: string;
      };
      section_lengths: Record<string, number>;
    }>("/api/integrations/whatsapp/ai-prompt/compiled"),
  /** Indica se a Lambda da API tem OPENAI_API_KEY (sandbox/diagnóstico usam esta instância). */
  getOpenaiStatus: () => api<{ configured: boolean }>("/api/integrations/whatsapp/openai-status"),
  rollbackAiSettings: (versionId: string) =>
    api<{ version_id: string; status: string }>("/api/integrations/whatsapp/ai-settings/rollback", {
      method: "POST",
      body: JSON.stringify({ version_id: versionId }),
    }),
  simulateAiChat: (params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    draft_profile?: Record<string, unknown> | null;
    draft_additional_instructions?: string | null;
    debug?: boolean;
  }) =>
    api<{
      reply: string;
      violations: string[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      debug?: { applied_rule_titles: string[] };
    }>(
      "/api/integrations/whatsapp/ai-simulate",
      { method: "POST", body: JSON.stringify(params) }
    ),
  simulateAiSuite: (params: {
    scenarios: Array<{
      id: string;
      label: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      expected?: { violationsMax?: number; mustContain?: string[]; mustNotContain?: string[] };
    }>;
    draft_profile?: Record<string, unknown> | null;
    draft_additional_instructions?: string | null;
  }) =>
    api<{
      results: Array<{
        scenario_id: string;
        label: string;
        reply: string;
        violations: string[];
        passed: boolean;
        checks?: { violationsMax?: boolean; mustContain?: boolean; mustNotContain?: boolean };
      }>;
      all_passed: boolean;
    }>("/api/integrations/whatsapp/ai-simulate-suite", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  analyzeChat: (params: { chat_text: string; objectives?: string[] }) =>
    api<{
      recommended_profile_patch?: Record<string, unknown>;
      recommended_additional_instructions_patch?: string | null;
      risk_notes: string[];
      expected_outcomes: string[];
      current_profile: AgentProfile;
    }>("/api/integrations/whatsapp/ai-analyze-chat", { method: "POST", body: JSON.stringify(params) }),
  diagnosticChat: (params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    objectives?: string[];
    attachments?: Array<{ name: string; mime_type?: string; text: string }>;
  }) =>
    api<{
      reply: string;
      recommended_profile_patch?: Record<string, unknown>;
      recommended_additional_instructions_patch?: string | null;
      recommended_custom_rules_patch?: {
        add?: CustomRule[];
        update?: Array<{ id: string; patch: Partial<CustomRule> }>;
        disable?: string[];
      };
      risk_notes: string[];
      expected_outcomes: string[];
      current_profile?: AgentProfile;
    }>("/api/integrations/whatsapp/ai-diagnostic-chat", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  getAiHealth: () =>
    api<{
      period_days: number;
      total_messages: number;
      messages_with_violations: number;
      by_violation: Record<string, number>;
      last_24h: { total: number; with_violations: number };
      regression_detected: boolean;
    }>("/api/integrations/whatsapp/ai-health"),
  diagnoseIncident: (params: {
    incident_type: string;
    manager_note?: string;
    conversation_id?: string;
    sandbox_conversation_id?: string;
    prompt_version_id?: string | null;
    settings_snapshot: { agent_profile?: Record<string, unknown>; additional_instructions?: string | null };
    transcript: Array<{ role: "user" | "assistant"; content: string }>;
    tool_trace?: Array<{ name: string; args?: Record<string, unknown>; result?: unknown }>;
  }) =>
    api<{
      summary: string;
      question_to_confirm: string;
      recommended_profile_patch?: Record<string, unknown>;
      recommended_additional_instructions_patch?: string | null;
      recommended_custom_rules_patch?: {
        add?: CustomRule[];
        update?: Array<{ id: string; patch: Partial<CustomRule> }>;
        disable?: string[];
      };
      suite_scenarios_to_run?: string[];
      risk_notes: string[];
    }>("/api/integrations/whatsapp/ai-incidents/diagnose", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  saveIncident: (params: {
    incident_type: string;
    severity?: "critical" | "medium" | "light";
    manager_note?: string;
    conversation_id?: string;
    transcript: Array<{ role: "user" | "assistant"; content: string }>;
    settings_snapshot?: { agent_profile?: Record<string, unknown>; additional_instructions?: string | null };
    diagnosis_result?: Record<string, unknown>;
  }) =>
    api<{
      id: string;
      severity: "critical" | "medium" | "light";
      benchmark_scenario_draft: Record<string, unknown>;
    }>("/api/integrations/whatsapp/ai-incidents/save", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  listConversations: (params?: { limit?: number; search?: string; status?: "ai" | "manual"; updated_since?: string; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.updated_since) q.set("updated_since", params.updated_since);
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return api<{ conversations: WhatsAppInboxConversation[] }>(
      `/api/integrations/whatsapp/conversations${qs ? `?${qs}` : ""}`
    );
  },
  getConversationMessages: (conversationId: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return api<{ messages: WhatsAppInboxMessage[] }>(
      `/api/integrations/whatsapp/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`
    );
  },
  syncConversationMessages: (conversationId: string) =>
    api<{ inserted: number; last_synced_at: string }>(
      `/api/integrations/whatsapp/conversations/${conversationId}/sync`,
      { method: "POST" }
    ),
  sendConversationMessage: (conversationId: string, text: string) =>
    api<{ ok: boolean; message_id: string }>(
      `/api/integrations/whatsapp/conversations/${conversationId}/send-manual`,
      { method: "POST", body: JSON.stringify({ text }) }
    ),
  getConversationContact: (conversationId: string) =>
    api<{
      contact: { id: string; name?: string; phone?: string; notes?: string } | null;
      fallback_phone?: string;
    }>(`/api/integrations/whatsapp/conversations/${conversationId}/contact`),
  patchConversationContact: (
    conversationId: string,
    body: { name?: string; phone?: string; notes?: string }
  ) =>
    api<{
      contact?: { id: string; name?: string; phone?: string; notes?: string };
    }>(`/api/integrations/whatsapp/conversations/${conversationId}/contact`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  startConversation: (params: { client_id?: string; phone?: string }) =>
    api<{ conversation_id: string; created: boolean; external_thread_id: string }>(
      "/api/integrations/whatsapp/conversations/start",
      { method: "POST", body: JSON.stringify(params) }
    ),
  deleteConversation: (conversationId: string) =>
    api<{ ok: boolean }>(`/api/integrations/whatsapp/conversations/${conversationId}`, {
      method: "DELETE",
    }),
  knowledge: {
    getConfig: () =>
      api<{ storage_configured: boolean }>("/api/integrations/whatsapp/knowledge/config"),
    listSources: () =>
      api<Array<{ id: string; name: string; enabled: boolean; created_at: string; updated_at: string }>>(
        "/api/integrations/whatsapp/knowledge/sources"
      ),
    createSource: (name: string) =>
      api<{ id: string; name: string; enabled: boolean; created_at: string }>(
        "/api/integrations/whatsapp/knowledge/sources",
        { method: "POST", body: JSON.stringify({ name }) }
      ),
    updateSource: (id: string, body: { name?: string; enabled?: boolean }) =>
      api<{ id: string; name: string; enabled: boolean; created_at: string; updated_at: string }>(
        `/api/integrations/whatsapp/knowledge/sources/${id}`,
        { method: "PATCH", body: JSON.stringify(body) }
      ),
    listDocuments: (sourceId?: string) => {
      const q = sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : "";
      return api<Array<{
        id: string;
        barbershop_id: string;
        source_id: string | null;
        title: string;
        original_filename: string;
        mime_type: string;
        size_bytes: number | null;
        status: string;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }>>(`/api/integrations/whatsapp/knowledge/documents${q}`);
    },
    createDocument: (body: {
      title: string;
      original_filename: string;
      mime_type: string;
      source_id?: string | null;
    }) =>
      api<{
        id: string;
        title: string;
        original_filename: string;
        mime_type: string;
        status: string;
        upload_url: string;
        s3_key: string;
      }>("/api/integrations/whatsapp/knowledge/documents", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    completeDocument: (id: string, body?: { checksum_sha256?: string; size_bytes?: number }) =>
      api<{ id: string; status: string }>(
        `/api/integrations/whatsapp/knowledge/documents/${id}/complete`,
        { method: "POST", body: JSON.stringify(body ?? {}) }
      ),
    deleteDocument: (id: string) =>
      api<void>(`/api/integrations/whatsapp/knowledge/documents/${id}`, { method: "DELETE" }),
  },
};

export const reportsApi = {
  revenueByDay: (params: { from: string; to: string }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    return api<Array<{ date: string; revenue: number; appointments: number }>>(
      `/api/reports/revenue_by_day?${q.toString()}`
    );
  },
  topServices: (params: { from: string; to: string; limit?: number }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.limit != null) q.set("limit", String(params.limit));
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    return api<Array<{ service_id: string; service_name: string; count: number; revenue: number }>>(
      `/api/reports/top_services?${q.toString()}`
    );
  },
  mvpMetrics: () => {
    const q = new URLSearchParams();
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    const qs = q.toString();
    return api<{
      noShowRate7d: number;
      noShowRate30d: number;
      reminders: { sent: number; failed: number; skipped: number };
      followUps: { sent: number; failed: number; skipped: number };
    }>(qs ? `/api/reports/mvp-metrics?${qs}` : "/api/reports/mvp-metrics");
  },
  commissionsByBarber: (params: { from: string; to: string }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    return api<Array<{ barber_id: string; barber_name: string; barbershop_id?: string; barbershop_name?: string; total_commission: number }>>(
      `/api/reports/commissions_by_barber?${q.toString()}`
    );
  },
};

export const publicApi = {
  getBarbershop: (slug: string) =>
    api<{
      id: string;
      name: string;
      phone?: string;
      email?: string;
      address?: string;
      business_hours?: BusinessHours;
      slug: string;
    }>(`/api/public/${encodeURIComponent(slug)}`),
  getServices: (slug: string) =>
    api<Array<{ id: string; name: string; description?: string; price: number; duration_minutes: number; category: string }>>(
      `/api/public/${encodeURIComponent(slug)}/services`
    ),
  getBarbers: (slug: string) =>
    api<Array<{ id: string; name: string; status: string }>>(`/api/public/${encodeURIComponent(slug)}/barbers`),
  getAvailability: (slug: string, date: string) =>
    api<Array<{ barber_id: string; scheduled_time: string; duration_minutes: number }>>(
      `/api/public/${encodeURIComponent(slug)}/availability?date=${encodeURIComponent(date)}`
    ),
  createAppointment: (
    slug: string,
    body: {
      service_id?: string;
      service_ids?: string[];
      barber_id: string;
      scheduled_date: string;
      scheduled_time: string;
      client_name: string;
      client_phone: string;
      notes?: string;
    }
  ) =>
    api<{ id: string; scheduled_date: string; scheduled_time: string; status: string }>(
      `/api/public/${encodeURIComponent(slug)}/appointments`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  getAppointmentByToken: (token: string) =>
    api<PublicAppointment>(`/api/public/appointments/${encodeURIComponent(token)}`),
  cancelAppointmentByToken: (token: string) =>
    api<{ ok: boolean; message: string }>(`/api/public/appointments/${encodeURIComponent(token)}/cancel`, {
      method: "POST",
    }),
  rescheduleAppointmentByToken: (
    token: string,
    body: { scheduled_date: string; scheduled_time: string; barber_id?: string }
  ) =>
    api<PublicAppointment>(`/api/public/appointments/${encodeURIComponent(token)}/reschedule`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export type PublicAppointment = {
  id: string;
  barbershop_id: string;
  barber_id: string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  status: string;
  barbershop_name: string;
  slug: string | null;
  service_names: string;
};

export type AppointmentListItem = {
  id: string;
  barber_id: string;
  client_id: string;
  service_id: string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  price: number;
  commission_amount?: number;
  status: string;
  client_name: string;
  client_phone: string;
  barber_name: string;
  service_name: string;
  service_ids?: string[];
  service_names?: string[];
  barbershop_id?: string;
  barbershop_name?: string;
  completed_time?: string | null;
  completed_at?: string | null;
};

export const appointmentsApi = {
  list: (params?: { date?: string; from?: string; to?: string; barber_id?: string; status?: string; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set("date", params.date);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.barber_id) q.set("barber_id", params.barber_id);
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    if (getBarbershopScope() === "__all__") q.set("barbershop_id", "__all__");
    const qs = q.toString();
    return api<AppointmentListItem[]>(qs ? `/api/appointments?${qs}` : "/api/appointments");
  },
  create: (body: {
    client_id: string;
    barber_id: string;
    service_id?: string;
    service_ids?: string[];
    scheduled_date: string;
    scheduled_time: string;
    notes?: string;
    barbershop_id?: string;
  }) => api<AppointmentListItem & { service_ids?: string[]; service_names?: string[] }>("/api/appointments", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: {
    status?: string;
    scheduled_date?: string;
    scheduled_time?: string;
    notes?: string;
    price?: number;
    service_ids?: string[];
    completed_time?: string;
  }) => api<AppointmentListItem>(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  cancel: (id: string) => api(`/api/appointments/${id}`, { method: "DELETE" }),
};

// ─── Plans API ────────────────────────────────────────────────────────────────

export type BarbershopPlan = {
  id: string;
  name: string;
  description?: string;
  service_ids: string[];
  services_detail: Array<{ id: string; name: string }>;
  price: number;
  billing_cycle: "monthly" | "quarterly" | "yearly";
  max_visits: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PlanSubscription = {
  id: string;
  status: "active" | "suspended" | "cancelled";
  billing_day: number;
  next_billing_date: string;
  started_at: string;
  cancelled_at: string | null;
  client_id: string;
  client_name: string;
  client_phone: string;
  plan_id: string;
  plan_name: string;
  price: number;
  billing_cycle: "monthly" | "quarterly" | "yearly";
};

export type PlanCharge = {
  id: string;
  amount: number;
  status: "pending" | "sent" | "paid" | "failed" | "skipped";
  due_date: string;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export const plansApi = {
  list: () => api<BarbershopPlan[]>("/api/plans"),
  create: (body: { name: string; description?: string; service_ids?: string[]; price: number; billing_cycle?: string; max_visits?: number | null }) =>
    api<{ id: string }>("/api/plans", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<{ name: string; description: string; service_ids: string[]; price: number; billing_cycle: string; max_visits: number | null; is_active: boolean }>) =>
    api<{ ok: boolean }>(`/api/plans/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deactivate: (id: string) =>
    api(`/api/plans/${id}`, { method: "DELETE" }),
  subscriptions: {
    list: () => api<PlanSubscription[]>("/api/plans/subscriptions"),
    create: (body: { client_id: string; plan_id: string; billing_day?: number }) =>
      api<{ id: string; next_billing_date: string }>("/api/plans/subscriptions", { method: "POST", body: JSON.stringify(body) }),
    cancel: (id: string) =>
      api<{ ok: boolean }>(`/api/plans/subscriptions/${id}/cancel`, { method: "PUT" }),
    charges: (id: string) =>
      api<PlanCharge[]>(`/api/plans/subscriptions/${id}/charges`),
  },
};

/** Format appointment services for display (e.g. "Corte" or "Corte + Barba") */
export function serviceLabel(serviceNames: string[] | undefined, fallbackName?: string): string {
  if (serviceNames?.length === 0) return fallbackName ?? "";
  if (serviceNames?.length === 1) return serviceNames[0];
  if (serviceNames && serviceNames.length > 1) return `${serviceNames[0]} + ${serviceNames.length - 1}`;
  return fallbackName ?? "";
}
