import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClamAvOutput } from "./clamav.js";

test("returns no findings for a clean scan", () => {
  const output = `
----------- SCAN SUMMARY -----------
Known viruses: 8697408
Engine version: 0.103.9
Scanned directories: 1234
Scanned files: 5678
Infected files: 0
Time: 45.678 sec (0 m 45 s)
`;
  assert.deepEqual(parseClamAvOutput(output), []);
});

test("extracts one critical finding per infected file", () => {
  const output = `/home/user/apps/app-a/uploads/malware.exe: Win.Test.EICAR_HDB-1 FOUND
/home/user/apps/app-b/tmp/dropper.js: Js.Trojan.Generic FOUND

----------- SCAN SUMMARY -----------
Infected files: 2
`;
  const findings = parseClamAvOutput(output);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[0].context, "/home/user/apps/app-a/uploads/malware.exe");
  assert.match(findings[0].message, /EICAR_HDB-1/);
  assert.equal(findings[1].context, "/home/user/apps/app-b/tmp/dropper.js");
});

test("ignores summary lines that merely mention the word FOUND-like counts", () => {
  const output = `Scanned files: 10\nInfected files: 0\n`;
  assert.deepEqual(parseClamAvOutput(output), []);
});
