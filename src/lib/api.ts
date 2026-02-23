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

export type BillingPlan = "essential" | "pro" | "premium";

export const billingApi = {
  createCheckout: (body: { barbershop_name: string; cnpj?: string; phone: string; email: string; contact_name?: string; plan?: BillingPlan; extra_numbers?: number }) =>
    api<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify(body) }),
  createEmbeddedCheckout: (body: { barbershop_name: string; cnpj?: string; phone: string; email: string; contact_name?: string; plan: BillingPlan; extra_numbers?: number }) =>
    api<{ client_secret: string }>("/api/billing/checkout_embedded", { method: "POST", body: JSON.stringify(body) }),
  getSession: (sessionId: string) =>
    api<{ email: string; barbershop_name?: string; temporary_password?: string; message?: string }>(
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

export type BusinessHoursDay = { start: string; end: string } | null;
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
  list: () => api<Array<{ id: string; name: string; phone?: string; email?: string; status: string; commission_percentage: number; schedule?: unknown }>>("/api/barbers"),
  get: (id: string) => api(`/api/barbers/${id}`),
  create: (body: { name: string; phone?: string; email?: string; status?: string; commission_percentage?: number; schedule?: unknown }) =>
    api("/api/barbers", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/barbers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api(`/api/barbers/${id}`, { method: "DELETE" }),
};

export const servicesApi = {
  list: () =>
    api<
      Array<{
        id: string;
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
    >("/api/services"),
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

export const clientsApi = {
  list: (search?: string) =>
    api<Array<{ id: string; name: string; phone: string; email?: string; notes?: string; total_visits: number; total_spent: number; loyalty_points: number; updated_at?: string }>>(
      search ? `/api/clients?search=${encodeURIComponent(search)}` : "/api/clients"
    ),
  get: (id: string) => api(`/api/clients/${id}`),
  create: (body: { name: string; phone: string; email?: string; notes?: string }) =>
    api("/api/clients", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api(`/api/clients/${id}`, { method: "DELETE" }),
};

export type ApiKeyItem = { id: string; name: string; last_used_at: string | null; created_at: string; revoked: boolean };
export type ScheduledMessagesSummary = { queued: number; sent: number; failed: number; skipped: number };

export const integrationsApi = {
  listApiKeys: () => api<ApiKeyItem[]>("/api/integrations/api-keys"),
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
    getEligible: (params?: { days?: number; limit?: number; search?: string }) => {
      const q = new URLSearchParams();
      if (params?.days != null) q.set("days", String(params.days));
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

export type AgentProfile = {
  tonePreset?: string;
  emojiLevel?: "none" | "low" | "medium";
  slangLevel?: "low" | "medium" | "high";
  verbosity?: "short" | "normal";
  salesStyle?: "soft" | "direct";
  hardRules?: Record<string, unknown>;
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
  updated_at: string;
};

export type AiPromptVersion = { id: string; status: string; created_at: string };

export const whatsappApi = {
  get: () => api<WhatsAppConnection>("/api/integrations/whatsapp"),
  assume: () =>
    api<{ ok: boolean; message: string }>("/api/integrations/whatsapp/assume", { method: "POST" }),
  resume: () =>
    api<{ ok: boolean; message: string }>("/api/integrations/whatsapp/resume", { method: "POST" }),
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
  rollbackAiSettings: (versionId: string) =>
    api<{ version_id: string; status: string }>("/api/integrations/whatsapp/ai-settings/rollback", {
      method: "POST",
      body: JSON.stringify({ version_id: versionId }),
    }),
  simulateAiChat: (params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    draft_profile?: Record<string, unknown> | null;
    draft_additional_instructions?: string | null;
  }) =>
    api<{ reply: string; violations: string[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }>(
      "/api/integrations/whatsapp/ai-simulate",
      { method: "POST", body: JSON.stringify(params) }
    ),
  analyzeChat: (params: { chat_text: string; objectives?: string[] }) =>
    api<{
      recommended_profile_patch?: Record<string, unknown>;
      recommended_additional_instructions_patch?: string | null;
      risk_notes: string[];
      expected_outcomes: string[];
      current_profile: AgentProfile;
    }>("/api/integrations/whatsapp/ai-analyze-chat", { method: "POST", body: JSON.stringify(params) }),
  getAiHealth: () =>
    api<{
      period_days: number;
      total_messages: number;
      messages_with_violations: number;
      by_violation: Record<string, number>;
      last_24h: { total: number; with_violations: number };
      regression_detected: boolean;
    }>("/api/integrations/whatsapp/ai-health"),
};

export const reportsApi = {
  revenueByDay: (params: { from: string; to: string }) =>
    api<Array<{ date: string; revenue: number; appointments: number }>>(
      `/api/reports/revenue_by_day?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`
    ),
  topServices: (params: { from: string; to: string; limit?: number }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.limit != null) q.set("limit", String(params.limit));
    return api<Array<{ service_id: string; service_name: string; count: number; revenue: number }>>(
      `/api/reports/top_services?${q.toString()}`
    );
  },
  mvpMetrics: () =>
    api<{
      noShowRate7d: number;
      noShowRate30d: number;
      reminders: { sent: number; failed: number; skipped: number };
      followUps: { sent: number; failed: number; skipped: number };
    }>("/api/reports/mvp-metrics"),
  commissionsByBarber: (params: { from: string; to: string }) =>
    api<Array<{ barber_id: string; barber_name: string; total_commission: number }>>(
      `/api/reports/commissions_by_barber?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`
    ),
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
  }) => api<AppointmentListItem & { service_ids?: string[]; service_names?: string[] }>("/api/appointments", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: {
    status?: string;
    scheduled_date?: string;
    scheduled_time?: string;
    notes?: string;
    price?: number;
    service_ids?: string[];
  }) => api<AppointmentListItem>(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  cancel: (id: string) => api(`/api/appointments/${id}`, { method: "DELETE" }),
};

/** Format appointment services for display (e.g. "Corte" or "Corte + Barba") */
export function serviceLabel(serviceNames: string[] | undefined, fallbackName?: string): string {
  if (serviceNames?.length === 0) return fallbackName ?? "";
  if (serviceNames?.length === 1) return serviceNames[0];
  if (serviceNames && serviceNames.length > 1) return `${serviceNames[0]} + ${serviceNames.length - 1}`;
  return fallbackName ?? "";
}
