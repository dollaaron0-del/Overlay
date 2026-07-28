import { useEffect, useState } from "react";
import type { BackupSummary, ProjectSummary } from "@overlay/shared";
import { api } from "../api/client";
import { formatBytes, formatTimestamp } from "../format";
import { SEVERITY_ORDER, isAllClear, type ScanSummary } from "../security/severity";
import { SeverityBadge } from "../security/SeverityBadge";

interface OllamaStatus {
  configured: boolean;
  reachable?: boolean;
  model?: string;
  modelInstalled?: boolean;
  error?: string;
}

interface BackupStatus {
  configured: boolean;
  latest?: BackupSummary | null;
}

interface SystemStats {
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cpuCount: number;
  totalMemBytes: number;
  freeMemBytes: number;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
}

function ProjectCountBadge({ label, count, className }: { label: string; count: number; className: string }) {
  if (count === 0) return null;
  return (
    <span className={`severity-badge ${className}`}>
      {count} {label}
    </span>
  );
}

export function Overview({
  projects,
  onSelectProject,
  onShowSecurity,
}: {
  projects: ProjectSummary[];
  onSelectProject: (id: string) => void;
  onShowSecurity: () => void;
}) {
  const [lastScan, setLastScan] = useState<ScanSummary | null | undefined>(undefined);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    api
      .get<ScanSummary[]>("/api/security/scans")
      .then((scans) => setLastScan(scans[0] ?? null))
      .catch(() => setLastScan(null));
    api
      .get<OllamaStatus>("/api/security/ollama-status")
      .then(setOllama)
      .catch(() => undefined);
    api
      .get<BackupStatus>("/api/backup/status")
      .then(setBackup)
      .catch(() => undefined);

    const fetchStats = () => api.get<SystemStats>("/api/system/stats").then(setSystemStats).catch(() => undefined);
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const online = projects.filter((p) => p.status === "online").length;
  const stopped = projects.filter((p) => p.status === "stopped").length;
  const errored = projects.filter((p) => p.status === "errored").length;

  const memUsedPercent = systemStats
    ? Math.round(((systemStats.totalMemBytes - systemStats.freeMemBytes) / systemStats.totalMemBytes) * 100)
    : null;
  const diskUsedPercent =
    systemStats?.diskTotalBytes && systemStats.diskFreeBytes !== null
      ? Math.round(((systemStats.diskTotalBytes - systemStats.diskFreeBytes) / systemStats.diskTotalBytes) * 100)
      : null;

  return (
    <div className="overview">
      <section className="overview-section">
        <h2>Server-Ressourcen</h2>
        {!systemStats && <p className="empty-hint">Lädt…</p>}
        {systemStats && (
          <div className="overview-badges overview-system-stats">
            <span>
              Load {systemStats.loadAvg1.toFixed(2)} / {systemStats.loadAvg5.toFixed(2)} /{" "}
              {systemStats.loadAvg15.toFixed(2)} ({systemStats.cpuCount} Kerne)
            </span>
            {memUsedPercent !== null && <span>RAM {memUsedPercent}% belegt</span>}
            {diskUsedPercent !== null && <span>Disk {diskUsedPercent}% belegt</span>}
          </div>
        )}
      </section>

      <section className="overview-section">
        <h2>Projekte</h2>
        {projects.length === 0 ? (
          <p className="empty-hint">Noch keine Projekte registriert.</p>
        ) : (
          <>
            <div className="overview-badges">
              <ProjectCountBadge label="laufen" count={online} className="severity-ok" />
              <ProjectCountBadge label="gestoppt" count={stopped} className="severity-low" />
              <ProjectCountBadge label="Fehler" count={errored} className="severity-critical" />
            </div>
            <ul className="overview-project-list">
              {projects.map((project) => (
                <li key={project.id} onClick={() => onSelectProject(project.id)}>
                  <span className={`status-dot status-${project.status}`} />
                  {project.dirName}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="overview-section" onClick={onShowSecurity} role="button">
        <h2>Letzter Sicherheits-Scan</h2>
        {lastScan === undefined && <p className="empty-hint">Lädt…</p>}
        {lastScan === null && (
          <p className="empty-hint">
            Noch kein Scan gelaufen. Läuft automatisch nachts, sobald eingerichtet (docs/DEPLOYMENT.md).
          </p>
        )}
        {lastScan && (
          <>
            <p className="overview-scan-timestamp">{formatTimestamp(lastScan.startedAt)}</p>
            <div className="overview-badges">
              {SEVERITY_ORDER.map((sev) => (
                <SeverityBadge key={sev} severity={sev} count={lastScan.summary[sev]} />
              ))}
              {isAllClear(lastScan.summary) && <span className="severity-badge severity-ok">unauffällig</span>}
            </div>
          </>
        )}
      </section>

      <section className="overview-section">
        <h2>Backups</h2>
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
      </section>

      <section className="overview-section">
        <h2>Ollama (LLM-Triage)</h2>
        {!ollama && <p className="empty-hint">Lädt…</p>}
        {ollama && !ollama.configured && (
          <p className="empty-hint">Nicht konfiguriert (OLLAMA_MODEL leer) — Scan läuft ohne LLM-Einschätzung.</p>
        )}
        {ollama?.configured && (
          <p className={ollama.reachable ? "overview-ollama-ok" : "overview-ollama-error"}>
            {ollama.reachable
              ? `Erreichbar — Modell "${ollama.model}" ${ollama.modelInstalled ? "installiert" : "NICHT installiert"}`
              : `Nicht erreichbar (${ollama.error})`}
          </p>
        )}
      </section>
    </div>
  );
}
