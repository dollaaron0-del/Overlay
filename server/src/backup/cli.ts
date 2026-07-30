// Entrypoint for the nightly backup, invoked by the overlay-backup systemd
// service (see docs/DEPLOYMENT.md) — separate from the main Overlay web
// server process so a hung/slow restic run can't affect the dashboard, but
// (unlike the security scan) runs as the SAME unprivileged user, since
// backing up APPS_ROOT and this server's own data/ needs no elevated
// privilege.
import { runBackupJob } from "./backup-job.js";
import { notifyOpenClawIfConfigured } from "../openclaw/openclaw-webhook.js";

const summary = await runBackupJob();

if (!summary) {
  console.log("[overlay-backup] RESTIC_REPOSITORY not configured — skipping.");
  process.exit(0);
}

if (summary.success) {
  console.log(
    `[overlay-backup] finished in ${summary.durationSeconds}s — ` +
      `${summary.filesNew} new, ${summary.filesChanged} changed, ${summary.filesUnmodified} unchanged, ` +
      `${summary.dataAdded} bytes added, snapshot ${summary.snapshotId}`,
  );
  process.exit(0);
} else {
  console.error(`[overlay-backup] failed after ${summary.durationSeconds}s: ${summary.error}`);
  await notifyOpenClawIfConfigured(`Overlay-Backup fehlgeschlagen nach ${summary.durationSeconds}s: ${summary.error}`);
  process.exit(1);
}
