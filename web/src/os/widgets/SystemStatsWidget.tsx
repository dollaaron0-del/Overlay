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
  fan2Rpm: number | null;
}

export function SystemStatsWidget({ onOpen }: { onOpen: () => void }) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [health, setHealth] = useState<CpuHealthSnapshot | null>(null);

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

  const memUsedPercent = stats
    ? Math.round(((stats.totalMemBytes - stats.freeMemBytes) / stats.totalMemBytes) * 100)
    : null;
  const diskUsedPercent =
    stats?.diskTotalBytes && stats.diskFreeBytes !== null
      ? Math.round(((stats.diskTotalBytes - stats.diskFreeBytes) / stats.diskTotalBytes) * 100)
      : null;

  return (
    <div className="os-widget" onClick={onOpen} role="button">
      <h3>Server-Status</h3>
      {!stats && <p className="empty-hint">Lädt…</p>}
      {stats && (
        <div className="overview-badges overview-system-stats">
          <span>
            Load {stats.loadAvg1.toFixed(2)} / {stats.loadAvg5.toFixed(2)} / {stats.loadAvg15.toFixed(2)} (
            {stats.cpuCount} Kerne)
          </span>
          {memUsedPercent !== null && <span>RAM {memUsedPercent}% belegt</span>}
          {diskUsedPercent !== null && <span>Disk {diskUsedPercent}% belegt</span>}
          {health?.tctlC != null && <span>CPU {health.tctlC.toFixed(1)}°C</span>}
          {health?.pingMs != null && <span>Ping {health.pingMs.toFixed(0)} ms</span>}
          {health?.fan2Rpm != null && <span>Lüfter {health.fan2Rpm} RPM</span>}
        </div>
      )}
    </div>
  );
}
