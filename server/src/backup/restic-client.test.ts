import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseBackupSummary,
  parseStatusLine,
  repositoryExists,
  initRepository,
  runBackup,
  forgetAndPrune,
} from "./restic-client.js";

// These integration tests run against a *real* restic binary (installed in
// this dev sandbox specifically to verify the --json output schema instead
// of guessing it, unlike some of the other scan tool parsers) against a
// throwaway local repository — no network, no real data involved.

test("parseBackupSummary extracts fields from a real restic --json summary line", () => {
  // Captured verbatim from an actual `restic backup --json` run.
  const output = `{"message_type":"status","percent_done":1,"total_files":1,"files_done":1,"total_bytes":12,"bytes_done":12}
{"message_type":"summary","files_new":1,"files_changed":0,"files_unmodified":0,"dirs_new":7,"dirs_changed":0,"dirs_unmodified":0,"data_blobs":1,"tree_blobs":8,"data_added":2902,"total_files_processed":1,"total_bytes_processed":12,"total_duration":0.235890566,"snapshot_id":"caea1c9491b4355068bbd0c3ab450862bdbe7cc97bf621cec414bb3352c68738"}`;
  const summary = parseBackupSummary(output);
  assert.ok(summary);
  assert.equal(summary.filesNew, 1);
  assert.equal(summary.totalBytesProcessed, 12);
  assert.equal(summary.dataAdded, 2902);
  assert.equal(summary.snapshotId, "caea1c9491b4355068bbd0c3ab450862bdbe7cc97bf621cec414bb3352c68738");
});

test("parseBackupSummary returns null when there's no summary line", () => {
  assert.equal(parseBackupSummary('{"message_type":"status"}'), null);
  assert.equal(parseBackupSummary(""), null);
  assert.equal(parseBackupSummary("not json at all"), null);
});

test("parseStatusLine extracts progress from a real status line, and ignores everything else", () => {
  const progress = parseStatusLine('{"message_type":"status","percent_done":0.5,"total_files":10,"files_done":5}');
  assert.deepEqual(progress, { percentDone: 0.5, filesDone: 5, totalFiles: 10 });

  assert.equal(parseStatusLine('{"message_type":"summary","files_new":1}'), null);
  assert.equal(parseStatusLine("not json at all"), null);
  assert.equal(parseStatusLine(""), null);
});

test("real restic: full init -> backup -> forget lifecycle against a throwaway repo", { timeout: 30_000 }, async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-restic-test-"));
  const repoDir = path.join(tmpRoot, "repo");
  const sourceDir = path.join(tmpRoot, "source");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, "file1.txt"), "hello world");

  const env = { repository: repoDir, password: "test-password-not-for-prod" };
  const progressCalls: Array<{ percentDone: number; filesDone: number; totalFiles: number }> = [];

  try {
    assert.equal(await repositoryExists(env, 10_000), false);

    await initRepository(env, 10_000);
    assert.equal(await repositoryExists(env, 10_000), true);

    const firstBackup = await runBackup([sourceDir], env, 20_000, (p) => progressCalls.push(p));
    assert.equal(firstBackup.filesNew, 1);
    assert.ok(firstBackup.snapshotId);

    // A near-instant one-file backup may finish before restic ever emits a
    // "status" line — onProgress firing isn't guaranteed, but if it did,
    // the values it saw must be sane.
    for (const p of progressCalls) {
      assert.ok(p.percentDone >= 0 && p.percentDone <= 1);
      assert.ok(p.filesDone <= p.totalFiles);
    }

    // A second backup with no changes should report the file as unmodified, not new.
    const secondBackup = await runBackup([sourceDir], env, 20_000);
    assert.equal(secondBackup.filesNew, 0);
    assert.equal(secondBackup.filesUnmodified, 1);

    // Should not throw.
    await forgetAndPrune(env, { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 }, 20_000);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("runBackup rejects when the restic binary doesn't exist", async () => {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = "/nonexistent";
    await assert.rejects(() => runBackup(["/tmp"], { repository: "/tmp/nope", password: "x" }, 5000));
  } finally {
    process.env.PATH = originalPath;
  }
});

test("initRepository throws a clear error when the target path is a file, not a directory", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-restic-conflict-test-"));
  const conflictingPath = path.join(tmpRoot, "not-a-directory");
  await fs.writeFile(conflictingPath, "this occupies the path restic would need as a directory");
  try {
    await assert.rejects(
      () => initRepository({ repository: conflictingPath, password: "x" }, 10_000),
      /restic init failed/,
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
