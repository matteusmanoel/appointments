import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi } from "@/lib/api";
import { setToken, clearToken, getToken } from "@/lib/api";

type Profile = {
  id: string;
  email: string;
  full_name?: string;
  barbershop_id: string;
  role: string;
  must_change_password?: boolean;
};

type AuthState = {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
};

const initialState: AuthState = { profile: null, loading: true, error: null };

const AuthContext = createContext<AuthState & {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refetchProfile: () => void;
}>(null as unknown as AuthState & { login: () => Promise<void>; logout: () => void; refetchProfile: () => void });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const refetchProfile = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setState((s) => ({ ...s, profile: null, loading: false }));
      return;
    }
    try {
      const profile = await authApi.me();
      localStorage.setItem("profile", JSON.stringify(profile));
      setState((s) => ({ ...s, profile, loading: false }));
    } catch {
      clearToken();
      localStorage.removeItem("profile");
      setState((s) => ({ ...s, profile: null, loading: false }));
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("profile");
    if (stored) {
      try {
        const profile = JSON.parse(stored) as Profile;
        setState((s) => ({ ...s, profile, loading: false }));
      } catch {
        setState((s) => ({ ...s, loading: false }));
      }
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { token, profile } = await authApi.login(email, password);
      setToken(token);
      localStorage.setItem("profile", JSON.stringify(profile));
      setState((s) => ({ ...s, profile, loading: false, error: null }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha no login";
      setState((s) => ({ ...s, profile: null, loading: false, error: message }));
      throw e;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem("profile");
    setState((s) => ({ ...s, profile: null }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
