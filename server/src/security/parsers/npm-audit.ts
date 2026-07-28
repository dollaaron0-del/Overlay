import type { Finding, Severity } from "@overlay/shared";

interface NpmAuditJson {
  metadata?: {
    vulnerabilities?: Partial<Record<"info" | "low" | "moderate" | "high" | "critical", number>>;
  };
}

const SEVERITY_MAP: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  moderate: "medium",
  low: "low",
  info: "info",
};

const SEVERITY_LABEL_DE: Record<string, string> = {
  critical: "kritische",
  high: "hohe",
  moderate: "mittlere",
  low: "niedrige",
  info: "informative",
};

/**
 * Parses `npm audit --json` output for a single project and returns one
 * finding per non-zero severity bucket, labelled with the given project name
 * so a multi-project scan can tell them apart.
 */
export function parseNpmAuditOutput(stdout: string, projectLabel: string): Finding[] {
  let parsed: NpmAuditJson;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  const counts = parsed.metadata?.vulnerabilities;
  if (!counts) return [];

  const findings: Finding[] = [];
  for (const [npmSeverity, severity] of Object.entries(SEVERITY_MAP)) {
    const count = counts[npmSeverity as keyof typeof counts];
    if (!count) continue;
    const plural = count === 1 ? "" : "n";
    findings.push({
      severity,
      message: `${count} ${SEVERITY_LABEL_DE[npmSeverity]} npm-Schwachstelle${plural}`,
      context: projectLabel,
    });
  }
  return findings;
}
