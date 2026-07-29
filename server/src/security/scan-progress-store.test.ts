import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The progress file path is computed at module-import time from
// process.cwd() (same pattern as report-store.ts) — import dynamically,
// after chdir, not statically at the top of this file.
let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./scan-progress-store.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-scan-progress-test-"));
  process.chdir(tmpCwd);
  store = await import("./scan-progress-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("getScanProgress is null before anything has been written", async () => {
  assert.equal(await store.getScanProgress(), null);
});

test("writeScanProgress persists and is retrievable", async () => {
  await store.writeScanProgress({ step: 3, totalSteps: 10, tool: "lynis", startedAt: "2026-01-01T00:00:00.000Z" });
  const progress = await store.getScanProgress();
  assert.deepEqual(progress, { step: 3, totalSteps: 10, tool: "lynis", startedAt: "2026-01-01T00:00:00.000Z" });
});

test("the progress file is created world-readable (mode 0o644)", async () => {
  await store.writeScanProgress({ step: 1, totalSteps: 10, tool: "clamav", startedAt: "2026-01-01T00:00:00.000Z" });
  const filePath = path.join(tmpCwd, "data", "scan-progress.json");
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o644);
});

test("clearScanProgress removes the file", async () => {
  await store.writeScanProgress({ step: 1, totalSteps: 10, tool: "clamav", startedAt: "2026-01-01T00:00:00.000Z" });
  await store.clearScanProgress();
  assert.equal(await store.getScanProgress(), null);
});

test("clearScanProgress is a no-op when nothing was written", async () => {
  await assert.doesNotReject(() => store.clearScanProgress());
});
