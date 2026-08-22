import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";

// config.ts is a frozen singleton, so env has to be set before the dynamic
// import below. AUTOMATION_TOKEN is deliberately left unset: the whole point
// of this middleware is that an internal tick authenticates without it.
let tmpCwd: string;
let originalCwd: string;
let requireSchedulerToken: typeof import("./emmy-scheduler.middleware.js").requireSchedulerToken;
let getSchedulerToken: typeof import("./emmy-scheduler-token.js").getSchedulerToken;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-scheduler-mw-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  delete process.env.AUTOMATION_TOKEN;

  ({ requireSchedulerToken } = await import("./emmy-scheduler.middleware.js"));
  ({ getSchedulerToken } = await import("./emmy-scheduler-token.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

function fakeReq(authorization?: string): Request {
  return { header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined) } as unknown as Request;
}

function fakeRes() {
  const state: { status: number | null; body: unknown } = { status: null, body: null };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function run(authorization?: string) {
  const { res, state } = fakeRes();
  let called = false;
  requireSchedulerToken(fakeReq(authorization), res, () => {
    called = true;
  });
  return { called, state };
}

// The regression this whole change exists for: before it, an install without
// AUTOMATION_TOKEN got a 404 here and every scheduled tick exited 1, so
// recurring research stayed "fällig" forever.
test("accepts the internal token even when AUTOMATION_TOKEN is unset", () => {
  const { called, state } = run(`Bearer ${getSchedulerToken()}`);
  assert.equal(called, true);
  assert.equal(state.status, null);
});

test("never 404s the route the way requireAutomationToken did", () => {
  const { state } = run("Bearer definitely-not-the-token");
  assert.equal(state.status, 401);
  assert.deepEqual(state.body, { error: "unauthorized" });
});

test("rejects a missing Authorization header", () => {
  const { called, state } = run(undefined);
  assert.equal(called, false);
  assert.equal(state.status, 401);
});

test("rejects a non-Bearer Authorization header", () => {
  const { called, state } = run("Basic dXNlcjpwYXNz");
  assert.equal(called, false);
  assert.equal(state.status, 401);
});

test("rejects a token that is a prefix of the real one", () => {
  const { called, state } = run(`Bearer ${getSchedulerToken().slice(0, 16)}`);
  assert.equal(called, false);
  assert.equal(state.status, 401);
});
