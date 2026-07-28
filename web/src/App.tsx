import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { AppShell } from "./layout/AppShell";

function Gate() {
  const { authenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen">Lädt…</div>;
  return authenticated ? <AppShell /> : <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
