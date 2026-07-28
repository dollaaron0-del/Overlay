import type { Finding } from "@overlay/shared";

/**
 * Parses `chkrootkit` output. Each check prints a "Checking `x'... <result>"
 * line; clean results are "not found"/"not infected"/"nothing found" and are
 * ignored. An actual hit says "INFECTED" (case varies by check); a handful of
 * checks print their own "Warning" lines for things worth a look but not a
 * confirmed rootkit.
 */
export function parseChkrootkitOutput(stdout: string): Finding[] {
  const findings: Finding[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/infected/i.test(line) && !/not infected/i.test(line)) {
      findings.push({ severity: "critical", message: line });
    } else if (/^warning/i.test(line)) {
      findings.push({ severity: "medium", message: line });
    }
  }
  return findings;
}
