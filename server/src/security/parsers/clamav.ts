import type { Finding } from "@overlay/shared";

const FOUND_LINE = /^(.+): (.+) FOUND$/;

/**
 * Parses `clamscan -r -i --stdout <paths>` output. With -i (only-infected),
 * every "<path>: <signature> FOUND" line is an actual detection — each one
 * is treated as critical, since this is real malware, not a config nit.
 */
export function parseClamAvOutput(stdout: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of stdout.split("\n")) {
    const match = FOUND_LINE.exec(line.trim());
    if (!match) continue;
    const [, file, signature] = match;
    findings.push({
      severity: "critical",
      message: `Malware gefunden: ${signature}`,
      context: file,
    });
  }
  return findings;
}
