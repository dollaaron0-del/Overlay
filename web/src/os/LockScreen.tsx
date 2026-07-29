import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await api.post("/api/verify-password", { password });
      onUnlock();
    } catch (err) {
      if (err instanceof ApiError && err.message === "too_many_attempts") {
        setError("Zu viele Versuche — kurz warten.");
      } else {
        setError("Falsches Passwort.");
      }
    } finally {
      setChecking(false);
      setPassword("");
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
      </form>
    </div>
  );
}
