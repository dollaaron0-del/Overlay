import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";

// config.ts (EMMY_INBOUND_TOKEN) is a frozen singleton — import
// requireEmmyInboundToken dynamically, after setting env vars.
let tmpCwd: string;
let originalCwd: string;
let requireEmmyInboundToken: typeof import("./emmy-inbound.middleware.js").requireEmmyInboundToken;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-emmy-inbound-mw-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.EMMY_INBOUND_TOKEN = "correct-horse-battery-staple";

  ({ requireEmmyInboundToken } = await import("./emmy-inbound.middleware.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

function fakeReq(authorization?: string): Request {
  return { header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined) } as unknown as Request;
}

interface FakeRes {
  res: Response;
  state: { status: number | null; body: unknown };
}

function fakeRes(): FakeRes {
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

test("calls next() when the Bearer token matches EMMY_INBOUND_TOKEN exactly", () => {
  const { res } = fakeRes();
  let called = false;
  requireEmmyInboundToken(fakeReq("Bearer correct-horse-battery-staple"), res, () => {
    called = true;
  });
  assert.equal(called, true);
});

test("rejects with 401 when the Bearer token doesn't match", () => {
  const { res, state } = fakeRes();
  let called = false;
  requireEmmyInboundToken(fakeReq("Bearer wrong-token"), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(state.status, 401);
  assert.deepEqual(state.body, { error: "unauthorized" });
});

test("rejects with 401 when no Authorization header is present", () => {
  const { res, state } = fakeRes();
  let called = false;
  requireEmmyInboundToken(fakeReq(undefined), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(state.status, 401);
});

test("rejects with 401 when the header isn't a Bearer token", () => {
  const { res, state } = fakeRes();
  let called = false;
  requireEmmyInboundToken(fakeReq("Basic dXNlcjpwYXNz"), res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(state.status, 401);
});
