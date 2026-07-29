import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// QUICK_CAPTURE settings file path is computed at module-import time from
// process.cwd() (same pattern as backup-status-store.ts) — import
// dynamically, after chdir, not statically at the top of this file.
let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./quickcapture-store.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-quickcapture-store-test-"));
  process.chdir(tmpCwd);
  store = await import("./quickcapture-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("getQuickCaptureTarget is null before anything has been configured", async () => {
  assert.equal(await store.getQuickCaptureTarget(), null);
});

test("setQuickCaptureTarget persists and is retrievable", async () => {
  await store.setQuickCaptureTarget("second-brain");
  assert.equal(await store.getQuickCaptureTarget(), "second-brain");
});

test("setQuickCaptureTarget can be cleared back to null", async () => {
  await store.setQuickCaptureTarget("second-brain");
  await store.setQuickCaptureTarget(null);
  assert.equal(await store.getQuickCaptureTarget(), null);
});

test("survives a fresh module instance re-reading from disk", async () => {
  await store.setQuickCaptureTarget("my-app");
  const fresh = (await import(`./quickcapture-store.js?fresh=${Date.now()}`)) as typeof import("./quickcapture-store.js");
  assert.equal(await fresh.getQuickCaptureTarget(), "my-app");
});
