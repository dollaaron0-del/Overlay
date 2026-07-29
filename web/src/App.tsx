import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { OsShell } from "./os/OsShell";
import { ThemeProvider } from "./theme/ThemeProvider";

function Gate() {
  const { authenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen">Lädt…</div>;
  return authenticated ? <OsShell /> : <LoginPage />;
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
