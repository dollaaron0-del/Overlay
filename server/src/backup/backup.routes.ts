import { Router } from "express";
import { config } from "../config.js";
import { getLatestBackupSummary, listBackupSummaries } from "./backup-status-store.js";
import { runBackupJob } from "./backup-job.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const backupRouter = Router();

// Backups run as the SAME unprivileged user as the web server (see
// backup-job.ts) — unlike the security scan, no privilege boundary to cross,
// so a manual trigger can call the job directly. It can take a long time
// (BACKUP_TIMEOUT_MS), so this fires it in the background and responds
// immediately; poll /status for the result. The guard below only prevents a
// second *manual* trigger from overlapping a running one — it can't see the
// independent nightly-cron process, but restic's own repository locking is
// the safety net for that rarer race.
let manualRunInProgress = false;

backupRouter.post("/run", async (_req, res) => {
  if (!config.RESTIC_REPOSITORY) {
    res.status(400).json({ error: "not_configured" });
    return;
  }
  if (manualRunInProgress) {
    res.status(409).json({ error: "already_running" });
    return;
  }
  manualRunInProgress = true;
  runBackupJob()
    .catch((err) => console.error("[backup] manual trigger failed", err))
    .finally(() => {
      manualRunInProgress = false;
    });
  await appendAuditEntry({ type: "backup_triggered" });
  res.json({ ok: true });
});

backupRouter.get("/status", async (_req, res) => {
  if (!config.RESTIC_REPOSITORY) {
    res.json({ configured: false });
    return;
  }
  const latest = await getLatestBackupSummary();
  res.json({ configured: true, latest: latest ?? null });
});

backupRouter.get("/history", async (_req, res) => {
  const summaries = await listBackupSummaries();
  res.json(summaries);
});
