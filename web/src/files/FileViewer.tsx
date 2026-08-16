import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";

export function FileViewer({ projectId, path }: { projectId: string; path: string | null }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setContent(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    setError(null);
    api
      .get<string>(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`)
      .then((data) => {
        if (!cancelled) setContent(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Fehler beim Laden");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);

  if (!path) return <div className="file-viewer empty-hint">Datei aus dem Baum auswählen</div>;
  if (error) return <div className="file-viewer file-viewer-error">{error}</div>;
  return (
    <pre className="file-viewer">
      <code>{content ?? "Lädt…"}</code>
    </pre>
  );
}
