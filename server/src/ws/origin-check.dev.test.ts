import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";

// Separate file (its own process, per node:test's default file isolation)
// so it can set NODE_ENV=development without affecting origin-check.test.ts's
// production-mode assertions — config.ts is loaded once per process.
let tmpCwd: string;
let originalCwd: string;
let isAllowedOrigin: typeof import("./origin-check.js").isAllowedOrigin;

function fakeRequest(origin: string | undefined, host: string): IncomingMessage {
  return { headers: { origin, host } } as IncomingMessage;
}

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-origin-dev-test-"));
  process.chdir(tmpCwd);

  process.env.NODE_ENV = "development";
  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.DEV_FRONTEND_ORIGIN = "http://localhost:5173";

  ({ isAllowedOrigin } = await import("./origin-check.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("allows the configured dev frontend origin outside production", () => {
  assert.equal(isAllowedOrigin(fakeRequest("http://localhost:5173", "127.0.0.1:4317")), true);
});

test("still rejects an unrelated cross-site origin outside production", () => {
  assert.equal(isAllowedOrigin(fakeRequest("https://evil.example", "127.0.0.1:4317")), false);
});
