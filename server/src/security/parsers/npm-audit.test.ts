import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNpmAuditOutput } from "./npm-audit.js";

test("returns no findings when there are zero vulnerabilities of every severity", () => {
  const json = JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
  });
  assert.deepEqual(parseNpmAuditOutput(json, "app-a"), []);
});

test("emits one finding per non-zero severity bucket, labelled with the project", () => {
  const json = JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 2, moderate: 0, high: 1, critical: 0 } },
  });
  const findings = parseNpmAuditOutput(json, "second-brain");
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.context === "second-brain"));
  assert.ok(findings.some((f) => f.severity === "high" && /1 hohe/.test(f.message)));
  assert.ok(findings.some((f) => f.severity === "low" && /2 niedrige/.test(f.message)));
});

test("singular wording for a count of exactly one", () => {
  const json = JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1 } },
  });
  const findings = parseNpmAuditOutput(json, "app-a");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /1 kritische npm-Schwachstelle$/);
});

test("returns no findings for malformed/non-JSON output instead of throwing", () => {
  assert.deepEqual(parseNpmAuditOutput("not json at all", "app-a"), []);
});

test("returns no findings when metadata is missing entirely", () => {
  assert.deepEqual(parseNpmAuditOutput("{}", "app-a"), []);
});
