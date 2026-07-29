import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { formatTimestamp } from "../../format";
import { SEVERITY_ORDER, isAllClear, type ScanSummary } from "../../security/severity";
import { SeverityBadge } from "../../security/SeverityBadge";

export function SecurityWidget({ onOpen }: { onOpen: () => void }) {
  const [lastScan, setLastScan] = useState<ScanSummary | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<ScanSummary[]>("/api/security/scans")
      .then((scans) => setLastScan(scans[0] ?? null))
      .catch(() => setLastScan(null));
  }, []);

  return (
    <div className="os-widget" onClick={onOpen} role="button">
      <h3>Letzter Sicherheits-Scan</h3>
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
    </div>
  );
}
