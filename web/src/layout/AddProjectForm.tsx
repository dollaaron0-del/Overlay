import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";

export function AddProjectForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [availableDirs, setAvailableDirs] = useState<string[]>([]);
  const [dirName, setDirName] = useState("");
  const [id, setId] = useState("");
  const [pm2Name, setPm2Name] = useState("");
  const [startScript, setStartScript] = useState("npm start");
  const [deployScript, setDeployScript] = useState("");
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
      await api.post("/api/projects", { id, dirName, pm2Name, startScript, deployScript: deployScript || undefined });
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

      {availableDirs.length === 0 ? (
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
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Wird hinzugefügt…" : "Hinzufügen"}
          </button>
        </>
      )}
    </form>
  );
}
