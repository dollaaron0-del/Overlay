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
let sendEmmyChatMessage: typeof import("./openclaw-webhook.js").sendEmmyChatMessage;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-openclaw-disabled-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ notifyOpenClawIfConfigured, sendEmmyChatMessage } = await import("./openclaw-webhook.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("notifyOpenClawIfConfigured is a silent no-op when no webhook URL is configured", async () => {
  // Should resolve without throwing and without needing any network access.
  await notifyOpenClawIfConfigured("sollte nie irgendwo ankommen");
});

test("sendEmmyChatMessage throws when no webhook URL is configured, unlike the best-effort notification above", async () => {
  // emmy.routes.ts relies on this throwing so it can tell the sender the
  // message didn't reach OpenClaw (see the 502 branch there) — unlike
  // notifyOpenClawIfConfigured, an unconfigured OpenClaw isn't a silent
  // no-op here, it's the only way this chat can reach anyone.
  await assert.rejects(() => sendEmmyChatMessage("sollte nie irgendwo ankommen"), /OPENCLAW_WEBHOOK_URL/);
});
