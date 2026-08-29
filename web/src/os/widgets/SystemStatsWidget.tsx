import { useEffect, useState } from "react";
import { api } from "../../api/client";

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

interface CpuHealthSnapshot {
  tctlC: number | null;
  pingMs: number | null;
  pingLossPct: number | null;
  fan2Rpm: number | null;
  fan3Rpm: number | null;
}

interface NetworkThroughput {
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
}

/** Compact bytes/s: 812 KB/s, 4.7 MB/s, 0 KB/s. */
function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

/**
 * Server-Status in der Sidebar. Immer sichtbar ist nur, was für den
 * laufenden Betrieb grundlegend ist: CPU-Temperatur, Lüfter, Ping (und
 * Internet-Geschwindigkeit, sobald es dafür eine Messung gibt). Alles
 * Übrige — Load, RAM- und Disk-Belegung — ist wichtig, aber nicht
 * kritisch und liegt hinter einem Klick auf die Widget-Überschrift.
 */
export function SystemStatsWidget() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [health, setHealth] = useState<CpuHealthSnapshot | null>(null);
  const [net, setNet] = useState<NetworkThroughput | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchStats = () => api.get<SystemStats>("/api/system/stats").then(setStats).catch(() => undefined);
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchHealth = () =>
      api.get<CpuHealthSnapshot>("/api/system/health/current").then(setHealth).catch(() => undefined);
    fetchHealth();
    const interval = setInterval(fetchHealth, 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchNet = () =>
      api.get<NetworkThroughput>("/api/system/network").then(setNet).catch(() => undefined);
    fetchNet();
    const interval = setInterval(fetchNet, 3000);
    return () => clearInterval(interval);
  }, []);

  const memUsedPercent = stats
    ? Math.round(((stats.totalMemBytes - stats.freeMemBytes) / stats.totalMemBytes) * 100)
    : null;
  const diskUsedPercent =
    stats?.diskTotalBytes && stats.diskFreeBytes !== null
      ? Math.round(((stats.diskTotalBytes - stats.diskFreeBytes) / stats.diskTotalBytes) * 100)
      : null;

  const fans = [health?.fan2Rpm, health?.fan3Rpm].filter((r): r is number => r != null);
  const hasNet = net != null && net.rxBytesPerSec != null && net.txBytesPerSec != null;
  const loading = !stats && !health && !net;

  return (
    <div className="os-widget system-stats-widget">
      <button
        type="button"
        className="system-stats-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Details ausblenden" : "Load, RAM & Disk einblenden"}
      >
        <span>Server-Status</span>
        <span className={`system-stats-caret${expanded ? " open" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {loading && <p className="empty-hint">Lädt…</p>}

      {!loading && (
        <div className="overview-badges overview-system-stats">
          {health?.tctlC != null && <span>CPU {health.tctlC.toFixed(1)} °C</span>}
          {fans.length > 0 && <span>Lüfter {fans.join(" / ")} RPM</span>}
          {health?.pingMs != null && (
            <span>
              Ping {health.pingMs.toFixed(0)} ms
              {health.pingLossPct != null && health.pingLossPct > 0 ? ` · ${health.pingLossPct}% Verlust` : ""}
            </span>
          )}
          {hasNet && (
            <span>
              Netz ↓ {formatRate(net!.rxBytesPerSec!)} ↑ {formatRate(net!.txBytesPerSec!)}
            </span>
          )}
        </div>
      )}

      {expanded && !loading && (
        <div className="overview-badges overview-system-stats system-stats-more">
          {stats && (
            <span>
              Load {stats.loadAvg1.toFixed(2)} / {stats.loadAvg5.toFixed(2)} / {stats.loadAvg15.toFixed(2)} (
              {stats.cpuCount} Kerne)
            </span>
          )}
          {memUsedPercent !== null && <span>RAM {memUsedPercent}% belegt</span>}
          {diskUsedPercent !== null && <span>Disk {diskUsedPercent}% belegt</span>}
        </div>
      )}
    </div>
  );
}
