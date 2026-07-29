import { useAuth } from "../auth/AuthProvider";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider";
import { HOMESCREEN_LAYOUT_STORAGE_KEY } from "../os/homescreen-layout";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "System",
  light: "Hell",
  dark: "Dunkel",
};

export function SettingsApp() {
  const { logout } = useAuth();
  const { preference, setPreference } = useTheme();

  return (
    <div className="settings-app">
      <h2>Einstellungen</h2>

      <section className="settings-section">
        <h3>Darstellung</h3>
        <div className="settings-theme-options">
          {(Object.keys(THEME_LABEL) as ThemePreference[]).map((option) => (
            <button
              key={option}
              className={preference === option ? "active" : ""}
              onClick={() => setPreference(option)}
            >
              {THEME_LABEL[option]}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>Homescreen</h3>
        <button
          onClick={() => {
            if (confirm("Anordnung und ausgeblendete Apps zurücksetzen?")) {
              localStorage.removeItem(HOMESCREEN_LAYOUT_STORAGE_KEY);
              window.location.reload();
            }
          }}
        >
          Homescreen zurücksetzen
        </button>
      </section>

      <section className="settings-section">
        <h3>Konto</h3>
        <button onClick={() => logout()}>Abmelden</button>
      </section>
    </div>
  );
}
