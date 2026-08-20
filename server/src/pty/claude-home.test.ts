import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ensureProjectClaudeHome reads the shared home from os.homedir() at import
// time, so point HOME at a scratch directory before loading the module.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-home-test-"));
const originalHome = process.env.HOME;
const originalCwd = process.cwd();
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-home-cwd-"));

process.env.HOME = fakeHome;
const originalSharedHome = process.env.CLAUDE_SHARED_HOME;
// Without this, a real CLAUDE_SHARED_HOME set in .env for production would
// leak into this test via config.ts's dotenv load and override the fake
// HOME above, pointing the module at the real login instead of the fixture.
process.env.CLAUDE_SHARED_HOME = path.join(fakeHome, ".claude");
fs.mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".claude", ".credentials.json"), '{"token":"shared"}');
fs.writeFileSync(path.join(fakeHome, ".claude", "settings.json"), '{"model":"opus"}');

const { ensureProjectClaudeHome, hasExistingConversation } = await import("./claude-home.js");

before(() => process.chdir(workdir));
after(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalSharedHome === undefined) delete process.env.CLAUDE_SHARED_HOME;
  else process.env.CLAUDE_SHARED_HOME = originalSharedHome;
  fs.rmSync(fakeHome, { recursive: true, force: true });
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("each project gets its own directory", () => {
  const a = ensureProjectClaudeHome("project-a");
  const b = ensureProjectClaudeHome("project-b");
  assert.notEqual(a, b);
  assert.ok(fs.statSync(a).isDirectory());
  assert.ok(fs.statSync(b).isDirectory());
});

test("credentials are linked to the shared ones, not copied", () => {
  // A copy would go stale the moment the shared token is refreshed, leaving
  // that project logged out for no visible reason.
  const home = ensureProjectClaudeHome("linked");
  const link = path.join(home, ".credentials.json");
  assert.ok(fs.lstatSync(link).isSymbolicLink(), "must be a symlink");
  assert.equal(fs.readFileSync(link, "utf8"), '{"token":"shared"}');
});

test("a refreshed shared credential is visible to an existing project home", () => {
  const home = ensureProjectClaudeHome("refresh");
  fs.writeFileSync(path.join(fakeHome, ".claude", ".credentials.json"), '{"token":"rotated"}');
  assert.equal(fs.readFileSync(path.join(home, ".credentials.json"), "utf8"), '{"token":"rotated"}');
  fs.writeFileSync(path.join(fakeHome, ".claude", ".credentials.json"), '{"token":"shared"}');
});

test("settings are copied so a project can diverge without affecting others", () => {
  const home = ensureProjectClaudeHome("settings");
  const file = path.join(home, "settings.json");
  assert.ok(!fs.lstatSync(file).isSymbolicLink(), "must be a real file, not a link");
  assert.equal(fs.readFileSync(file, "utf8"), '{"model":"opus"}');

  fs.writeFileSync(file, '{"model":"haiku"}');
  ensureProjectClaudeHome("settings");
  assert.equal(fs.readFileSync(file, "utf8"), '{"model":"haiku"}', "an existing settings.json must not be overwritten");
  assert.equal(
    fs.readFileSync(path.join(fakeHome, ".claude", "settings.json"), "utf8"),
    '{"model":"opus"}',
    "the shared settings must be untouched",
  );
});

test("calling it again for the same project is harmless", () => {
  const first = ensureProjectClaudeHome("repeat");
  fs.mkdirSync(path.join(first, "projects"), { recursive: true });
  fs.writeFileSync(path.join(first, "projects", "keep.jsonl"), "transcript");
  const second = ensureProjectClaudeHome("repeat");
  assert.equal(first, second);
  assert.equal(fs.readFileSync(path.join(second, "projects", "keep.jsonl"), "utf8"), "transcript");
});

test("a broken or replaced credential link is repaired", () => {
  const home = ensureProjectClaudeHome("repair");
  fs.rmSync(path.join(home, ".credentials.json"));
  fs.writeFileSync(path.join(home, ".credentials.json"), "stale copy");
  ensureProjectClaudeHome("repair");
  const link = path.join(home, ".credentials.json");
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(link, "utf8"), '{"token":"shared"}');
});

test("project ids that could climb out of the root are refused", () => {
  for (const bad of ["..", ".", "../escape", "a/b", "a\\b", ""]) {
    assert.throws(() => ensureProjectClaudeHome(bad), /suspicious project id/, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("existing transcripts are carried over the first time a project gets its own home", () => {
  // Switching to per-project homes must not read as "all my conversations
  // are gone" — they would still be on disk, just where nothing looks.
  const projectDir = "/opt/apps/carried";
  const key = projectDir.replace(/\//g, "-");
  const shared = path.join(fakeHome, ".claude", "projects", key);
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, "old.jsonl"), "earlier conversation");

  const home = ensureProjectClaudeHome("carried", projectDir);
  assert.equal(fs.readFileSync(path.join(home, "projects", key, "old.jsonl"), "utf8"), "earlier conversation");
  assert.ok(fs.existsSync(path.join(shared, "old.jsonl")), "the shared copy must be left in place");
});

test("carried-over history never overwrites newer conversations", () => {
  const projectDir = "/opt/apps/newer";
  const key = projectDir.replace(/\//g, "-");
  fs.mkdirSync(path.join(fakeHome, ".claude", "projects", key), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".claude", "projects", key, "old.jsonl"), "stale");

  const home = ensureProjectClaudeHome("newer", projectDir);
  fs.writeFileSync(path.join(home, "projects", key, "old.jsonl"), "current");
  ensureProjectClaudeHome("newer", projectDir);
  assert.equal(fs.readFileSync(path.join(home, "projects", key, "old.jsonl"), "utf8"), "current");
});

test("a project with no previous history is fine", () => {
  const home = ensureProjectClaudeHome("fresh", "/opt/apps/never-used");
  assert.ok(fs.statSync(home).isDirectory());
});

test("hasExistingConversation is false for a brand-new project", () => {
  const projectDir = "/opt/apps/brand-new";
  const home = ensureProjectClaudeHome("brand-new", projectDir);
  assert.equal(hasExistingConversation(home, projectDir), false);
});

test("hasExistingConversation is true once a transcript exists", () => {
  const projectDir = "/opt/apps/has-transcript";
  const key = projectDir.replace(/\//g, "-");
  const home = ensureProjectClaudeHome("has-transcript", projectDir);
  fs.mkdirSync(path.join(home, "projects", key), { recursive: true });
  fs.writeFileSync(path.join(home, "projects", key, "session.jsonl"), "conversation");
  assert.equal(hasExistingConversation(home, projectDir), true);
});
