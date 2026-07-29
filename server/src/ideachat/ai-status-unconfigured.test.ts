import { test, before } from "node:test";
import assert from "node:assert/strict";

// Separate file/process from ai-status.test.ts, since config.ts freezes
// once per process and this scenario needs both Ollama tiers unconfigured
// (empty model) from the very first import.
let getAiCascadeStatus: typeof import("./ai-status.js").getAiCascadeStatus;

before(async () => {
  process.env.APPS_ROOT = "/tmp/overlay-ai-status-unconfigured-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.CLAUDE_COMMAND = "node";
  process.env.IDEA_CHAT_OLLAMA_RAM_MODEL = "";
  process.env.IDEA_CHAT_OLLAMA_GPU_MODEL = "";

  ({ getAiCascadeStatus } = await import("./ai-status.js"));
});

test("both Ollama tiers report not configured, with no reachability check, when their model is empty", async () => {
  const [ram, gpu, claude] = await getAiCascadeStatus();
  assert.equal(ram.configured, false);
  assert.equal(ram.reachable, undefined);
  assert.equal(gpu.configured, false);
  assert.equal(gpu.reachable, undefined);
  // Claude is unaffected — always configured regardless of the Ollama tiers.
  assert.equal(claude.configured, true);
});
