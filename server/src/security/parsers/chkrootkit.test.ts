import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChkrootkitOutput } from "./chkrootkit.js";

test("a clean run produces no findings", () => {
  const output = `
Checking \`amd'... not found
Checking \`bindshell'... not infected
Checking \`lkm'... nothing found
Checking \`rexedcs'... not found
`;
  assert.deepEqual(parseChkrootkitOutput(output), []);
});

test("flags an actual infected result as critical", () => {
  const output = `Checking \`lkm'... you are infected! affects rk#7\n`;
  const findings = parseChkrootkitOutput(output);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.match(findings[0].message, /infected/i);
});

test("does not misfire on a 'not infected' clean result", () => {
  const output = `Checking \`bindshell'... not infected\n`;
  assert.deepEqual(parseChkrootkitOutput(output), []);
});

test("flags a Warning line as medium", () => {
  const output = `Warning: /usr/sbin/xyz is not linked against libc\n`;
  const findings = parseChkrootkitOutput(output);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
});
