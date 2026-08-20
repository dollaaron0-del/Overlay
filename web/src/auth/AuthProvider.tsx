import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";

interface AuthContextValue {
  authenticated: boolean;
  user: string | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Authelia's own portal, one hostname over on port 9091 (see
// deploy/caddy/Caddyfile and docs/DEPLOYMENT.md section 9) — Overlay has no
// login/logout of its own to call. NOTE: not verified against Authelia's
// live docs from this dev sandbox; confirm the exact logout path
// (https://www.authelia.com/configuration/session/introduction/) still
// matches before relying on it.
function autheliaPortalUrl(path: string): string {
  return `https://${window.location.hostname}:9091${path}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ authenticated: boolean; user: string | null }>("/api/session")
      .then((res) => {
        setAuthenticated(res.authenticated);
        setUser(res.user);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    window.location.href = autheliaPortalUrl("/logout");
  };

  return (
    <AuthContext.Provider value={{ authenticated, user, loading, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
