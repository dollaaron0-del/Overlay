import { useState, type FormEvent } from "react";
import { api, ApiError, SsoExpiredError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await api.post("/api/verify-password", { password });
      onUnlock();
    } catch (err) {
      if (err instanceof SsoExpiredError) {
        // Intercepted by the 2FA portal before Overlay saw the password —
        // logging out here would be wrong (this session is probably still
        // fine), and a reload to the portal is already on its way.
        setError("2FA-Sitzung abgelaufen — Seite wird neu geladen.");
      } else if (err instanceof ApiError && err.message === "too_many_attempts") {
        setError("Zu viele Versuche — kurz warten.");
      } else if (err instanceof ApiError && err.message === "unauthenticated") {
        // The underlying session died (expired, or the admin password changed
        // elsewhere) — no password will ever unlock this, so drop straight
        // back to the login screen instead of looping "wrong password".
        setError("Sitzung abgelaufen — bitte neu anmelden.");
        await logout();
      } else if (err instanceof ApiError && err.message === "invalid_password") {
        setError("Falsches Passwort.");
      } else {
        setError("Verbindungsfehler — bitte erneut versuchen.");
      }
    } finally {
      setChecking(false);
      setPassword("");
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="lock-screen">
      <form className="login-card lock-screen-card" onSubmit={submit}>
        <div className="lock-screen-icon">🔒</div>
        <h1>Gesperrt</h1>
        <label>
          Passwort
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={checking}>
          {checking ? "Prüfe…" : "Entsperren"}
        </button>
        <button type="button" className="lock-screen-logout" disabled={loggingOut} onClick={handleLogout}>
          {loggingOut ? "Abmelden…" : "Abmelden"}
        </button>
      </form>
    </div>
  );
}
