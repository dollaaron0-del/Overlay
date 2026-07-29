import { useEffect, useState } from "react";
import type { AuditEntry, ScanReport } from "@overlay/shared";
import { api } from "../api/client";
import { getActivityLastViewed } from "./activity-badge";

/**
 * One-shot load of badge counts for the static apps (keyed the same way as
 * Spotlight/OsShell: "app:security", "app:activity"). Not polled — HomeScreen
 * unmounts/remounts every time the user navigates back to it, which is
 * already a natural refresh point.
 */
export function useAppBadges(): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [scan, auditEntries] = await Promise.all([
        api.get<ScanReport>("/api/security/scans/latest").catch(() => null),
        api.get<AuditEntry[]>("/api/audit").catch(() => [] as AuditEntry[]),
      ]);
      if (cancelled) return;

      const next: Record<string, number> = {};

      const securityCount = scan ? scan.summary.critical + scan.summary.high : 0;
      if (securityCount > 0) next["app:security"] = securityCount;

      const lastViewed = getActivityLastViewed();
      const unseenCount = lastViewed ? auditEntries.filter((e) => e.timestamp > lastViewed).length : auditEntries.length;
      if (unseenCount > 0) next["app:activity"] = unseenCount;

      setBadges(next);
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return badges;
}
