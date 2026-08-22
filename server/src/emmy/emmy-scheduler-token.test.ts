import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSchedulerToken, SCHEDULER_TOKEN_FILE } from "./emmy-scheduler-token.js";

let tmpDir: string;

before(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "overlay-scheduler-token-test-"));
});

after(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

function freshFile(name: string): string {
  return path.join(tmpDir, name, "emmy-scheduler-token");
}

test("generates a token on first call and creates the parent directory", () => {
  const file = freshFile("first-call");
  const token = getSchedulerToken(file);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(file, "utf8"), token);
});

test("returns the same token on subsequent calls instead of rotating it", () => {
  const file = freshFile("stable");
  const first = getSchedulerToken(file);
  const second = getSchedulerToken(file);
  assert.equal(second, first);
});

test("writes the token file 0600 so only the service user can read it", () => {
  const file = freshFile("perms");
  getSchedulerToken(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("regenerates when the existing file is empty rather than returning an empty token", () => {
  const file = freshFile("empty");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "   \n");
  assert.match(getSchedulerToken(file), /^[0-9a-f]{64}$/);
});

test("ignores trailing whitespace so a hand-edited file still authenticates", () => {
  const file = freshFile("whitespace");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "deadbeef\n");
  assert.equal(getSchedulerToken(file), "deadbeef");
});

// The server (PM2, cwd = repo root) and the CLI (systemd,
// WorkingDirectory=<repo>/server) must resolve the same file, so the default
// path has to come from the module's location rather than process.cwd().
test("default token path is repo-root/data, independent of the current directory", () => {
  const originalCwd = process.cwd();
  const expected = SCHEDULER_TOKEN_FILE;
  try {
    process.chdir(os.tmpdir());
    assert.equal(SCHEDULER_TOKEN_FILE, expected);
    assert.equal(path.basename(path.dirname(SCHEDULER_TOKEN_FILE)), "data");
    // …and that data/ sits beside server/, not inside it.
    assert.equal(fs.existsSync(path.join(path.dirname(path.dirname(SCHEDULER_TOKEN_FILE)), "server")), true);
  } finally {
    process.chdir(originalCwd);
  }
});
