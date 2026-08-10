import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "System",
  light: "Hell",
  dark: "Dunkel",
};

type TriggerState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "waiting"; message: string }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

// How long to keep polling /api/health for the server to come back before we
// give up and tell the user to reload. A pull + full rebuild + pm2 restart is
// expected well under three minutes.
const UPDATE_LIVE_TIMEOUT_MS = 180_000;
const UPDATE_POLL_INTERVAL_MS = 2_000;
// Without a known pre-update uptime, treat any uptime below this as "freshly
// restarted" rather than the old process still running.
const FRESH_UPTIME_THRESHOLD_S = 60;

interface UpdateUnitStatus {
  state: "idle" | "running" | "failed";
  invocationId: string | null;
  message?: string;
}

/** Never throws: not knowing the unit's state is normal (mid-restart, no systemd). */
async function readUpdateStatus(): Promise<UpdateUnitStatus | null> {
  try {
    return await api.get<UpdateUnitStatus>("/api/system/update/status");
  } catch {
    return null;
  }
}

/**
 * Waits for the triggered update to either restart the server or fail.
 *
 * A restart resets process.uptime(), so the first health reading below the
 * uptime we saw at trigger time is unambiguously the post-restart process
 * (uptime only climbs until the restart). While the server is mid-restart the
 * health call throws (connection refused) — we just keep polling.
 *
 * The unit's own verdict is checked first each round, because a failed run
 * never restarts anything: without it, an update that died in its first second
 * looked exactly like one still building, and burned the full timeout before
 * blaming the restart. Only a failure from a *newer* invocation than the one
 * present before the trigger counts — otherwise an old, never-cleared failure
 * would fail every future update on sight. Rejects on timeout.
 */
async function waitForUpdateOutcome(
  previousUptimeS: number | null,
  previousInvocationId: string | null,
): Promise<{ failed: false } | { failed: true; message: string }> {
  const deadline = Date.now() + UPDATE_LIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, UPDATE_POLL_INTERVAL_MS));

    const status = await readUpdateStatus();
    if (status?.state === "failed" && status.invocationId !== previousInvocationId) {
      return { failed: true, message: status.message ?? "Update fehlgeschlagen." };
    }

    try {
      const health = await api.get<{ status: string; uptimeSeconds: number }>("/api/health");
      const restarted =
        previousUptimeS === null
          ? health.uptimeSeconds < FRESH_UPTIME_THRESHOLD_S
          : health.uptimeSeconds < previousUptimeS;
      if (restarted) return { failed: false };
    } catch {
      // Server is mid-restart — keep polling until it answers again.
    }
  }
  throw new Error("timeout");
}

export function ControlCenter({ onClose }: { onClose: () => void }) {
  const { preference, setPreference } = useTheme();
  const [scanState, setScanState] = useState<TriggerState>({ status: "idle" });
  const [backupState, setBackupState] = useState<TriggerState>({ status: "idle" });
  const [updateState, setUpdateState] = useState<TriggerState>({ status: "idle" });

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

  const triggerUpdate = async () => {
    setUpdateState({ status: "running" });
    // Snapshot the current uptime before we trigger, so we can tell the
    // post-restart process apart from the one handling this very click.
    let previousUptimeS: number | null = null;
    try {
      const health = await api.get<{ uptimeSeconds: number }>("/api/health");
      previousUptimeS = health.uptimeSeconds;
    } catch {
      // Fall back to the fresh-uptime heuristic in waitForUpdateOutcome.
    }
    // Which run systemd last recorded, so a failure left over from an earlier
    // attempt isn't pinned on this one.
    const previousInvocationId = (await readUpdateStatus())?.invocationId ?? null;

    try {
      // Returns as soon as the update is queued (the unit runs --no-block); the
      // server keeps serving until its own last step restarts it.
      await api.post("/api/system/update");
    } catch (err) {
      setUpdateState({
        status: "error",
        message: err instanceof ApiError ? (err.message ?? "Fehler beim Update") : "Fehler beim Update",
      });
      return;
    }

    setUpdateState({ status: "waiting", message: "Update läuft — warte, bis Overlay wieder online ist…" });
    try {
      const outcome = await waitForUpdateOutcome(previousUptimeS, previousInvocationId);
      if (outcome.failed) {
        setUpdateState({ status: "error", message: outcome.message });
        return;
      }
      setUpdateState({ status: "ok", message: "Alle Daten live — Overlay ist wieder online." });
    } catch {
      setUpdateState({
        status: "error",
        message:
          "Neustart dauert länger als erwartet. Bitte die Seite neu laden — falls Overlay nicht zurückkommt: journalctl -u overlay-update.service",
      });
    }
  };

  const updateBusy = updateState.status === "running" || updateState.status === "waiting";

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
          <h4>Overlay aktualisieren</h4>
          <button onClick={triggerUpdate} disabled={updateBusy}>
            {updateState.status === "running"
              ? "Wird ausgelöst…"
              : updateState.status === "waiting"
                ? "Warte auf Neustart…"
                : "Jetzt aktualisieren"}
          </button>
          {updateState.status === "waiting" && <p className="overview-ollama-pending">{updateState.message}</p>}
          {updateState.status === "ok" && <p className="overview-ollama-ok">{updateState.message}</p>}
          {updateState.status === "error" && <p className="overview-ollama-error">{updateState.message}</p>}
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
