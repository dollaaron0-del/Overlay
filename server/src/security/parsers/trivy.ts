import type { Finding, Severity } from "@overlay/shared";

interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string; // CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN
}

interface TrivyResult {
  Target?: string;
  Vulnerabilities?: TrivyVulnerability[];
}

interface TrivyJson {
  Results?: TrivyResult[];
}

const SEVERITY_MAP: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  unknown: "info",
};

/**
 * Parses `trivy rootfs --format json <path>` output: OS-package-level CVEs
 * (e.g. an outdated openssl/glibc) that npm audit can't see since it only
 * looks at Node dependencies.
 */
export function parseTrivyOutput(stdout: string): Finding[] {
  let parsed: TrivyJson;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  for (const result of parsed.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      const severity = SEVERITY_MAP[vuln.Severity?.toLowerCase()] ?? "info";
      const fix = vuln.FixedVersion ? ` (Fix: ${vuln.FixedVersion})` : " (kein Fix verfügbar)";
      findings.push({
        severity,
        message: `${vuln.PkgName} ${vuln.InstalledVersion}: ${vuln.VulnerabilityID}${fix}`,
        context: result.Target,
      });
    }
  }
  return findings;
}
