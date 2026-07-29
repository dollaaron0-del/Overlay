import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "System",
  light: "Hell",
  dark: "Dunkel",
};

type TriggerState = { status: "idle" } | { status: "running" } | { status: "ok"; message: string } | { status: "error"; message: string };

export function ControlCenter({ onClose }: { onClose: () => void }) {
  const { preference, setPreference } = useTheme();
  const [scanState, setScanState] = useState<TriggerState>({ status: "idle" });
  const [backupState, setBackupState] = useState<TriggerState>({ status: "idle" });

  const triggerScan = async () => {
    setScanState({ status: "running" });
    try {
      await api.post("/api/security/scans/run");
      setScanState({ status: "ok", message: "Scan gestartet — Ergebnis erscheint in der Sicherheit-App." });
    } catch (err) {
      setScanState({
        status: "error",
        message: err instanceof ApiError ? (err.message ?? "Fehler beim Starten") : "Fehler beim Starten",
      });
    }
  };

  const triggerBackup = async () => {
    setBackupState({ status: "running" });
    try {
      await api.post("/api/backup/run");
      setBackupState({ status: "ok", message: "Backup gestartet — Status erscheint im Backups-Widget." });
    } catch (err) {
      let message = "Fehler beim Starten";
      if (err instanceof ApiError) {
        if (err.message === "not_configured") message = "Nicht konfiguriert (RESTIC_REPOSITORY leer).";
        else if (err.message === "already_running") message = "Läuft bereits.";
        else message = err.message ?? message;
      }
      setBackupState({ status: "error", message });
    }
  };

  return (
    <div className="control-center-backdrop" onClick={onClose}>
      <div className="control-center-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notification-header">
          <h3>Kontrollzentrum</h3>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <section className="control-center-item">
          <h4>Sicherheits-Scan</h4>
          <button onClick={triggerScan} disabled={scanState.status === "running"}>
            {scanState.status === "running" ? "Wird gestartet…" : "Jetzt scannen"}
          </button>
          {scanState.status === "ok" && <p className="overview-ollama-ok">{scanState.message}</p>}
          {scanState.status === "error" && <p className="overview-ollama-error">{scanState.message}</p>}
        </section>

        <section className="control-center-item">
          <h4>Backup</h4>
          <button onClick={triggerBackup} disabled={backupState.status === "running"}>
            {backupState.status === "running" ? "Wird gestartet…" : "Jetzt sichern"}
          </button>
          {backupState.status === "ok" && <p className="overview-ollama-ok">{backupState.message}</p>}
          {backupState.status === "error" && <p className="overview-ollama-error">{backupState.message}</p>}
        </section>

        <section className="control-center-item">
          <h4>Darstellung</h4>
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
      </div>
    </div>
  );
}
