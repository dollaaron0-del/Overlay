import { useEffect, useState } from "react";
import type { BackupSummary, ScanReport } from "@overlay/shared";
import { api } from "../api/client";

interface BackupStatus {
  configured: boolean;
  latest?: BackupSummary | null;
}

const POLL_INTERVAL_MS = 60_000;

/** True when there's something worth a badge dot: critical/high scan findings, or a failed backup. */
export function useAlertStatus(): boolean {
  const [hasAlerts, setHasAlerts] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const [scan, backup] = await Promise.all([
        api.get<ScanReport>("/api/security/scans/latest").catch(() => null),
        api.get<BackupStatus>("/api/backup/status").catch(() => null),
      ]);
      if (cancelled) return;
      const scanAlert = scan ? scan.summary.critical > 0 || scan.summary.high > 0 : false;
      const backupAlert = backup?.configured && backup.latest ? !backup.latest.success : false;
      setHasAlerts(scanAlert || backupAlert);
    };

    void check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return hasAlerts;
}
