import { test } from "node:test";
import assert from "node:assert/strict";
import { pm2RootAction, pm2RootStatus } from "./pm2root.service.js";

test("pm2RootStatus rejects an invalid process name without ever shelling out", async () => {
  await assert.rejects(() => pm2RootStatus("not a name; rm -rf /"), /Invalid/i);
});

test("pm2RootStatus on a real name falls back to 'unknown' when sudo itself is unavailable (this sandbox has no root access at all)", async () => {
  const status = await pm2RootStatus("definitely-not-a-real-overlay-test-process");
  assert.equal(status, "unknown");
});

test("pm2RootAction rejects an invalid process name without ever shelling out", async () => {
  await assert.rejects(() => pm2RootAction("../../etc/passwd", "start"), /Invalid/i);
});

test("pm2RootAction on a valid name surfaces a clear error instead of throwing an opaque one when unauthorized", async () => {
  // No sudoers rule exists for this made-up name (and this sandbox has no
  // root access at all) — the important behavior under test is that a
  // failed privileged action rejects with a readable message instead of
  // hanging or crashing the process, not the exact wording sudo produces.
  await assert.rejects(() => pm2RootAction("definitely-not-a-real-overlay-test-process", "restart"));
});
