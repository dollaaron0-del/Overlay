import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRkhunterOutput } from "./rkhunter.js";

test("no findings when rkhunter prints nothing (clean system)", () => {
  assert.deepEqual(parseRkhunterOutput(""), []);
});

test("extracts one high finding per Warning line", () => {
  const output = `
Warning: The SSH configuration option 'PermitRootLogin' has not been set to 'no'
Warning: The file '/usr/bin/egrep' has been replaced by a script
Info: Some non-warning informational line should be ignored
`;
  const findings = parseRkhunterOutput(output);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "high");
  assert.match(findings[0].message, /PermitRootLogin/);
  assert.match(findings[1].message, /egrep/);
});
