import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Own process (config.ts is a frozen singleton) with RESTIC_REPOSITORY set
// before backup-job.js (and transitively config.js) is first imported.
// Runs against a real restic binary and a real throwaway repo — no mocks.
let tmpCwd: string;
let appsRoot: string;
let repoDir: string;
let originalCwd: string;
let backupJob: typeof import("./backup-job.js");
let store: typeof import("./backup-status-store.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-backup-job-test-"));
  process.chdir(tmpCwd);

  appsRoot = path.join(tmpCwd, "apps-root");
  repoDir = path.join(tmpCwd, "restic-repo");
  await fs.mkdir(path.join(appsRoot, "some-app"), { recursive: true });
  await fs.writeFile(path.join(appsRoot, "some-app", "data.txt"), "important data");

  process.env.APPS_ROOT = appsRoot;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.RESTIC_REPOSITORY = repoDir;
  process.env.RESTIC_PASSWORD = "test-password-not-for-prod";

  backupJob = await import("./backup-job.js");
  store = await import("./backup-status-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test(
  "runBackupJob initializes the repo on first run, backs up APPS_ROOT + data/, and persists a success summary",
  { timeout: 30_000 },
  async () => {
    const summary = await backupJob.runBackupJob();
    assert.ok(summary);
    assert.equal(summary.success, true);
    assert.equal(summary.filesNew, 1); // just data.txt — this test's own data/ dir doesn't exist yet
    assert.ok(summary.snapshotId);

    const persisted = await store.getLatestBackupSummary();
    assert.equal(persisted?.id, summary.id);
  },
);

test("a second run reports the source file as unmodified, not new", { timeout: 30_000 }, async () => {
  const summary = await backupJob.runBackupJob();
  assert.ok(summary);
  assert.equal(summary.success, true);
  // The only "new" file here is run 1's own backup-summary JSON — it's
  // written to data/backups/ only *after* run 1's restic backup completes,
  // so it correctly shows up as new in run 2, not run 1. data.txt itself
  // (the actual source data) is unmodified, which is what this test checks.
  assert.equal(summary.filesNew, 1);
  assert.equal(summary.filesUnmodified, 1);
});
