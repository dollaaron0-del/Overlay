import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanReport } from "@overlay/shared";
import { emptySeverityCounts } from "@overlay/shared";

let tmpCwd: string;
let originalCwd: string;
let store: typeof import("./report-store.js");

function fakeReport(id: string, overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    id,
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
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-report-store-test-"));
  process.chdir(tmpCwd);
  store = await import("./report-store.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(path.join(tmpCwd, "data", "security-scans"), { recursive: true, force: true });
});

test("makeReportId produces a valid, sortable id", () => {
  const id = store.makeReportId(new Date("2026-07-29T02:00:00.000Z"));
  assert.equal(id, "2026-07-29T02-00-00");
  assert.equal(store.isValidReportId(id), true);
});

test("rejects malformed ids", () => {
  assert.equal(store.isValidReportId("../../etc/passwd"), false);
  assert.equal(store.isValidReportId("not-an-id"), false);
  assert.equal(store.isValidReportId("2026-07-29"), false);
});

test("listReports returns an empty array before any scan has run", async () => {
  assert.deepEqual(await store.listReports(), []);
});

test("getReport / getLatestReport return undefined when nothing exists", async () => {
  assert.equal(await store.getReport(store.makeReportId()), undefined);
  assert.equal(await store.getLatestReport(), undefined);
});

test("saveReport persists a report retrievable by id", async () => {
  const id = store.makeReportId(new Date("2026-07-29T02:00:00.000Z"));
  await store.saveReport(fakeReport(id));
  const loaded = await store.getReport(id);
  assert.ok(loaded);
  assert.equal(loaded.id, id);
});

test("getReport rejects a path-traversal id without touching the filesystem outside the store", async () => {
  assert.equal(await store.getReport("../../../etc/passwd"), undefined);
});

test("saveReport refuses a malformed id", async () => {
  await assert.rejects(() => store.saveReport(fakeReport("not-a-valid-id")));
});

test("listReports sorts newest first", async () => {
  const older = store.makeReportId(new Date("2026-07-28T02:00:00.000Z"));
  const newer = store.makeReportId(new Date("2026-07-29T02:00:00.000Z"));
  await store.saveReport(fakeReport(older));
  await store.saveReport(fakeReport(newer));

  const list = await store.listReports();
  assert.deepEqual(
    list.map((r) => r.id),
    [newer, older],
  );
});

test("getLatestReport returns the most recently saved report", async () => {
  const older = store.makeReportId(new Date("2026-07-01T02:00:00.000Z"));
  const newer = store.makeReportId(new Date("2026-07-02T02:00:00.000Z"));
  await store.saveReport(fakeReport(older));
  await store.saveReport(fakeReport(newer));

  const latest = await store.getLatestReport();
  assert.equal(latest?.id, newer);
});

test("retention prunes older reports beyond the keep count", async () => {
  // Save 35 reports on consecutive days; only the newest 30 should survive.
  for (let i = 0; i < 35; i++) {
    const date = new Date(Date.UTC(2026, 0, i + 1, 2, 0, 0));
    await store.saveReport(fakeReport(store.makeReportId(date)));
  }
  const list = await store.listReports();
  assert.equal(list.length, 30);
  // The 5 oldest (Jan 1-5) should have been pruned; Jan 6 should be the oldest survivor.
  const oldestSurvivor = list[list.length - 1];
  assert.equal(oldestSurvivor.id, store.makeReportId(new Date(Date.UTC(2026, 0, 6, 2, 0, 0))));
});
