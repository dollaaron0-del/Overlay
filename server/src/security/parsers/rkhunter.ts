import type { Finding } from "@overlay/shared";

/**
 * Parses `rkhunter --check --skip-keypress --report-warnings-only` output.
 * With that flag, rkhunter only prints lines for things it's unhappy about,
 * each prefixed with "Warning:".
 */
export function parseRkhunterOutput(stdout: string): Finding[] {
  const findings: Finding[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("Warning:")) continue;
    findings.push({
      severity: "high",
      message: line.replace(/^Warning:\s*/, ""),
    });
  }
  return findings;
}
