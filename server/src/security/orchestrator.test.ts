import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmpCwd: string;
let originalCwd: string;
let orchestrator: typeof import("./orchestrator.js");
let store: typeof import("./report-store.js");
let registry: typeof import("../projects/projects.registry.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-orchestrator-test-"));
  process.chdir(tmpCwd);

  process.env.APPS_ROOT = tmpCwd;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";
  // None of clamscan/rkhunter/chkrootkit/lynis/ss are installed in this
  // sandbox — that's exactly the "tool not installed" path we want to
  // exercise here, alongside a real npm-audit run against a trivial project.
  process.env.LYNIS_REPORT_PATH = path.join(tmpCwd, "lynis-report.dat");

  const projectDir = path.join(tmpCwd, "trivial-app");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "trivial-app", version: "1.0.0" }),
  );

  registry = await import("../projects/projects.registry.js");
  await registry.addProject({
    id: "trivial-app",
    dirName: "trivial-app",
    pm2Name: "trivial-app",
    startScript: "node index.js",
  });

  orchestrator = await import("./orchestrator.js");
  store = await import("./report-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("runScan produces a report with one entry per tool", async () => {
  const report = await orchestrator.runScan();
  const toolNames = report.tools.map((t) => t.tool).sort();
  assert.deepEqual(toolNames, [
    "aide",
    "chkrootkit",
    "clamav",
    "listening-ports",
    "lynis",
    "npm-audit",
    "rkhunter",
    "trivy",
  ]);
});

test("missing native tools are reported as 'skipped', not 'error'", { timeout: 20_000 }, async () => {
  const report = await orchestrator.runScan();
  for (const toolName of ["clamav", "rkhunter", "chkrootkit", "listening-ports", "aide", "trivy"]) {
    const result = report.tools.find((t) => t.tool === toolName);
    assert.ok(result, `expected a result for ${toolName}`);
    assert.equal(result.status, "skipped", `${toolName} should be skipped, not errored, when not installed`);
    assert.match(result.note ?? "", /nicht installiert/);
  }
});

test("lynis is skipped too (binary missing), independent of the report-file read path", async () => {
  const report = await orchestrator.runScan();
  const lynis = report.tools.find((t) => t.tool === "lynis");
  assert.ok(lynis);
  assert.equal(lynis.status, "skipped");
});

test("npm-audit actually runs against a real registered project", { timeout: 30_000 }, async () => {
  const report = await orchestrator.runScan();
  const npmAudit = report.tools.find((t) => t.tool === "npm-audit");
  assert.ok(npmAudit);
  // A trivial package.json with zero dependencies has zero vulnerabilities.
  assert.equal(npmAudit.status, "ok");
  assert.equal(npmAudit.findings.length, 0);
});

test("the report is persisted and retrievable via the report store", async () => {
  const report = await orchestrator.runScan();
  const loaded = await store.getReport(report.id);
  assert.ok(loaded);
  assert.equal(loaded.id, report.id);
  assert.deepEqual(loaded.summary, report.summary);
});

test("summary counts are consistent with the individual tool findings", async () => {
  const report = await orchestrator.runScan();
  const expectedTotal = report.tools.reduce((sum, t) => sum + t.findings.length, 0);
  const summedCounts = Object.values(report.summary).reduce((a, b) => a + b, 0);
  assert.equal(summedCounts, expectedTotal);
});

test("llmTriage is skipped when OLLAMA_MODEL isn't configured, and never affects the summary", async () => {
  const report = await orchestrator.runScan();
  assert.ok(report.llmTriage);
  assert.equal(report.llmTriage.status, "skipped");
  assert.match(report.llmTriage.note ?? "", /nicht konfiguriert/);
  // The severity summary must be computed purely from tools[], regardless
  // of whether/how the LLM stage ran — this is the safety boundary that
  // keeps the LLM advisory-only.
  const expectedTotal = report.tools.reduce((sum, t) => sum + t.findings.length, 0);
  const summedCounts = Object.values(report.summary).reduce((a, b) => a + b, 0);
  assert.equal(summedCounts, expectedTotal);
});
