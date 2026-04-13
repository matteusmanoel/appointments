import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { authApi, type BillingPlan, type AuthProfileBarbershop } from "@/lib/api";
import { setToken, clearToken, getToken, setBarbershopScope } from "@/lib/api";

export type Profile = {
  id: string;
  email: string;
  full_name?: string;
  barbershop_id: string;
  role: string;
  must_change_password?: boolean;
  billing_plan?: BillingPlan;
  barbershops?: AuthProfileBarbershop[];
};

type AuthState = {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  /** Set when switchBarbershop fails; clear with clearSwitchError. */
  switchError: string | null;
  /** When "__all__", list APIs request all barbershops in the account. */
  selectedScope: "__all__" | null;
};

const SELECTED_BARBERSHOP_KEY = "selected_barbershop_id";
const SELECTED_SCOPE_KEY = "barbershop_scope";

const initialState: AuthState = { profile: null, loading: true, error: null, switchError: null, selectedScope: null };

const AuthContext = createContext<AuthState & {
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string, opts?: { skipRefetch?: boolean }) => Promise<void>;
  logout: () => void;
  refetchProfile: () => void;
  switchBarbershop: (barbershopId: string) => Promise<void>;
  setSelectedScope: (scope: "__all__" | null) => void;
  switchingBarbershop: boolean;
  clearSwitchError: () => void;
}>(null as unknown as AuthState & { login: () => Promise<void>; loginWithToken: (t: string, o?: { skipRefetch?: boolean }) => Promise<void>; logout: () => void; refetchProfile: () => void; switchBarbershop: (id: string) => Promise<void>; setSelectedScope: (s: "__all__" | null) => void; switchingBarbershop: boolean; clearSwitchError: () => void });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  const [switchingBarbershop, setSwitchingBarbershop] = useState(false);

  const refetchProfile = useCallback(async (restoreSelectedBarbershop = false) => {
    const token = getToken();
    if (!token) {
      setState((s) => ({ ...s, profile: null, loading: false }));
      return;
    }
    try {
      const profile = await authApi.me();
      localStorage.setItem("profile", JSON.stringify(profile));
      setState((s) => ({ ...s, profile, loading: false }));
      if (restoreSelectedBarbershop && profile.barbershops && profile.barbershops.length > 1) {
        const saved = localStorage.getItem(SELECTED_BARBERSHOP_KEY);
        if (saved && profile.barbershops.some((b) => b.id === saved) && saved !== profile.barbershop_id) {
          try {
            const { token } = await authApi.switchBarbershop(saved);
            setToken(token);
            const next = await authApi.me();
            localStorage.setItem("profile", JSON.stringify(next));
            setState((s) => ({ ...s, profile: next, loading: false }));
          } catch {
            localStorage.removeItem(SELECTED_BARBERSHOP_KEY);
          }
        }
      }
    } catch {
      clearToken();
      localStorage.removeItem("profile");
      setState((s) => ({ ...s, profile: null, loading: false }));
    }
  }, []);

  const restoredBarbershopRef = useRef(false);

  // Hidratar estado do storage antes do paint para evitar tela branca (Landing/Login retornam null quando loading)
  useLayoutEffect(() => {
    const stored = localStorage.getItem("profile");
    const scopeStored = localStorage.getItem(SELECTED_SCOPE_KEY);
    const selectedScope = scopeStored === "__all__" ? "__all__" : null;
    if (stored) {
      try {
        const profile = JSON.parse(stored) as Profile;
        setState((s) => ({ ...s, profile, loading: false, selectedScope }));
      } catch {
        setState((s) => ({ ...s, loading: false, selectedScope }));
      }
    } else {
      setState((s) => ({ ...s, loading: false, selectedScope }));
    }
    setBarbershopScope(selectedScope);
  }, []);

  useEffect(() => {
    if (!getToken() || restoredBarbershopRef.current) return;
    restoredBarbershopRef.current = true;
    refetchProfile(true);
  }, [refetchProfile]);

  // Garantir que loading não fique true para sempre (ex.: API inacessível)
  useEffect(() => {
    const t = setTimeout(() => {
      setState((s) => (s.loading ? { ...s, loading: false } : s));
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { token } = await authApi.login(email, password);
      setToken(token);
      const profile = await authApi.me();
      localStorage.setItem("profile", JSON.stringify(profile));
      setState((s) => ({ ...s, profile, loading: false, error: null }));
      restoredBarbershopRef.current = false;
      await refetchProfile(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha no login";
      setState((s) => ({ ...s, profile: null, loading: false, error: message }));
      throw e;
    }
  }, []);

  const loginWithToken = useCallback(async (token: string, opts?: { skipRefetch?: boolean }) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setToken(token);
      const profile = await authApi.me();
      localStorage.setItem("profile", JSON.stringify(profile));
      setState((s) => ({ ...s, profile, loading: false, error: null }));
      restoredBarbershopRef.current = false;
      if (!opts?.skipRefetch) await refetchProfile(true);
    } catch (e) {
      clearToken();
      localStorage.removeItem("profile");
      const message = e instanceof Error ? e.message : "Falha no login";
      setState((s) => ({ ...s, profile: null, loading: false, error: message }));
      throw e;
    }
  }, [refetchProfile]);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem("profile");
    localStorage.removeItem(SELECTED_BARBERSHOP_KEY);
    localStorage.removeItem(SELECTED_SCOPE_KEY);
    setBarbershopScope(null);
    restoredBarbershopRef.current = false;
    setState((s) => ({ ...s, profile: null, selectedScope: null }));
  }, []);

  const switchBarbershop = useCallback(async (barbershopId: string) => {
    setState((s) => ({ ...s, switchError: null, selectedScope: null }));
    setBarbershopScope(null);
    localStorage.removeItem(SELECTED_SCOPE_KEY);
    setSwitchingBarbershop(true);
    try {
      const { token } = await authApi.switchBarbershop(barbershopId);
      setToken(token);
      localStorage.setItem(SELECTED_BARBERSHOP_KEY, barbershopId);
      await refetchProfile(false);
    } catch (e) {
      localStorage.removeItem(SELECTED_BARBERSHOP_KEY);
      const message = e instanceof Error ? e.message : "Falha ao trocar de unidade";
      setState((s) => ({ ...s, switchError: message }));
      throw e;
    } finally {
      setSwitchingBarbershop(false);
    }
  }, [refetchProfile]);

  const clearSwitchError = useCallback(() => {
    setState((s) => ({ ...s, switchError: null }));
  }, []);

  const setSelectedScope = useCallback((scope: "__all__" | null) => {
    if (scope) {
      localStorage.setItem(SELECTED_SCOPE_KEY, scope);
      setBarbershopScope(scope);
    } else {
      localStorage.removeItem(SELECTED_SCOPE_KEY);
      setBarbershopScope(null);
    }
    setState((s) => ({ ...s, selectedScope: scope }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, loginWithToken, logout, refetchProfile, switchBarbershop, setSelectedScope, switchingBarbershop, clearSwitchError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
