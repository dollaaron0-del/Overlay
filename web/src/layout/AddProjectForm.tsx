import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";

export function AddProjectForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [kind, setKind] = useState<"pm2" | "systemd" | "pm2-root">("pm2");
  const [availableDirs, setAvailableDirs] = useState<string[]>([]);
  const [dirName, setDirName] = useState("");
  const [id, setId] = useState("");
  const [pm2Name, setPm2Name] = useState("");
  const [startScript, setStartScript] = useState("npm start");
  const [deployScript, setDeployScript] = useState("");
  const [systemdUnit, setSystemdUnit] = useState("");
  const [pm2RootName, setPm2RootName] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<string[]>("/api/projects/available-dirs")
      .then((dirs) => {
        setAvailableDirs(dirs);
        if (dirs.length > 0) {
          setDirName(dirs[0]);
          setId(dirs[0]);
          setPm2Name(dirs[0]);
        }
      })
      .catch(() => undefined);
  }, []);

  const selectDir = (name: string) => {
    setDirName(name);
    setId(name);
    setPm2Name(name);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (kind === "systemd") {
        // dirName here is just the name of the empty placeholder folder
        // Overlay creates for this project under APPS_ROOT (see
        // ensureStubDir in projects.registry.ts) — the app's real code lives
        // elsewhere and Overlay never touches it. Reusing the id keeps this
        // invisible to the person filling out the form.
        await api.post("/api/projects", { kind: "systemd", id, dirName: id, systemdUnit, externalUrl });
      } else if (kind === "pm2-root") {
        // Same reasoning as the systemd branch above — dirName is just a
        // placeholder, the real process lives in another Linux user's PM2
        // daemon.
        await api.post("/api/projects", { kind: "pm2-root", id, dirName: id, pm2RootName, externalUrl });
      } else {
        await api.post("/api/projects", {
          id,
          dirName,
          pm2Name,
          startScript,
          deployScript: deployScript || undefined,
          externalUrl: externalUrl || undefined,
        });
      }
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Hinzufügen") : "Fehler beim Hinzufügen");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="add-project-form" onSubmit={submit}>
      <div className="add-project-form-header">
        <h3>Projekt hinzufügen</h3>
        <button type="button" className="close-button" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="add-project-kind-toggle">
        <label>
          <input type="radio" checked={kind === "pm2"} onChange={() => setKind("pm2")} />
          PM2-Projekt (Code unter APPS_ROOT)
        </label>
        <label>
          <input type="radio" checked={kind === "systemd"} onChange={() => setKind("systemd")} />
          Extern (bereits laufender systemd-Dienst)
        </label>
        <label>
          <input type="radio" checked={kind === "pm2-root"} onChange={() => setKind("pm2-root")} />
          Extern (PM2-Prozess unter anderem User)
        </label>
      </div>

      {kind === "systemd" ? (
        <>
          <p className="empty-hint">
            Für eine App, die schon eigenständig über systemd läuft (z.B. unter einem anderen Linux-User) —
            Overlay steuert sie über eine eng gefasste sudoers-Regel statt PM2. Siehe docs/DEPLOYMENT.md,
            Abschnitt "Extern verwaltete Projekte", für die nötige Server-Einrichtung.
          </p>
          <label>
            Projekt-ID
            <input value={id} onChange={(e) => setId(e.target.value)} required />
          </label>
          <label>
            systemd-Unit
            <input
              value={systemdUnit}
              onChange={(e) => setSystemdUnit(e.target.value)}
              placeholder="mein-dienst.service"
              required
            />
          </label>
          <label>
            Dashboard-URL
            <input
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://server.tailnet.ts.net:9093/"
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Wird hinzugefügt…" : "Hinzufügen"}
          </button>
        </>
      ) : kind === "pm2-root" ? (
        <>
          <p className="empty-hint">
            Für eine App, die schon eigenständig unter einer <em>anderen</em> PM2-Instanz läuft (z.B. unter
            root, während Overlay selbst unter einem eigenen Service-User läuft) — Overlay steuert sie über
            eine eng gefasste sudoers-Regel ("sudo pm2 …") statt der eigenen PM2-Verbindung. Siehe
            docs/DEPLOYMENT.md, Abschnitt "PM2-Prozesse unter fremdem User", für die nötige
            Server-Einrichtung.
          </p>
          <label>
            Projekt-ID
            <input value={id} onChange={(e) => setId(e.target.value)} required />
          </label>
          <label>
            PM2-Prozessname (in der fremden PM2-Instanz)
            <input
              value={pm2RootName}
              onChange={(e) => setPm2RootName(e.target.value)}
              placeholder="nachhilfe"
              required
            />
          </label>
          <label>
            Dashboard-URL
            <input
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://server.tailnet.ts.net:9093/"
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Wird hinzugefügt…" : "Hinzufügen"}
          </button>
        </>
      ) : availableDirs.length === 0 ? (
        <p className="empty-hint">
          Kein unregistriertes Verzeichnis unter APPS_ROOT gefunden. Lege den App-Ordner zuerst auf dem
          Server an.
        </p>
      ) : (
        <>
          <label>
            Verzeichnis
            <select value={dirName} onChange={(e) => selectDir(e.target.value)}>
              {availableDirs.map((dir) => (
                <option key={dir} value={dir}>
                  {dir}
                </option>
              ))}
            </select>
          </label>
          <label>
            Projekt-ID
            <input value={id} onChange={(e) => setId(e.target.value)} required />
          </label>
          <label>
            PM2-Name
            <input value={pm2Name} onChange={(e) => setPm2Name(e.target.value)} required />
          </label>
          <label>
            Start-Befehl
            <input value={startScript} onChange={(e) => setStartScript(e.target.value)} required />
          </label>
          <label>
            Deploy-Befehl (optional)
            <input
              value={deployScript}
              onChange={(e) => setDeployScript(e.target.value)}
              placeholder="git pull && npm install && npm run build"
            />
          </label>
          <label>
            Dashboard-URL (optional)
            <input
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://server.tailnet.ts.net:9093/"
            />
          </label>
          <p className="empty-hint">
            Falls das Projekt zusätzlich zu Terminal/Logs auch eine eigene Web-Oberfläche hat, zeigt Overlay dafür
            eine zweite Kachel im Dashboards-Bereich, die direkt dorthin verlinkt. Kann auch später im Projekt
            nachgetragen werden.
          </p>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Wird hinzugefügt…" : "Hinzufügen"}
          </button>
        </>
      )}
    </form>
  );
}
