import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanReport } from "@overlay/shared";
import { emptySeverityCounts } from "@overlay/shared";

// Separate file (own process) since config.ts (and therefore NTFY_URL) is a
// frozen singleton per process — needs to be set before cli-helpers.js (and
// transitively config.js) is first imported here.
let tmpCwd: string;
let originalCwd: string;
let mockServer: http.Server;
let received: { title: string; priority: string; body: string } | null;
let helpers: typeof import("./cli-helpers.js");

function fakeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    id: "2026-07-29T02-00-00",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: 12,
    tools: [],
    summary: emptySeverityCounts(),
    ...overrides,
  };
}

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-cli-helpers-test-"));
  process.chdir(tmpCwd);

  mockServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received = {
        title: decodeURIComponent(req.headers["title"] as string),
        priority: req.headers["priority"] as string,
        body,
      };
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  process.env.NTFY_URL = `http://127.0.0.1:${address.port}/test-topic`;

  helpers = await import("./cli-helpers.js");
});

after(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("formatSummaryLine includes all severity counts and skipped tools", () => {
  const report = fakeReport({
    summary: { critical: 1, high: 2, medium: 0, low: 3, info: 0 },
    tools: [{ tool: "clamav", status: "skipped", findings: [], durationMs: 1 }],
  });
  const line = helpers.formatSummaryLine(report);
  assert.match(line, /critical=1/);
  assert.match(line, /high=2/);
  assert.match(line, /low=3/);
  assert.match(line, /skipped=\[clamav\]/);
});

test("does not send a notification when there are no critical/high findings", async () => {
  received = null;
  await helpers.notifyIfConfigured(fakeReport({ summary: { critical: 0, high: 0, medium: 5, low: 5, info: 5 } }));
  assert.equal(received, null);
});

test("sends an 'urgent' priority notification when there are critical findings", async () => {
  received = null;
  await helpers.notifyIfConfigured(
    fakeReport({ summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 } }),
  );
  assert.ok(received);
  assert.equal(received.priority, "urgent");
  assert.match(received.title, /1 kritisch/);
});

test("sends a 'high' priority notification when there are only high findings (no critical)", async () => {
  received = null;
  await helpers.notifyIfConfigured(
    fakeReport({ summary: { critical: 0, high: 2, medium: 0, low: 0, info: 0 } }),
  );
  assert.ok(received);
  assert.equal(received.priority, "high");
});

test("uses the LLM triage text as the message body when available", async () => {
  received = null;
  await helpers.notifyIfConfigured(
    fakeReport({
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      llmTriage: { status: "ok", model: "llama3.1", text: "Ein Testfund verdient Aufmerksamkeit.", durationMs: 1 },
    }),
  );
  assert.equal(received?.body, "Ein Testfund verdient Aufmerksamkeit.");
});

test("falls back to the summary line when the LLM triage isn't available", async () => {
  received = null;
  await helpers.notifyIfConfigured(fakeReport({ summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 } }));
  assert.match(received?.body ?? "", /critical=1/);
});
