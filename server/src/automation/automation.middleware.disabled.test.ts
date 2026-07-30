import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request, Response } from "express";

// Separate process/file from automation.middleware.test.ts: here
// AUTOMATION_TOKEN is deliberately left unset (the default, "not
// configured" case) — same pattern as security/cli-helpers.disabled.test.ts.
let tmpCwd: string;
let originalCwd: string;
let requireAutomationToken: typeof import("./automation.middleware.js").requireAutomationToken;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-automation-mw-disabled-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ requireAutomationToken } = await import("./automation.middleware.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("returns 404 (not 401) when AUTOMATION_TOKEN isn't configured, even with a token presented", () => {
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
  const req = { header: () => "Bearer anything" } as unknown as Request;

  let called = false;
  requireAutomationToken(req, res, () => {
    called = true;
  });

  assert.equal(called, false);
  assert.equal(state.status, 404);
  assert.deepEqual(state.body, { error: "not_found" });
});
