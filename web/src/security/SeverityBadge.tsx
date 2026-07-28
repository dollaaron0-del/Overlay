import type { SeverityCounts } from "@overlay/shared";
import { SEVERITY_LABEL } from "./severity";

export function SeverityBadge({ severity, count }: { severity: keyof SeverityCounts; count: number }) {
  if (count === 0) return null;
  return (
    <span className={`severity-badge severity-${severity}`}>
      {count} {SEVERITY_LABEL[severity]}
    </span>
  );
}
