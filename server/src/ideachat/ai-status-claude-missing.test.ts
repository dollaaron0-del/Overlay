import { test, before } from "node:test";
import assert from "node:assert/strict";

// Separate file/process from ai-status.test.ts — needs CLAUDE_COMMAND set
// to a nonexistent binary from the very first import.
let getAiCascadeStatus: typeof import("./ai-status.js").getAiCascadeStatus;

before(async () => {
  process.env.APPS_ROOT = "/tmp/overlay-ai-status-claude-missing-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.CLAUDE_COMMAND = "this-binary-does-not-exist-12345";
  process.env.IDEA_CHAT_OLLAMA_RAM_MODEL = "";
  process.env.IDEA_CHAT_OLLAMA_GPU_MODEL = "";

  ({ getAiCascadeStatus } = await import("./ai-status.js"));
});

test("Claude tier reports unreachable when the configured command doesn't exist", async () => {
  const [, , claude] = await getAiCascadeStatus();
  assert.equal(claude.configured, true);
  assert.equal(claude.reachable, false);
  assert.ok(claude.error);
});
