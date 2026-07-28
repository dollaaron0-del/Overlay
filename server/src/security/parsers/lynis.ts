import type { Finding } from "@overlay/shared";

/**
 * Parses Lynis's machine-readable report file (/var/log/lynis-report.dat by
 * default): simple key=value lines, with repeatable keys like `warning[]=`
 * and `suggestion[]=` using a `|`-delimited sub-format that (per publicly
 * documented Lynis report formats) leads with the test id, then a
 * description, then an optional solution/manual-page reference:
 *   warning[]=<test-id>|<description>|<solution-or-dash>|
 *   suggestion[]=<test-id>|<description>|<solution-or-dash>|
 *
 * NOTE: this hasn't been cross-checked against a real lynis-report.dat (Lynis
 * isn't installed in the dev sandbox) — verify the field order against the
 * real file after the first deployment run (see DEPLOYMENT.md) and adjust
 * the split below if the description/id order turns out reversed.
 */
export function parseLynisReport(reportDat: string): Finding[] {
  const findings: Finding[] = [];
  for (const rawLine of reportDat.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);

    if (key === "warning[]") {
      const [testId, description] = value.split("|");
      findings.push({ severity: "high", message: description || value, context: testId });
    } else if (key === "suggestion[]") {
      const [testId, description] = value.split("|");
      findings.push({ severity: "low", message: description || value, context: testId });
    } else if (key === "hardening_index") {
      findings.push({ severity: "info", message: `Lynis Hardening Index: ${value}/100` });
    }
  }
  return findings;
}
