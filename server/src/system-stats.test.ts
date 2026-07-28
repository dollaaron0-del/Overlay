import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// config.ts is a frozen singleton — set APPS_ROOT to a real, existing
// directory before first import so statfs() succeeds.
let getSystemStats: typeof import("./system-stats.js").getSystemStats;

before(async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-system-stats-test-"));
  process.env.APPS_ROOT = tmpDir;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  ({ getSystemStats } = await import("./system-stats.js"));
});

test("getSystemStats returns plausible load, memory, and disk figures", async () => {
  const stats = await getSystemStats();
  assert.ok(stats.loadAvg1 >= 0);
  assert.ok(stats.cpuCount >= 1);
  assert.ok(stats.totalMemBytes > 0);
  assert.ok(stats.freeMemBytes >= 0);
  assert.ok(stats.freeMemBytes <= stats.totalMemBytes);
  assert.ok(stats.diskTotalBytes !== null && stats.diskTotalBytes > 0);
  assert.ok(stats.diskFreeBytes !== null && stats.diskFreeBytes >= 0);
});
