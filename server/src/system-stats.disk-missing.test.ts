import { test, before } from "node:test";
import assert from "node:assert/strict";

// Separate file (config.ts is a frozen singleton) so APPS_ROOT can point at
// a path that doesn't exist, verifying disk stats degrade to null instead
// of throwing — relevant on a truly fresh install before APPS_ROOT is
// created.
let getSystemStats: typeof import("./system-stats.js").getSystemStats;

before(async () => {
  process.env.APPS_ROOT = "/nonexistent/overlay-apps-root-for-testing";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  ({ getSystemStats } = await import("./system-stats.js"));
});

test("getSystemStats degrades disk stats to null when APPS_ROOT doesn't exist", async () => {
  const stats = await getSystemStats();
  assert.equal(stats.diskTotalBytes, null);
  assert.equal(stats.diskFreeBytes, null);
  // The rest of the stats are OS-level, independent of APPS_ROOT.
  assert.ok(stats.totalMemBytes > 0);
});
