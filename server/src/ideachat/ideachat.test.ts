import { test, before } from "node:test";
import assert from "node:assert/strict";

// config.ts is a frozen singleton that exits the process if required env
// vars are missing, and ideachat.ts imports it at module scope even though
// these two pure functions don't touch it — so set fake env vars and import
// dynamically instead of statically at the top of this file.
let buildIdeaChatArgs: typeof import("./ideachat.js").buildIdeaChatArgs;
let parseClaudeResult: typeof import("./ideachat.js").parseClaudeResult;

before(async () => {
  process.env.APPS_ROOT = "/tmp/overlay-ideachat-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  ({ buildIdeaChatArgs, parseClaudeResult } = await import("./ideachat.js"));
});

test("buildIdeaChatArgs assigns a fresh --session-id when there is no prior session", () => {
  const args = buildIdeaChatArgs("Eine Idee", null);
  assert.deepEqual(args.slice(0, 6), ["-p", "Eine Idee", "--output-format", "json", "--tools", "Read,Glob,Grep"]);
  const flagIndex = args.indexOf("--session-id");
  assert.ok(flagIndex !== -1, "expected --session-id in args");
  const uuid = args[flagIndex + 1];
  assert.match(uuid, /^[0-9a-f-]{36}$/);
});

test("buildIdeaChatArgs resumes an existing session instead of starting a new one", () => {
  const args = buildIdeaChatArgs("Und weiter?", "existing-session-id");
  const flagIndex = args.indexOf("--resume");
  assert.ok(flagIndex !== -1, "expected --resume in args");
  assert.equal(args[flagIndex + 1], "existing-session-id");
  assert.equal(args.includes("--session-id"), false);
});

test("parseClaudeResult extracts reply text and session id from a real result shape", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Das klingt sinnvoll, hier ist ein Plan...",
    session_id: "abc-123",
  });
  const parsed = parseClaudeResult(stdout);
  assert.equal(parsed.reply, "Das klingt sinnvoll, hier ist ein Plan...");
  assert.equal(parsed.sessionId, "abc-123");
});

test("parseClaudeResult throws on malformed JSON", () => {
  assert.throws(() => parseClaudeResult("not json"), /non-JSON output/);
});

test("parseClaudeResult throws when the CLI reports an error result", () => {
  const stdout = JSON.stringify({ is_error: true, subtype: "error_max_turns", session_id: "abc-123" });
  assert.throws(() => parseClaudeResult(stdout), /error result/);
});

test("parseClaudeResult throws when session_id is missing", () => {
  const stdout = JSON.stringify({ is_error: false, result: "Text" });
  assert.throws(() => parseClaudeResult(stdout), /missing a session_id/);
});
