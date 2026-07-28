import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "./run-tool.js";

test("resolves normally for a successful command", async () => {
  const result = await runCommand("node", ["-e", "console.log('hello')"], { timeoutMs: 5000 });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello/);
});

test("resolves (does not reject) for a non-zero exit code — that's a meaningful result, not a failure", async () => {
  const result = await runCommand("node", ["-e", "console.log('found something'); process.exit(2)"], {
    timeoutMs: 5000,
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stdout, /found something/);
});

test("rejects when the binary doesn't exist", async () => {
  await assert.rejects(() =>
    runCommand("definitely-not-a-real-binary-xyz", [], { timeoutMs: 5000 }),
  );
});

test("rejects when the command times out", async () => {
  await assert.rejects(() => runCommand("node", ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 200 }));
});

test("captures stderr separately from stdout", async () => {
  const result = await runCommand(
    "node",
    ["-e", "console.log('on stdout'); console.error('on stderr')"],
    { timeoutMs: 5000 },
  );
  assert.match(result.stdout, /on stdout/);
  assert.match(result.stderr, /on stderr/);
});

test("passes cwd through to the spawned process", async () => {
  const result = await runCommand("node", ["-e", "console.log(process.cwd())"], {
    timeoutMs: 5000,
    cwd: "/tmp",
  });
  assert.equal(result.stdout.trim(), "/tmp");
});

test("merges extra env vars on top of the existing environment", async () => {
  const result = await runCommand("node", ["-e", "console.log(process.env.OVERLAY_TEST_VAR)"], {
    timeoutMs: 5000,
    env: { OVERLAY_TEST_VAR: "hello-env" },
  });
  assert.equal(result.stdout.trim(), "hello-env");
});

test("still inherits the parent process environment when passing extra env vars", async () => {
  const result = await runCommand("node", ["-e", "console.log(typeof process.env.PATH)"], {
    timeoutMs: 5000,
    env: { OVERLAY_TEST_VAR: "hello-env" },
  });
  assert.equal(result.stdout.trim(), "string");
});
