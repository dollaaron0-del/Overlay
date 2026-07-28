import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";

interface AuthContextValue {
  authenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ authenticated: boolean }>("/api/session")
      .then((res) => setAuthenticated(res.authenticated))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    await api.post("/api/login", { username, password });
    setAuthenticated(true);
  };

  const logout = async () => {
    await api.post("/api/logout");
    setAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ authenticated, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
