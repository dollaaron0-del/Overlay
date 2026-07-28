import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanReport } from "@overlay/shared";
import { emptySeverityCounts } from "@overlay/shared";

// Separate process/file from cli-helpers.test.ts: here NTFY_URL is
// deliberately left unset (the default, "not configured" case).
let tmpCwd: string;
let originalCwd: string;
let helpers: typeof import("./cli-helpers.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-cli-helpers-disabled-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  helpers = await import("./cli-helpers.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("notifyIfConfigured is a silent no-op when NTFY_URL isn't set, even with critical findings", async () => {
  const report: ScanReport = {
    id: "2026-07-29T02-00-00",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: 1,
    tools: [],
    summary: { ...emptySeverityCounts(), critical: 5 },
  };
  // Should resolve without throwing and without needing any network access.
  await helpers.notifyIfConfigured(report);
});
