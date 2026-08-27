import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { EmmyShell } from "./os/EmmyShell";
import { useDynamicViewportHeight } from "./layout/useDynamicViewportHeight";

// Renders whenever /api/session reports unauthenticated: AUTH_DISABLED is
// off (normal) and no Remote-User header came through, meaning either
// Authelia/Caddy aren't set up yet or Caddy's forward_auth was bypassed.
// There's no Overlay-side login to offer — only Authelia's portal can fix
// this. See docs/DEPLOYMENT.md section 9.
function Unauthenticated() {
  return (
    <div className="loading-screen">
      Nicht angemeldet — bitte über {window.location.hostname}:9091 (Authelia) anmelden.
    </div>
  );
}

function Gate() {
  const { authenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen">Lädt…</div>;
  return authenticated ? <EmmyShell /> : <Unauthenticated />;
}

export function App() {
  useDynamicViewportHeight();
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
