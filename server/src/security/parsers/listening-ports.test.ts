import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListeningPorts } from "./listening-ports.js";

const SAMPLE_SS_OUTPUT = `Netid  State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port  Process
tcp    LISTEN  0       128      127.0.0.1:4317       0.0.0.0:*          users:(("node",pid=1234,fd=20))
tcp    LISTEN  0       128      100.64.1.5:4317      0.0.0.0:*          users:(("node",pid=1234,fd=20))
tcp    LISTEN  0       128      0.0.0.0:22           0.0.0.0:*          users:(("sshd",pid=500,fd=3))
tcp    LISTEN  0       128      [::1]:631            [::]:*             users:(("cupsd",pid=600,fd=5))
udp    UNCONN  0       0        0.0.0.0:68           0.0.0.0:*          users:(("dhclient",pid=300,fd=4))
tcp    ESTAB   0       0        127.0.0.1:4317       127.0.0.1:55234
`;

test("allows loopback listeners (both IPv4 and IPv6) regardless of the allowlist", () => {
  const findings = parseListeningPorts(SAMPLE_SS_OUTPUT, ["100.64.1.5"]);
  assert.ok(!findings.some((f) => f.context === "127.0.0.1:4317"));
  assert.ok(!findings.some((f) => f.context === "::1:631"));
});

test("allows an explicitly configured host (e.g. the Tailscale bind address)", () => {
  const findings = parseListeningPorts(SAMPLE_SS_OUTPUT, ["100.64.1.5"]);
  assert.ok(!findings.some((f) => f.context === "100.64.1.5:4317"));
});

test("flags 0.0.0.0 (all-interfaces) listeners as high severity", () => {
  const findings = parseListeningPorts(SAMPLE_SS_OUTPUT, ["100.64.1.5"]);
  const sshFinding = findings.find((f) => f.context === "0.0.0.0:22");
  assert.ok(sshFinding);
  assert.equal(sshFinding.severity, "high");
  assert.match(sshFinding.message, /sshd/);
});

test("flags an unexpected udp listener too", () => {
  const findings = parseListeningPorts(SAMPLE_SS_OUTPUT, ["100.64.1.5"]);
  const dhcpFinding = findings.find((f) => f.context === "0.0.0.0:68");
  assert.ok(dhcpFinding);
  assert.match(dhcpFinding.message, /UDP/);
});

test("only flags the two genuinely unexpected listeners, ignoring ESTAB and loopback/allowed ones", () => {
  const findings = parseListeningPorts(SAMPLE_SS_OUTPUT, ["100.64.1.5"]);
  assert.deepEqual(
    findings.map((f) => f.context).sort(),
    ["0.0.0.0:22", "0.0.0.0:68"],
  );
});

test("returns an empty array when every listener is allowed", () => {
  const output = `Netid  State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port  Process
tcp    LISTEN  0       128      127.0.0.1:4317       0.0.0.0:*          users:(("node",pid=1234,fd=20))
`;
  assert.deepEqual(parseListeningPorts(output, []), []);
});

test("handles an ss line with no process column (non-root run)", () => {
  const output = `Netid  State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port
tcp    LISTEN  0       128      0.0.0.0:80           0.0.0.0:*
`;
  const findings = parseListeningPorts(output, []);
  assert.equal(findings.length, 1);
  assert.doesNotMatch(findings[0].message, /\(/);
});
