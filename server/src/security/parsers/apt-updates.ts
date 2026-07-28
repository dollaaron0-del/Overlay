import type { Finding } from "@overlay/shared";

const UPGRADABLE_LINE = /^(\S+)\/(\S+)\s+(\S+)\s+(\S+)\s+\[upgradable from:\s*([^\]]+)\]$/;

/**
 * Parses `apt list --upgradable` output. The origin field (e.g.
 * "noble-updates,noble-security") lists every suite a package is available
 * from, comma-separated — a package pulled from a "-security" suite gets a
 * higher severity, since that's specifically a security fix, not just a
 * routine version bump. Deliberately does NOT apply anything (see
 * docs/DEPLOYMENT.md section on update management): a nightly dashboard tap
 * is too risky a way to trigger a real system update — recommend
 * unattended-upgrades for that instead.
 */
export function parseAptUpgradable(output: string): Finding[] {
  const findings: Finding[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Listing...")) continue;

    const match = UPGRADABLE_LINE.exec(line);
    if (!match) continue;

    const [, pkg, origin, newVersion, , oldVersion] = match;
    const isSecurity = origin.split(",").some((suite) => suite.includes("-security"));

    findings.push({
      severity: isSecurity ? "high" : "medium",
      message: isSecurity
        ? `Sicherheitsupdate verfügbar: ${pkg} ${oldVersion.trim()} → ${newVersion}`
        : `Update verfügbar: ${pkg} ${oldVersion.trim()} → ${newVersion}`,
      context: pkg,
    });
  }
  return findings;
}
