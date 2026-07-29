import { useEffect, useState } from "react";
import type { BackupSummary } from "@overlay/shared";
import { api } from "../../api/client";
import { formatBytes, formatTimestamp } from "../../format";

interface BackupStatus {
  configured: boolean;
  latest?: BackupSummary | null;
}

export function BackupWidget() {
  const [backup, setBackup] = useState<BackupStatus | null>(null);

  useEffect(() => {
    api
      .get<BackupStatus>("/api/backup/status")
      .then(setBackup)
      .catch(() => undefined);
  }, []);

  return (
    <div className="os-widget">
      <h3>Backups</h3>
      {!backup && <p className="empty-hint">Lädt…</p>}
      {backup && !backup.configured && (
        <p className="empty-hint">Nicht konfiguriert (RESTIC_REPOSITORY leer) — es laufen keine Backups.</p>
      )}
      {backup?.configured && !backup.latest && (
        <p className="empty-hint">Noch kein Backup gelaufen. Läuft automatisch nachts (docs/DEPLOYMENT.md).</p>
      )}
      {backup?.configured && backup.latest && (
        <>
          <p className="overview-scan-timestamp">{formatTimestamp(backup.latest.startedAt)}</p>
          {backup.latest.success ? (
            <p className="overview-ollama-ok">
              Erfolgreich — {backup.latest.filesNew ?? 0} neu, {backup.latest.filesChanged ?? 0} geändert,{" "}
              {backup.latest.dataAdded !== undefined ? formatBytes(backup.latest.dataAdded) : "?"} hinzugefügt
            </p>
          ) : (
            <p className="overview-ollama-error">Fehlgeschlagen: {backup.latest.error}</p>
          )}
        </>
      )}
    </div>
  );
}
