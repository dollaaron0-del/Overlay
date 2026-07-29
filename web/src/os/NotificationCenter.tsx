import { useEffect, useState } from "react";
import type { AuditEntry, BackupSummary, ScanReport } from "@overlay/shared";
import { api } from "../api/client";
import { formatTimestamp } from "../format";

interface BackupStatus {
  configured: boolean;
  latest?: BackupSummary | null;
}

export function NotificationCenter({
  onClose,
  onOpenApp,
}: {
  onClose: () => void;
  onOpenApp: (id: string) => void;
}) {
  const [scan, setScan] = useState<ScanReport | null | undefined>(undefined);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [deploys, setDeploys] = useState<AuditEntry[]>([]);

  useEffect(() => {
    api
      .get<ScanReport>("/api/security/scans/latest")
      .then(setScan)
      .catch(() => setScan(null));
    api
      .get<BackupStatus>("/api/backup/status")
      .then(setBackup)
      .catch(() => undefined);
    api
      .get<AuditEntry[]>("/api/audit")
      .then((entries) => setDeploys(entries.filter((e) => e.type === "project_deployed").slice(0, 5)))
      .catch(() => undefined);
  }, []);

  const aptTool = scan?.tools.find((t) => t.tool === "apt-updates");

  const openApp = (id: string) => {
    onOpenApp(id);
    onClose();
  };

  return (
    <div className="notification-backdrop" onClick={onClose}>
      <div className="notification-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notification-header">
          <h3>Benachrichtigungen</h3>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <section className="notification-item" onClick={() => openApp("security")} role="button">
          <h4>Sicherheits-Scan</h4>
          {scan === undefined && <p className="empty-hint">Lädt…</p>}
          {scan === null && <p className="empty-hint">Noch kein Scan gelaufen.</p>}
          {scan && (
            <p>
              {formatTimestamp(scan.startedAt)} — {scan.summary.critical} kritisch, {scan.summary.high} hoch,{" "}
              {scan.summary.medium} mittel
            </p>
          )}
        </section>

        {aptTool && aptTool.findings.length > 0 && (
          <section className="notification-item" onClick={() => openApp("security")} role="button">
            <h4>Verfügbare Updates</h4>
            <p>{aptTool.findings.length} Paket-Update(s) verfügbar</p>
          </section>
        )}

        <section className="notification-item">
          <h4>Backup</h4>
          {!backup && <p className="empty-hint">Lädt…</p>}
          {backup && !backup.configured && <p className="empty-hint">Nicht konfiguriert.</p>}
          {backup?.configured && !backup.latest && <p className="empty-hint">Noch kein Backup gelaufen.</p>}
          {backup?.configured && backup.latest && (
            <p>
              {formatTimestamp(backup.latest.startedAt)} —{" "}
              {backup.latest.success ? "erfolgreich" : `fehlgeschlagen: ${backup.latest.error}`}
            </p>
          )}
        </section>

        <section className="notification-item" onClick={() => openApp("activity")} role="button">
          <h4>Letzte Deploys</h4>
          {deploys.length === 0 && <p className="empty-hint">Keine Deploys bisher.</p>}
          <ul className="notification-list">
            {deploys.map((entry, i) => (
              <li key={i}>
                {formatTimestamp(entry.timestamp)} — {entry.detail}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
