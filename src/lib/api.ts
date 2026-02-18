const API_BASE = import.meta.env.VITE_API_URL ?? "";

export const getToken = (): string | null => localStorage.getItem("token");

export function setToken(token: string): void {
  localStorage.setItem("token", token);
}

export function clearToken(): void {
  localStorage.removeItem("token");
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    localStorage.removeItem("profile");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

export type AuthProfile = { id: string; email: string; full_name?: string; barbershop_id: string; role: string; must_change_password?: boolean };

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
  patch: (body: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    business_hours?: BusinessHours;
    slug?: string;
  }) => api("/api/barbershops", { method: "PATCH", body: JSON.stringify(body) }),
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
  list: () => api<Array<{ id: string; name: string; description?: string; price: number; duration_minutes: number; commission_percentage?: number; category: string; is_active: boolean }>>("/api/services"),
  get: (id: string) => api(`/api/services/${id}`),
  create: (body: { name: string; description?: string; price: number; duration_minutes?: number; category?: string; is_active?: boolean }) =>
    api("/api/services", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Record<string, unknown>) =>
    api(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: string) => api(`/api/services/${id}`, { method: "DELETE" }),
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
export const integrationsApi = {
  listApiKeys: () => api<ApiKeyItem[]>("/api/integrations/api-keys"),
  createApiKey: (name: string) =>
    api<{ id: string; name: string; created_at: string; api_key: string }>("/api/integrations/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revokeApiKey: (id: string) => api<void>(`/api/integrations/api-keys/${id}`, { method: "DELETE" }),
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
