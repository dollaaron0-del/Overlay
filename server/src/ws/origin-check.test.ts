import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";

let tmpCwd: string;
let originalCwd: string;
let isAllowedOrigin: typeof import("./origin-check.js").isAllowedOrigin;

function fakeRequest(origin: string | undefined, host: string): IncomingMessage {
  return { headers: { origin, host } } as IncomingMessage;
}

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-origin-test-"));
  process.chdir(tmpCwd);

  process.env.NODE_ENV = "production";
  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ isAllowedOrigin } = await import("./origin-check.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("allows a request with no Origin header (non-browser client)", () => {
  assert.equal(isAllowedOrigin(fakeRequest(undefined, "overlay.example.ts.net")), true);
});

test("allows a same-origin request", () => {
  assert.equal(
    isAllowedOrigin(fakeRequest("https://overlay.example.ts.net", "overlay.example.ts.net")),
    true,
  );
});

test("rejects a cross-site origin in production", () => {
  assert.equal(isAllowedOrigin(fakeRequest("https://evil.example", "overlay.example.ts.net")), false);
});

test("rejects a malformed Origin header", () => {
  assert.equal(isAllowedOrigin(fakeRequest("not-a-url", "overlay.example.ts.net")), false);
});

test("rejects the configured dev frontend origin in production", () => {
  assert.equal(
    isAllowedOrigin(fakeRequest("http://localhost:5173", "overlay.example.ts.net")),
    false,
  );
});
