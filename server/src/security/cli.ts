// Entrypoint for the nightly security scan, invoked by the
// overlay-security-scan systemd service (see docs/DEPLOYMENT.md) — not by
// the main Overlay web server process. Runs as its own root-privileged
// oneshot unit since ClamAV/rkhunter/lynis need full filesystem read access;
// the web server itself stays unprivileged and only ever reads the JSON
// reports this produces.
import path from "node:path";
import { runScan } from "./orchestrator.js";
import { runCommand } from "./run-tool.js";

function formatSummaryLine(report: Awaited<ReturnType<typeof runScan>>): string {
  const { critical, high, medium, low, info } = report.summary;
  const skipped = report.tools.filter((t) => t.status === "skipped").map((t) => t.tool);
  const parts = [`critical=${critical}`, `high=${high}`, `medium=${medium}`, `low=${low}`, `info=${info}`];
  if (skipped.length > 0) parts.push(`skipped=[${skipped.join(",")}]`);
  return parts.join(" ");
}

async function chownReportsDirIfConfigured(): Promise<void> {
  const user = process.env.SECURITY_SCAN_CHOWN_USER;
  if (!user) return;
  const owner = process.env.SECURITY_SCAN_CHOWN_GROUP ? `${user}:${process.env.SECURITY_SCAN_CHOWN_GROUP}` : user;
  const reportsDir = path.join(process.cwd(), "data", "security-scans");
  try {
    await runCommand("chown", ["-R", owner, reportsDir], { timeoutMs: 30_000 });
  } catch (err) {
    console.error(`Warning: failed to chown ${reportsDir} to ${owner}: ${(err as Error).message}`);
  }
}

const startedAt = Date.now();
console.log(`[overlay-security-scan] starting scan at ${new Date(startedAt).toISOString()}`);

const report = await runScan();
await chownReportsDirIfConfigured();

console.log(`[overlay-security-scan] finished in ${report.durationSeconds}s — ${formatSummaryLine(report)}`);

// A non-zero exit on critical findings makes this show up as a failed unit
// in `systemctl status` / `journalctl`, which is the cheapest possible
// "something needs your attention" signal without wiring up a separate
// notification channel.
process.exit(report.summary.critical > 0 ? 2 : 0);
