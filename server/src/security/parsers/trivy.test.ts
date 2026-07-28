import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrivyOutput } from "./trivy.js";

function trivyJson(vulns: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    Results: [{ Target: "debian 12 (bookworm)", Vulnerabilities: vulns }],
  });
}

test("returns no findings when there are no vulnerabilities", () => {
  assert.deepEqual(parseTrivyOutput(trivyJson([])), []);
});

test("maps each severity to our scale", () => {
  const json = trivyJson([
    { VulnerabilityID: "CVE-1", PkgName: "openssl", InstalledVersion: "1.1.1", Severity: "CRITICAL" },
    { VulnerabilityID: "CVE-2", PkgName: "curl", InstalledVersion: "7.0", Severity: "HIGH", FixedVersion: "7.1" },
    { VulnerabilityID: "CVE-3", PkgName: "libfoo", InstalledVersion: "2.0", Severity: "MEDIUM" },
    { VulnerabilityID: "CVE-4", PkgName: "libbar", InstalledVersion: "3.0", Severity: "LOW" },
    { VulnerabilityID: "CVE-5", PkgName: "libbaz", InstalledVersion: "4.0", Severity: "UNKNOWN" },
  ]);
  const findings = parseTrivyOutput(json);
  assert.equal(findings.length, 5);
  assert.deepEqual(
    findings.map((f) => f.severity),
    ["critical", "high", "medium", "low", "info"],
  );
  assert.match(findings[0].message, /openssl 1\.1\.1: CVE-1/);
  assert.match(findings[1].message, /Fix: 7\.1/);
  assert.match(findings[0].message, /kein Fix verfügbar/);
});

test("includes the scan target as context", () => {
  const json = trivyJson([{ VulnerabilityID: "CVE-1", PkgName: "openssl", InstalledVersion: "1.1.1", Severity: "HIGH" }]);
  const findings = parseTrivyOutput(json);
  assert.equal(findings[0].context, "debian 12 (bookworm)");
});

test("returns no findings when Results is missing entirely", () => {
  assert.deepEqual(parseTrivyOutput("{}"), []);
});

test("returns no findings for malformed JSON instead of throwing", () => {
  assert.deepEqual(parseTrivyOutput("not json"), []);
});

test("handles multiple Results entries", () => {
  const json = JSON.stringify({
    Results: [
      { Target: "a", Vulnerabilities: [{ VulnerabilityID: "CVE-1", PkgName: "x", InstalledVersion: "1", Severity: "HIGH" }] },
      { Target: "b", Vulnerabilities: [{ VulnerabilityID: "CVE-2", PkgName: "y", InstalledVersion: "1", Severity: "LOW" }] },
    ],
  });
  const findings = parseTrivyOutput(json);
  assert.equal(findings.length, 2);
});
