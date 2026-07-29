import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { runDeployScript } from "./deploy-runner.js";

test("captures full stdout/stderr and exit code, same shape as before", async () => {
  const result = await runDeployScript('echo "hello"; echo "oops" 1>&2; exit 0', os.tmpdir(), 5000);
  assert.equal(result.stdout.trim(), "hello");
  assert.equal(result.stderr.trim(), "oops");
  assert.equal(result.exitCode, 0);
});

test("reports a non-zero exit code without throwing", async () => {
  const result = await runDeployScript("exit 7", os.tmpdir(), 5000);
  assert.equal(result.exitCode, 7);
});

test("onLine is called live, once per complete line, tagged with the right stream", async () => {
  const lines: Array<{ stream: string; text: string }> = [];
  await runDeployScript('echo "line1"; echo "line2"; echo "err1" 1>&2', os.tmpdir(), 5000, (line) => lines.push(line));

  const out = lines.filter((l) => l.stream === "out").map((l) => l.text);
  const err = lines.filter((l) => l.stream === "err").map((l) => l.text);
  assert.deepEqual(out, ["line1", "line2"]);
  assert.deepEqual(err, ["err1"]);
});

test("onLine flushes a final line even without a trailing newline", async () => {
  const lines: Array<{ stream: string; text: string }> = [];
  await runDeployScript('printf "no newline at the end"', os.tmpdir(), 5000, (line) => lines.push(line));
  assert.deepEqual(lines, [{ stream: "out", text: "no newline at the end" }]);
});

test("rejects when the timeout is exceeded", async () => {
  await assert.rejects(() => runDeployScript("sleep 5", os.tmpdir(), 200), /timed out/);
});

test("runs relative to the given cwd", async () => {
  const result = await runDeployScript("pwd", os.tmpdir(), 5000);
  // Resolve any symlinks (macOS/BSD tmpdir sometimes differs by a /private prefix) — not relevant in this sandbox, but keep the check meaningful either way.
  assert.ok(result.stdout.trim().endsWith(os.tmpdir().replace(/\/$/, "")));
});
