import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { OsShell } from "./os/OsShell";
import { ThemeProvider } from "./theme/ThemeProvider";
import { IdleLockProvider } from "./os/IdleLockProvider";

function Gate() {
  const { authenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen">Lädt…</div>;
  return authenticated ? (
    <IdleLockProvider>
      <OsShell />
    </IdleLockProvider>
  ) : (
    <LoginPage />
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}
