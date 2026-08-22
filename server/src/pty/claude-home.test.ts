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

const { ensureProjectClaudeHome, hasExistingConversation, syncClaudeCredentials } = await import("./claude-home.js");

const sharedFile = path.join(fakeHome, ".claude", ".credentials.json");

/** Writes a credentials file in the real claudeAiOauth shape. */
function writeCredential(file: string, oauth: Record<string, unknown>): void {
  fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: "a", refreshToken: "r", ...oauth } }));
}

function writeShared(oauth: Record<string, unknown>): void {
  writeCredential(sharedFile, oauth);
}

function readOauth(file: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(file, "utf8")).claudeAiOauth;
}

/** Back to the plain fixture the shape-agnostic tests expect. */
function resetShared(): void {
  fs.writeFileSync(sharedFile, '{"token":"shared"}');
}

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

test("credentials are copied into the project as a real file, never a symlink", () => {
  // A symlink is what broke this before: Claude Code refreshes its token by
  // renaming a new file over .credentials.json, and a rename replaces the
  // link instead of following it. The shared login then never saw another
  // refresh, and the next session start deleted the only valid token to
  // restore the link.
  const home = ensureProjectClaudeHome("linked");
  const file = path.join(home, ".credentials.json");
  assert.ok(!fs.lstatSync(file).isSymbolicLink(), "must be a real file, not a symlink");
  assert.equal(fs.readFileSync(file, "utf8"), '{"token":"shared"}');
});

test("a symlink left over from the previous scheme is replaced by a real file", () => {
  const home = ensureProjectClaudeHome("legacy-link");
  const file = path.join(home, ".credentials.json");
  fs.rmSync(file);
  fs.symlinkSync(path.join(fakeHome, ".claude", ".credentials.json"), file);

  ensureProjectClaudeHome("legacy-link");
  assert.ok(!fs.lstatSync(file).isSymbolicLink(), "the old link must not survive an upgrade");
  assert.equal(fs.readFileSync(file, "utf8"), '{"token":"shared"}');
});

test("a refreshed shared credential reaches an existing project home", () => {
  const home = ensureProjectClaudeHome("refresh");
  writeShared({ refreshToken: "rotated", expiresAt: 5_000 });
  ensureProjectClaudeHome("refresh");
  assert.equal(readOauth(path.join(home, ".credentials.json")).refreshToken, "rotated");
  resetShared();
});

test("a token refreshed inside a project is carried back to the shared login", () => {
  // The direction that was missing entirely before: without it, a project
  // that refreshes holds the only working token and every other project
  // keeps starting from an older one — which no longer works, because
  // refresh tokens rotate on use.
  const home = ensureProjectClaudeHome("carries-back");
  writeCredential(path.join(home, ".credentials.json"), { refreshToken: "refreshed-inside", expiresAt: 9_000 });

  syncClaudeCredentials(home);
  assert.equal(readOauth(sharedFile).refreshToken, "refreshed-inside");
  resetShared();
});

test("an emptied credentials file never wins over a real login", () => {
  // Exactly the state the live shared file was found in: valid JSON, right
  // shape, but the tokens blanked to "" by a failed refresh. Treating that
  // as newer would log every project out.
  const home = ensureProjectClaudeHome("emptied");
  writeCredential(path.join(home, ".credentials.json"), { refreshToken: "still-valid", expiresAt: 4_000 });
  syncClaudeCredentials(home);

  // The blanked file is written last, so it is also the newest by mtime.
  writeShared({ refreshToken: "", accessToken: "", expiresAt: 0 });
  syncClaudeCredentials(home);

  assert.equal(readOauth(path.join(home, ".credentials.json")).refreshToken, "still-valid", "the project keeps its login");
  assert.equal(readOauth(sharedFile).refreshToken, "still-valid", "and repairs the shared one");
  resetShared();
});

test("the later-expiring token wins regardless of which side it is on", () => {
  const home = ensureProjectClaudeHome("newest-wins");
  writeCredential(path.join(home, ".credentials.json"), { refreshToken: "older", expiresAt: 1_000 });
  writeShared({ refreshToken: "newer", expiresAt: 8_000 });

  syncClaudeCredentials(home);
  assert.equal(readOauth(path.join(home, ".credentials.json")).refreshToken, "newer");
  resetShared();
});

test("a project with no login yet is left alone when nothing is shared either", () => {
  fs.rmSync(sharedFile);
  const home = ensureProjectClaudeHome("nothing-anywhere");
  assert.ok(!fs.existsSync(path.join(home, ".credentials.json")), "must not invent an empty credentials file");
  resetShared();
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

test("an unparseable credentials file is replaced from the shared login", () => {
  const home = ensureProjectClaudeHome("repair");
  const file = path.join(home, ".credentials.json");
  fs.writeFileSync(file, "not json at all");
  // An unreadable file carries no expiry, so the shared login's real one
  // outranks it — otherwise a corrupted file would keep the project logged
  // out even though a good token exists.
  writeShared({ refreshToken: "usable", expiresAt: 7_000 });

  ensureProjectClaudeHome("repair");
  assert.equal(readOauth(file).refreshToken, "usable");
  resetShared();
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
