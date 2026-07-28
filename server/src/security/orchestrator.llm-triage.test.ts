import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolResult } from "@overlay/shared";

// Separate file (own process, per node:test's default file isolation) since
// config.ts is a frozen singleton per process — OLLAMA_MODEL/OLLAMA_BASE_URL
// need to be set before orchestrator.js is first imported here, independent
// of orchestrator.test.ts's "not configured" scenario.
let tmpCwd: string;
let originalCwd: string;
let mockServer: http.Server;
let receivedPrompt = "";
let orchestrator: typeof import("./orchestrator.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-llm-triage-test-"));
  process.chdir(tmpCwd);

  mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      receivedPrompt = JSON.parse(body).prompt;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "Testeinschätzung: ein kritischer Fund verdient sofortige Prüfung." }));
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.OLLAMA_MODEL = "test-model";
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}`;

  orchestrator = await import("./orchestrator.js");
});

after(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("calls the configured Ollama model and returns its response when there are findings", async () => {
  const tools: ToolResult[] = [
    { tool: "clamav", status: "findings", findings: [{ severity: "critical", message: "Malware gefunden: EICAR", context: "/tmp/x" }], durationMs: 1 },
  ];
  const triage = await orchestrator.runLlmTriageStage(tools);
  assert.equal(triage.status, "ok");
  assert.equal(triage.model, "test-model");
  assert.match(triage.text ?? "", /sofortige Prüfung/);
  assert.match(receivedPrompt, /\[clamav\] \[critical\] Malware gefunden: EICAR/);
});

test("skips the Ollama call entirely (and reports 'ok' with a canned message) when there are zero findings", async () => {
  const tools: ToolResult[] = [{ tool: "clamav", status: "ok", findings: [], durationMs: 1 }];
  receivedPrompt = "";
  const triage = await orchestrator.runLlmTriageStage(tools);
  assert.equal(triage.status, "ok");
  assert.match(triage.text ?? "", /[Kk]eine Funde/);
  assert.equal(receivedPrompt, ""); // confirms no network call was made
});
