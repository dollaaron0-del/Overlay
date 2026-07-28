import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAptUpgradable } from "./apt-updates.js";

// Captured verbatim from a real `apt list --upgradable` run.
const REAL_OUTPUT = `
Listing...
ca-certificates/noble-updates,noble-security 20260601~24.04.1 all [upgradable from: 20240203]
containerd.io/noble 2.2.6-1~ubuntu.24.04~noble amd64 [upgradable from: 2.2.2-1~ubuntu.24.04~noble]
coreutils/noble-updates 9.4-3ubuntu6.2 amd64 [upgradable from: 9.4-3ubuntu6.1]
curl/noble-updates,noble-security 8.5.0-2ubuntu10.11 amd64 [upgradable from: 8.5.0-2ubuntu10.8]
`;

test("parseAptUpgradable flags security-suite packages as high, others as medium", () => {
  const findings = parseAptUpgradable(REAL_OUTPUT);
  assert.equal(findings.length, 4);

  const byPackage = Object.fromEntries(findings.map((f) => [f.context, f]));
  assert.equal(byPackage["ca-certificates"].severity, "high");
  assert.equal(byPackage["curl"].severity, "high");
  assert.equal(byPackage["containerd.io"].severity, "medium");
  assert.equal(byPackage["coreutils"].severity, "medium");

  assert.match(byPackage["curl"].message, /8\.5\.0-2ubuntu10\.8 → 8\.5\.0-2ubuntu10\.11/);
});

test("ignores the leading 'Listing...' line and blank lines", () => {
  assert.deepEqual(parseAptUpgradable("Listing...\n\n"), []);
});

test("returns an empty array when nothing is upgradable", () => {
  assert.deepEqual(parseAptUpgradable("Listing...\n"), []);
});

test("ignores lines that don't match the expected upgradable format", () => {
  assert.deepEqual(parseAptUpgradable("some unrelated garbage\nnot a valid line at all"), []);
});
