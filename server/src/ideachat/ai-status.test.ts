import { test, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// config.ts is a frozen singleton, fixed for this file's whole process —
// import dynamically after setting env vars, same pattern as the other
// ideachat tests. Scenarios needing a *different* config value live in
// separate test files (ai-status-unconfigured.test.ts,
// ai-status-claude-missing.test.ts) since env can't be changed mid-file.
//
// getAiCascadeStatus() is called exactly once here (not per test): the
// deliberately-unreachable GPU tier below eats its full 5s timeout on every
// call, and this file's job is to check the shape of one real result, not
// re-verify the timeout mechanics repeatedly.
let status: import("./ai-status.js").AiTierStatus[];

before(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "llama3.1:latest" }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  const mockOllamaUrl = `http://127.0.0.1:${address.port}`;

  process.env.APPS_ROOT = "/tmp/overlay-ai-status-test-apps-root";
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  // "node --version" always succeeds, standing in for a real `claude` CLI check.
  process.env.CLAUDE_COMMAND = "node";
  process.env.IDEA_CHAT_OLLAMA_RAM_URL = mockOllamaUrl;
  process.env.IDEA_CHAT_OLLAMA_RAM_MODEL = "llama3.1";
  process.env.IDEA_CHAT_OLLAMA_GPU_URL = "http://127.0.0.1:1"; // nothing listening — always unreachable
  process.env.IDEA_CHAT_OLLAMA_GPU_MODEL = "mixtral";

  const { getAiCascadeStatus } = await import("./ai-status.js");
  status = await getAiCascadeStatus();
  server.close();
});

test("reports the cascade in RAM -> GPU -> Claude order", () => {
  assert.deepEqual(
    status.map((s) => s.id),
    ["ollama-ram", "ollama-gpu", "claude"],
  );
});

test("RAM tier: configured, reachable, model installed", () => {
  const [ram] = status;
  assert.equal(ram.configured, true);
  assert.equal(ram.reachable, true);
  assert.equal(ram.model, "llama3.1");
  assert.equal(ram.modelInstalled, true);
});

test("GPU tier: configured but unreachable, since nothing is listening", () => {
  const [, gpu] = status;
  assert.equal(gpu.configured, true);
  assert.equal(gpu.reachable, false);
  assert.ok(gpu.error);
});

test("Claude tier: always configured, reachable when the configured command works", () => {
  const [, , claude] = status;
  assert.equal(claude.configured, true);
  assert.equal(claude.reachable, true);
  assert.ok(claude.role.length > 0);
});
