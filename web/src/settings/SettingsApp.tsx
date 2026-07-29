import { useAuth } from "../auth/AuthProvider";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider";
import { HOMESCREEN_LAYOUT_STORAGE_KEY } from "../os/homescreen-layout";
import { useIdleLock } from "../os/IdleLockProvider";
import type { IdleLockPreference } from "../os/idle-lock-preference";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "System",
  light: "Hell",
  dark: "Dunkel",
};

const IDLE_LOCK_OPTIONS: { value: IdleLockPreference; label: string }[] = [
  { value: 1, label: "1 Minute" },
  { value: 5, label: "5 Minuten" },
  { value: 15, label: "15 Minuten" },
  { value: "never", label: "Nie" },
];

export function SettingsApp() {
  const { logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const { minutes, setMinutes } = useIdleLock();

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
        <h3>Automatische Sperre</h3>
        <p className="settings-hint">
          Verlangt nach der gewählten Zeit ohne Interaktion wieder das Passwort — die eigentliche Sitzung bleibt
          dabei bestehen, laufende Terminal-Sessions werden nicht beendet.
        </p>
        <div className="settings-theme-options">
          {IDLE_LOCK_OPTIONS.map((option) => (
            <button
              key={String(option.value)}
              className={minutes === option.value ? "active" : ""}
              onClick={() => setMinutes(option.value)}
            >
              {option.label}
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
