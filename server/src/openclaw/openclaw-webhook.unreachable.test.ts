import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Separate process/file: OPENCLAW_WEBHOOK_URL is configured but points at
// nothing listening, to verify notifyOpenClawIfConfigured swallows the
// resulting error rather than propagating it (a failed push must never fail
// the scan/backup/plan-save it's reporting on).
let tmpCwd: string;
let originalCwd: string;
let notifyOpenClawIfConfigured: typeof import("./openclaw-webhook.js").notifyOpenClawIfConfigured;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-openclaw-unreachable-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.OPENCLAW_WEBHOOK_URL = "http://127.0.0.1:1/unreachable";

  ({ notifyOpenClawIfConfigured } = await import("./openclaw-webhook.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("notifyOpenClawIfConfigured swallows errors instead of throwing", async () => {
  await assert.doesNotReject(() => notifyOpenClawIfConfigured("darf nicht werfen"));
});
