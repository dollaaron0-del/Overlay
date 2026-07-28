import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// config.ts validates required env vars at import time and writes session
// state relative to process.cwd() — set both up before dynamically importing
// anything that pulls config.ts in, so this test never touches the real
// server/data/sessions.json or requires a real .env file.
let tmpCwd: string;
let originalCwd: string;
let session: typeof import("./session.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-session-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  session = await import("./session.js");
});

after(async () => {
  await session._flushPendingWrites();
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("a freshly created session validates as authenticated", () => {
  const cookie = session.createSession();
  assert.equal(session.validateSessionCookie(cookie), true);
});

test("an unset cookie does not validate", () => {
  assert.equal(session.validateSessionCookie(undefined), false);
});

test("garbage input does not validate", () => {
  assert.equal(session.validateSessionCookie("not-a-real-cookie"), false);
});

test("a tampered signature is rejected", () => {
  const cookie = session.createSession();
  const [id] = cookie.split(".");
  const tampered = `${id}.0000000000000000000000000000000000000000000000000000000000000000`;
  assert.equal(session.validateSessionCookie(tampered), false);
});

test("a tampered session id is rejected even with a well-formed signature shape", () => {
  const cookie = session.createSession();
  const dot = cookie.lastIndexOf(".");
  const mac = cookie.slice(dot + 1);
  const forged = `${"a".repeat(64)}.${mac}`;
  assert.equal(session.validateSessionCookie(forged), false);
});

test("destroying a session invalidates it", () => {
  const cookie = session.createSession();
  assert.equal(session.validateSessionCookie(cookie), true);
  session.destroySessionCookie(cookie);
  assert.equal(session.validateSessionCookie(cookie), false);
});

test("destroying an unrelated/garbage cookie does not throw", () => {
  assert.doesNotThrow(() => session.destroySessionCookie("garbage"));
  assert.doesNotThrow(() => session.destroySessionCookie(undefined));
});

test("two created sessions produce distinct, independently valid cookies", () => {
  const a = session.createSession();
  const b = session.createSession();
  assert.notEqual(a, b);
  assert.equal(session.validateSessionCookie(a), true);
  assert.equal(session.validateSessionCookie(b), true);
  session.destroySessionCookie(a);
  assert.equal(session.validateSessionCookie(a), false);
  assert.equal(session.validateSessionCookie(b), true);
});
