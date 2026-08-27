import { useAuth } from "../auth/AuthProvider";

export function SettingsApp() {
  const { logout } = useAuth();

  return (
    <div className="settings-app">
      <h2>Einstellungen</h2>

      <section className="settings-section">
        <h3>Konto</h3>
        <button onClick={() => logout()}>Abmelden</button>
      </section>
    </div>
  );
}
