/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet, apiPost } from "../api/client";
import { setAccessToken } from "./accessToken";

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  avatar_url: string | null;
  display_name: string;
};

export type AuthConfig = {
  publicRegistration: boolean;
  googleEnabled: boolean;
  appName: string;
  logoUrl: string | null;
  primaryColorHex: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  config: AuthConfig | null;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, username?: string) => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AuthConfig | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const res = await apiPost<{
        access_token: string;
        user: AuthUser;
      }>("/api/v1/auth/refresh", {}, { credentials: "include", auth: false });
      setAccessToken(res.access_token);
      setUser(res.user);
    } catch {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await apiGet<AuthConfig>("/api/v1/auth/config", { auth: false });
        if (!cancelled) setConfig(cfg);
      } catch {
        if (!cancelled)
          setConfig({
            publicRegistration: false,
            googleEnabled: false,
            appName: "Hasu Inventory",
            logoUrl: null,
            primaryColorHex: "#5B21B6",
          });
      }
      await refreshSession();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  useEffect(() => {
    if (!config?.primaryColorHex) return;
    document.documentElement.style.setProperty("--color-primary", config.primaryColorHex);
  }, [config?.primaryColorHex]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const res = await apiPost<{
        access_token: string;
        user: AuthUser;
      }>("/api/v1/auth/login", { email, password, remember_me: remember }, { credentials: "include", auth: false });
      setAccessToken(res.access_token);
      setUser(res.user);
    },
    []
  );

  const register = useCallback(
    async (email: string, password: string, username?: string) => {
      const res = await apiPost<{
        access_token: string;
        user: AuthUser;
      }>(
        "/api/v1/auth/register",
        { email, password, username: username || undefined },
        { credentials: "include", auth: false }
      );
      setAccessToken(res.access_token);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiPost(
        "/api/v1/auth/logout",
        {},
        { credentials: "include", auth: true }
      );
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      config,
      login,
      logout,
      register,
      refreshSession,
    }),
    [user, loading, config, login, logout, register, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
