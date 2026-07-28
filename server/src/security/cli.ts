// Entrypoint for the nightly security scan, invoked by the
// overlay-security-scan systemd service (see docs/DEPLOYMENT.md) — not by
// the main Overlay web server process. Runs as its own root-privileged
// oneshot unit since ClamAV/rkhunter/lynis need full filesystem read access;
// the web server itself stays unprivileged and only ever reads the JSON
// reports this produces.
//
// Deliberately thin: the actual logic lives in cli-helpers.ts (testable in
// isolation) — this file just wires it up and owns the process exit code,
// so importing it anywhere (e.g. a test) doesn't trigger a real scan run.
import { runScan } from "./orchestrator.js";
import { chownReportsDirIfConfigured, formatSummaryLine, notifyIfConfigured } from "./cli-helpers.js";

const startedAt = Date.now();
console.log(`[overlay-security-scan] starting scan at ${new Date(startedAt).toISOString()}`);

const report = await runScan();
await chownReportsDirIfConfigured();
await notifyIfConfigured(report);

console.log(`[overlay-security-scan] finished in ${report.durationSeconds}s — ${formatSummaryLine(report)}`);

// A non-zero exit on critical findings makes this show up as a failed unit
// in `systemctl status` / `journalctl`, which is the cheapest possible
// "something needs your attention" signal without wiring up a separate
// notification channel.
process.exit(report.summary.critical > 0 ? 2 : 0);
