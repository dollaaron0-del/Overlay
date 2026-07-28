import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAideOutput } from "./aide.js";

test("a clean check (no differences) produces no findings", () => {
  const output = `AIDE, version 0.18.6

AIDE found NO differences between database and filesystem. Looks okay!!
`;
  assert.deepEqual(parseAideOutput(output), []);
});

test("extracts summary counts and individual file entries", () => {
  const output = `AIDE found differences between database and filesystem!!
Start timestamp: 2026-07-29 02:00:00

Summary:
  Total number of entries:    45231
  Added entries:              1
  Removed entries:            0
  Changed entries:            2

---------------------------------------------------
Added entries:
---------------------------------------------------

f++++++++++++++++: /usr/bin/suspicious-new-binary

---------------------------------------------------
Changed entries:
---------------------------------------------------

f   ...    m..    ..  : /etc/passwd
f   ...    m..    ..  : /etc/shadow
`;
  const findings = parseAideOutput(output);

  const summaryFindings = findings.filter((f) => !f.context);
  assert.equal(summaryFindings.length, 2); // Added + Changed summary lines (Removed is 0)
  assert.ok(summaryFindings.some((f) => /1 hinzugefügte/.test(f.message)));
  assert.ok(summaryFindings.some((f) => /2 geänderte/.test(f.message)));

  const fileFindings = findings.filter((f) => f.context);
  assert.equal(fileFindings.length, 3);
  assert.ok(fileFindings.some((f) => f.context === "/usr/bin/suspicious-new-binary"));
  assert.ok(fileFindings.some((f) => f.context === "/etc/passwd"));
  assert.ok(fileFindings.some((f) => f.context === "/etc/shadow"));
  assert.ok(fileFindings.every((f) => f.severity === "high"));
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(parseAideOutput(""), []);
});
