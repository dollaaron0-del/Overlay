import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BackupSummary } from "@overlay/shared";

let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./backup-status-store.js");

function fakeSummary(id: string, overrides: Partial<BackupSummary> = {}): BackupSummary {
  return {
    id,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: 30,
    success: true,
    ...overrides,
  };
}

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-backup-store-test-"));
  process.chdir(tmpCwd);
  store = await import("./backup-status-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(path.join(tmpCwd, "data", "backups"), { recursive: true, force: true });
});

test("makeBackupId produces a valid id matching the same scheme as scan reports", () => {
  const id = store.makeBackupId(new Date("2026-07-29T03:00:00.000Z"));
  assert.equal(id, "2026-07-29T03-00-00");
  assert.equal(store.isValidBackupId(id), true);
});

test("rejects malformed/traversal ids", () => {
  assert.equal(store.isValidBackupId("../../etc/passwd"), false);
});

test("listBackupSummaries is empty before any backup ran", async () => {
  assert.deepEqual(await store.listBackupSummaries(), []);
  assert.equal(await store.getLatestBackupSummary(), undefined);
});

test("saveBackupSummary persists a summary retrievable by id", async () => {
  const id = store.makeBackupId(new Date("2026-07-29T03:00:00.000Z"));
  await store.saveBackupSummary(fakeSummary(id, { filesNew: 5, dataAdded: 1024 }));
  const loaded = await store.getBackupSummary(id);
  assert.ok(loaded);
  assert.equal(loaded.filesNew, 5);
  assert.equal(loaded.dataAdded, 1024);
});

test("saveBackupSummary refuses a malformed id", async () => {
  await assert.rejects(() => store.saveBackupSummary(fakeSummary("not-a-valid-id")));
});

test("listBackupSummaries sorts newest first", async () => {
  const older = store.makeBackupId(new Date("2026-07-28T03:00:00.000Z"));
  const newer = store.makeBackupId(new Date("2026-07-29T03:00:00.000Z"));
  await store.saveBackupSummary(fakeSummary(older));
  await store.saveBackupSummary(fakeSummary(newer));

  const list = await store.listBackupSummaries();
  assert.deepEqual(
    list.map((s) => s.id),
    [newer, older],
  );
});

test("getLatestBackupSummary returns the most recent one", async () => {
  const older = store.makeBackupId(new Date("2026-07-01T03:00:00.000Z"));
  const newer = store.makeBackupId(new Date("2026-07-02T03:00:00.000Z"));
  await store.saveBackupSummary(fakeSummary(older));
  await store.saveBackupSummary(fakeSummary(newer));

  const latest = await store.getLatestBackupSummary();
  assert.equal(latest?.id, newer);
});

test("retains a failed backup summary too (success: false with an error)", async () => {
  const id = store.makeBackupId(new Date("2026-07-29T03:00:00.000Z"));
  await store.saveBackupSummary(fakeSummary(id, { success: false, error: "restic: repository locked" }));
  const loaded = await store.getBackupSummary(id);
  assert.equal(loaded?.success, false);
  assert.match(loaded?.error ?? "", /locked/);
});

test("retention prunes older summaries beyond the keep count", async () => {
  for (let i = 0; i < 65; i++) {
    const date = new Date(Date.UTC(2026, 0, i + 1, 3, 0, 0));
    await store.saveBackupSummary(fakeSummary(store.makeBackupId(date)));
  }
  const list = await store.listBackupSummaries();
  assert.equal(list.length, 60);
});
