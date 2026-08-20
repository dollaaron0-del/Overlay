import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";

interface ProjectOption {
  id: string;
  dirName: string;
  name?: string;
}

interface PendingImage {
  previewUrl: string;
  dataBase64: string;
  mimeType: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function QuickCaptureApp() {
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<string | null | undefined>(undefined);
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [obsidianMode, setObsidianMode] = useState(false);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [image, setImage] = useState<PendingImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<ProjectOption[]>("/api/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
    api
      .get<{ targetProjectId: string | null }>("/api/quick-capture/target")
      .then((res) => setTargetProjectId(res.targetProjectId))
      .catch(() => setTargetProjectId(null));
    api
      .get<{ obsidianMode: boolean }>("/api/quick-capture/obsidian-mode")
      .then((res) => setObsidianMode(res.obsidianMode))
      .catch(() => {});
  }, []);

  const targetProject = projects?.find((p) => p.id === targetProjectId);
  const needsTargetSetup = targetProjectId !== undefined && (!targetProjectId || !targetProject);

  const chooseTarget = async (projectId: string) => {
    try {
      await api.put("/api/quick-capture/target", { projectId });
      setTargetProjectId(projectId);
      setChoosingTarget(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Speichern") : "Fehler beim Speichern");
    }
  };

  const toggleObsidianMode = async (checked: boolean) => {
    const previous = obsidianMode;
    setObsidianMode(checked);
    try {
      await api.put("/api/quick-capture/obsidian-mode", { obsidianMode: checked });
    } catch (err) {
      setObsidianMode(previous);
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Speichern") : "Fehler beim Speichern");
    }
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const [prefix, base64] = dataUrl.split(",");
    const mimeType = /data:(.*);base64/.exec(prefix)?.[1] ?? file.type;
    setImage({ previewUrl: dataUrl, dataBase64: base64, mimeType });
  };

  const removeImage = () => {
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canSave = !saving && (text.trim() || link.trim() || image);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      await api.post("/api/quick-capture", {
        text: text.trim() || undefined,
        link: link.trim() || undefined,
        image: image ? { dataBase64: image.dataBase64, mimeType: image.mimeType } : undefined,
      });
      setText("");
      setLink("");
      removeImage();
      setSavedMessage("Gespeichert ✓");
    } catch (err) {
      setError(err instanceof ApiError ? (err.message ?? "Fehler beim Speichern") : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  };

  if (projects === null || targetProjectId === undefined) {
    return <p className="empty-hint">Lädt…</p>;
  }

  if (needsTargetSetup || choosingTarget) {
    return (
      <div className="quick-capture-app">
        <h2>Schnellnotiz</h2>
        <p className="settings-hint">
          Wähle einmalig das Projekt, an das Schnellnotizen angehängt werden (als <code>inbox.md</code> in dessen
          Verzeichnis). Das gilt geräteübergreifend, z.B. auch vom iPhone aus.
        </p>
        {projects.length === 0 ? (
          <p className="empty-hint">Noch keine Projekte registriert.</p>
        ) : (
          <div className="quick-capture-target-picker">
            {projects.map((p) => (
              <button key={p.id} onClick={() => chooseTarget(p.id)}>
                {p.name || p.dirName}
              </button>
            ))}
          </div>
        )}
        <label className="quick-capture-obsidian-toggle">
          <input
            type="checkbox"
            checked={obsidianMode}
            onChange={(e) => toggleObsidianMode(e.target.checked)}
          />
          Obsidian-Modus: jede Notiz als eigene Datei mit Frontmatter unter <code>inbox/</code> statt an{" "}
          <code>inbox.md</code> angehängt
        </label>
        {error && <p className="login-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="quick-capture-app">
      <div className="quick-capture-header">
        <h2>Schnellnotiz</h2>
        <button className="quick-capture-target-button" onClick={() => setChoosingTarget(true)}>
          Ziel: {targetProject?.name || targetProject?.dirName} ✎
        </button>
      </div>

      {obsidianMode && <p className="quick-capture-obsidian-hint">Obsidian-Modus aktiv: jede Notiz wird als eigene Datei gespeichert.</p>}

      <textarea
        className="quick-capture-textarea"
        placeholder="Woran denkst du gerade?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        rows={6}
      />

      <input
        className="quick-capture-link-input"
        type="url"
        placeholder="Link (optional)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />

      <div className="quick-capture-image-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickImage}
          id="quick-capture-image-input"
          className="quick-capture-image-input"
        />
        <label htmlFor="quick-capture-image-input" className="quick-capture-image-label">
          📷 Bild hinzufügen
        </label>
        {image && (
          <div className="quick-capture-image-preview">
            <img src={image.previewUrl} alt="Ausgewähltes Bild" />
            <button onClick={removeImage} aria-label="Bild entfernen">
              ✕
            </button>
          </div>
        )}
      </div>

      {error && <p className="login-error">{error}</p>}
      {savedMessage && <p className="overview-ollama-ok">{savedMessage}</p>}

      <button className="quick-capture-save-button" onClick={save} disabled={!canSave}>
        {saving ? "Speichert…" : "Speichern"}
      </button>
    </div>
  );
}
