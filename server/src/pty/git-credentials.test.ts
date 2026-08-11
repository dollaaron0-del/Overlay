import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// config.ts is a frozen singleton — set the token before importing anything
// that pulls config.js in, same reasoning as claude-home.test.ts.
const originalToken = process.env.GIT_SANDBOX_PUSH_TOKEN;
process.env.GIT_SANDBOX_PUSH_TOKEN = "test-token";

const { ensureGitCredentialHelper } = await import("./git-credentials.js");

const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-credentials-repo-"));

before(() => {
  execFileSync("git", ["-C", repoDir, "init", "-q"]);
});

after(() => {
  if (originalToken === undefined) delete process.env.GIT_SANDBOX_PUSH_TOKEN;
  else process.env.GIT_SANDBOX_PUSH_TOKEN = originalToken;
  fs.rmSync(repoDir, { recursive: true, force: true });
});

function credentialHelpers(dir: string): string[] {
  try {
    return execFileSync(
      "git",
      ["-C", dir, "config", "--local", "--get-all", "credential.https://github.com.helper"],
      { encoding: "utf8" },
    )
      .trimEnd()
      .split("\n");
  } catch {
    return [];
  }
}

test("configures gh as the credential helper for a git repo", () => {
  ensureGitCredentialHelper(repoDir);
  // The leading empty entry clears any inherited helper chain for this host
  // (the same pair `gh auth setup-git` itself writes) before gh is added.
  assert.deepEqual(credentialHelpers(repoDir), ["", "!gh auth git-credential"]);
});

test("calling it again does not duplicate the entry", () => {
  ensureGitCredentialHelper(repoDir);
  ensureGitCredentialHelper(repoDir);
  assert.deepEqual(credentialHelpers(repoDir), ["", "!gh auth git-credential"]);
});

test("a directory that isn't a git checkout is left alone", () => {
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-credentials-plain-"));
  try {
    assert.doesNotThrow(() => ensureGitCredentialHelper(plainDir));
    assert.ok(!fs.existsSync(path.join(plainDir, ".git")), "must not turn the directory into a git repo");
  } finally {
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});
