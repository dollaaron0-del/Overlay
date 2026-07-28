import type { Finding } from "@overlay/shared";

const SECTION_HEADER = /^(Added|Removed|Changed) entries:$/;
const SUMMARY_COUNT = {
  Added: /Added entries:\s*(\d+)/,
  Removed: /Removed entries:\s*(\d+)/,
  Changed: /Changed entries:\s*(\d+)/,
} as const;

/**
 * Parses `aide --check` output. AIDE compares the current filesystem
 * against a previously initialized baseline database and reports any
 * unauthorized change — unlike rkhunter/chkrootkit, which only recognize
 * *known* rootkit signatures, this catches arbitrary tampering.
 *
 * NOTE: like the Lynis parser, this hasn't been cross-checked against a
 * real AIDE run (not installed in the dev sandbox) — verify the exact
 * section/line format against real output after the first deployment run
 * (see DEPLOYMENT.md) and adjust if it differs.
 */
export function parseAideOutput(stdout: string): Finding[] {
  if (!/found differences/i.test(stdout)) {
    return [];
  }

  const findings: Finding[] = [];
  const lines = stdout.split("\n");

  // Summary counts first, as high-level findings.
  for (const [label, pattern] of Object.entries(SUMMARY_COUNT)) {
    const match = pattern.exec(stdout);
    const count = match ? Number(match[1]) : 0;
    if (count > 0) {
      const noun = count === 1 ? "Dateieintrag" : "Dateieinträge";
      findings.push({
        severity: "high",
        message: `AIDE: ${count} ${labelDe(label)} ${noun}`,
      });
    }
  }

  // Then individual entries per section, for concrete file-level detail.
  let currentSection: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = SECTION_HEADER.exec(line);
    if (header) {
      currentSection = header[1];
      continue;
    }
    if (!currentSection || !line || /^-+$/.test(line)) continue;

    // AIDE's per-attribute change-flag prefix varies in shape between
    // "Added"/"Removed" (one contiguous flag string) and "Changed" entries
    // (several space-separated flag groups) — match on the trailing
    // ": /absolute/path" rather than anchoring the prefix shape.
    const entryMatch = /:\s*(\/.+)$/.exec(line);
    if (!entryMatch) continue;

    findings.push({
      severity: "high",
      message: `Datei ${labelDe(currentSection)}: ${entryMatch[1]}`,
      context: entryMatch[1],
    });
  }

  return findings;
}

function labelDe(label: string): string {
  switch (label) {
    case "Added":
      return "hinzugefügte";
    case "Removed":
      return "entfernte";
    case "Changed":
      return "geänderte";
    default:
      return label;
  }
}
