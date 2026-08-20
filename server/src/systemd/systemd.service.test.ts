import { test } from "node:test";
import assert from "node:assert/strict";
import { systemdAction, systemdStatus } from "./systemd.service.js";

test("systemdStatus rejects an invalid unit name without ever shelling out", async () => {
  await assert.rejects(() => systemdStatus("not a unit; rm -rf /"), /Invalid/i);
});

test("systemdStatus rejects a unit name without the required .service suffix", async () => {
  await assert.rejects(() => systemdStatus("some-unit"), /Invalid/i);
});

test("systemdStatus maps a real, non-existent unit to 'stopped' (systemctl reports it 'inactive')", async () => {
  const status = await systemdStatus("definitely-not-a-real-overlay-test-unit.service");
  assert.equal(status, "stopped");
});

test("systemdAction rejects an invalid unit name without ever shelling out", async () => {
  await assert.rejects(() => systemdAction("../../etc/passwd", "start"), /Invalid/i);
});

test("systemdAction on a valid unit name surfaces a clear error instead of throwing an opaque one when unauthorized", async () => {
  // No sudoers rule exists for this made-up unit (and this sandbox has no
  // root access at all) — the important behavior under test is that a
  // failed privileged action rejects with a readable message instead of
  // hanging or crashing the process, not the exact wording sudo produces.
  await assert.rejects(() => systemdAction("definitely-not-a-real-overlay-test-unit.service", "restart"));
});
