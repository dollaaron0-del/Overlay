import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// AUDIT_LOG_PATH is computed once at module-import time from process.cwd()
// (same pattern as backup-status-store.ts) — the module must be imported
// dynamically, after chdir, not statically at the top of this file.
let tmpCwd: string;
let originalCwd: string;
let appendAuditEntry: typeof import("./audit-log.js").appendAuditEntry;
let listAuditEntries: typeof import("./audit-log.js").listAuditEntries;

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-audit-log-test-"));
  process.chdir(tmpCwd);
  ({ appendAuditEntry, listAuditEntries } = await import("./audit-log.js"));
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("returns an empty list before anything has been logged", async () => {
  assert.deepEqual(await listAuditEntries(), []);
});

test("appended entries are retrievable, newest first", async () => {
  await appendAuditEntry({ type: "login", actor: "admin" });
  await appendAuditEntry({ type: "project_added", detail: "my-app" });

  const entries = await listAuditEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, "project_added");
  assert.equal(entries[0].detail, "my-app");
  assert.equal(entries[1].type, "login");
  assert.equal(entries[1].actor, "admin");
  assert.ok(entries[0].timestamp);
});

test("skips malformed lines instead of losing the whole log", async () => {
  const logPath = path.join(tmpCwd, "data", "audit.jsonl");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, '{"timestamp":"2026-01-01T00:00:00.000Z","type":"login"}\nnot json\n', "utf8");

  const entries = await listAuditEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "login");
});

test("retention trims to the most recent MAX_ENTRIES", async () => {
  for (let i = 0; i < 2010; i++) {
    await appendAuditEntry({ type: "logout" });
  }
  const entries = await listAuditEntries();
  assert.equal(entries.length, 2000);
});
