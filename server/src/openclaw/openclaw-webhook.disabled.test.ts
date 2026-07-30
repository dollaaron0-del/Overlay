import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Separate process/file from openclaw-webhook.test.ts: here
// OPENCLAW_WEBHOOK_URL is deliberately left unset (the default, "not
// configured" case) — same pattern as security/cli-helpers.disabled.test.ts.
let tmpCwd: string;
let originalCwd: string;
let notifyOpenClawIfConfigured: typeof import("./openclaw-webhook.js").notifyOpenClawIfConfigured;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-openclaw-disabled-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ notifyOpenClawIfConfigured } = await import("./openclaw-webhook.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("notifyOpenClawIfConfigured is a silent no-op when no webhook URL is configured", async () => {
  // Should resolve without throwing and without needing any network access.
  await notifyOpenClawIfConfigured("sollte nie irgendwo ankommen");
});
