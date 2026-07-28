import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLynisReport } from "./lynis.js";

test("extracts warnings, suggestions, and the hardening index", () => {
  const reportDat = `
# Lynis report
lynis_version=3.1.1
warning[]=SSH-7408|OpenSSH option AllowTcpForwarding is enabled|-|
suggestion[]=KRNL-5788|Determine why swap space is disabled or configure it|-|
hardening_index=68
`;
  const findings = parseLynisReport(reportDat);
  assert.equal(findings.length, 3);

  const warning = findings.find((f) => f.severity === "high");
  assert.ok(warning);
  assert.equal(warning.context, "SSH-7408");
  assert.match(warning.message, /AllowTcpForwarding/);

  const suggestion = findings.find((f) => f.severity === "low");
  assert.ok(suggestion);
  assert.equal(suggestion.context, "KRNL-5788");

  const info = findings.find((f) => f.severity === "info");
  assert.ok(info);
  assert.match(info.message, /68\/100/);
});

test("ignores unrelated keys and comments", () => {
  const reportDat = `
# comment
lynis_version=3.1.1
os_name=Debian
`;
  assert.deepEqual(parseLynisReport(reportDat), []);
});

test("returns an empty array for an empty report", () => {
  assert.deepEqual(parseLynisReport(""), []);
});
