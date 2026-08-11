import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Companion to git-credentials.test.ts, in its own file for the same reason
// as emmy-memory-unconfigured.test.ts: config.ts freezes GIT_SANDBOX_PUSH_TOKEN
// at import time, so the "feature is off" case needs a process where it was
// never set, not a toggle mid-file.
const originalToken = process.env.GIT_SANDBOX_PUSH_TOKEN;
delete process.env.GIT_SANDBOX_PUSH_TOKEN;

const { ensureGitCredentialHelper } = await import("./git-credentials.js");

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-credentials-unconfigured-"));

after(() => {
  if (originalToken !== undefined) process.env.GIT_SANDBOX_PUSH_TOKEN = originalToken;
  fs.rmSync(repoDir, { recursive: true, force: true });
});

test("a git repo is left untouched when no token is configured", () => {
  execFileSync("git", ["-C", repoDir, "init", "-q"]);
  ensureGitCredentialHelper(repoDir);
  assert.throws(
    () =>
      execFileSync("git", ["-C", repoDir, "config", "--local", "--get-all", "credential.https://github.com.helper"], {
        stdio: "pipe",
      }),
    /./,
    "no credential.helper entry should have been written",
  );
});
