import fs from "node:fs/promises";
import path from "node:path";
import type { BackupSummary } from "@overlay/shared";
import { config } from "../config.js";
import { repositoryExists, initRepository, runBackup, forgetAndPrune } from "./restic-client.js";
import { makeBackupId, saveBackupSummary } from "./backup-status-store.js";
import { emitBackupProgress } from "./backup-progress-bus.js";

/**
 * Runs one full backup cycle (init-if-needed, backup, forget/prune) and
 * persists the result — success or failure — via backup-status-store.
 * Unlike the security scan's cli.ts, this needs no root and no chown step:
 * it runs as the same unprivileged user that already owns APPS_ROOT and
 * this server's own data/ directory.
 */
export async function runBackupJob(): Promise<BackupSummary | null> {
  if (!config.RESTIC_REPOSITORY) {
    return null; // backups not configured — nothing to do
  }

  const id = makeBackupId();
  const startedAt = new Date().toISOString();
  const start = Date.now();

  const env = { repository: config.RESTIC_REPOSITORY, password: config.RESTIC_PASSWORD };
  const dataDir = path.join(process.cwd(), "data");
  const paths = [config.APPS_ROOT, dataDir];

  let summary: BackupSummary;
  try {
    if (!(await repositoryExists(env, config.BACKUP_TIMEOUT_MS))) {
      await initRepository(env, config.BACKUP_TIMEOUT_MS);
    }

    // restic picks its parent snapshot by matching the exact set of paths
    // passed to `backup`. A nonexistent path gets silently skipped rather
    // than failing, but that *changes the path set* — so if data/ doesn't
    // exist yet on the very first run, every later run (once it does exist)
    // finds no matching parent and re-scans everything as "new", not just
    // the newly-added data/. Create it upfront so the path set — and thus
    // incremental change detection — stays stable across every run.
    await fs.mkdir(dataDir, { recursive: true });

    const result = await runBackup(paths, env, config.BACKUP_TIMEOUT_MS, (progress) => {
      emitBackupProgress({ type: "progress", ...progress });
    });
    await forgetAndPrune(
      env,
      {
        keepDaily: config.BACKUP_KEEP_DAILY,
        keepWeekly: config.BACKUP_KEEP_WEEKLY,
        keepMonthly: config.BACKUP_KEEP_MONTHLY,
      },
      config.BACKUP_TIMEOUT_MS,
    );

    summary = {
      id,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - start) / 1000),
      success: true,
      filesNew: result.filesNew,
      filesChanged: result.filesChanged,
      filesUnmodified: result.filesUnmodified,
      totalBytesProcessed: result.totalBytesProcessed,
      dataAdded: result.dataAdded,
      snapshotId: result.snapshotId,
    };
  } catch (err) {
    summary = {
      id,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - start) / 1000),
      success: false,
      error: (err as Error).message,
    };
  }

  await saveBackupSummary(summary);
  emitBackupProgress({ type: "done" });
  return summary;
}
