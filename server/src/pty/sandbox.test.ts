import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandboxCommand, SandboxUnavailableError } from "./sandbox.js";

const target = {
  projectDir: "/opt/apps/alpha",
  claudeHome: "/opt/overlay/data/claude-homes/alpha",
  appsRoot: "/opt/apps",
  serverDir: "/opt/overlay",
};

/** Index of the argument that starts an operation on `path`, or -1. */
function indexOfMount(args: string[], op: string, target: string): number {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === op && args[i + 1] === target) return i;
  }
  return -1;
}

test("the command is bwrap, with the real command handed over after --", () => {
  const { command, args } = buildSandboxCommand("claude", ["--foo"], target, "/usr/bin/bwrap");
  assert.equal(command, "/usr/bin/bwrap");
  const separator = args.indexOf("--");
  assert.ok(separator > 0, "a -- separator is required");
  assert.deepEqual(args.slice(separator + 1), ["claude", "--foo"]);
});

test("the projects root, the installation and /home are all hidden", () => {
  const { args } = buildSandboxCommand("claude", [], target, "/usr/bin/bwrap");
  for (const hidden of ["/opt/apps", "/opt/overlay", "/home"]) {
    assert.ok(indexOfMount(args, "--tmpfs", hidden) >= 0, `${hidden} must be covered by a tmpfs`);
  }
});

test("the project and its Claude home are re-exposed AFTER the tmpfs that hides them", () => {
  // Order is the whole trick: bubblewrap applies arguments in sequence and a
  // later mount wins. Binding before the tmpfs silently produces an empty
  // directory — which is exactly how the first hand-written attempt failed.
  const { args } = buildSandboxCommand("claude", [], target, "/usr/bin/bwrap");

  const appsHidden = indexOfMount(args, "--tmpfs", "/opt/apps");
  const projectBound = indexOfMount(args, "--bind", "/opt/apps/alpha");
  assert.ok(projectBound > appsHidden, "the project must be bound after its root is hidden");

  const serverHidden = indexOfMount(args, "--tmpfs", "/opt/overlay");
  const homeBound = indexOfMount(args, "--bind", "/opt/overlay/data/claude-homes/alpha");
  assert.ok(homeBound > serverHidden, "the Claude home lives under the installation and must be bound after it");
});

test("a project that lives under /home is still bound after /home is hidden", () => {
  const { args } = buildSandboxCommand("claude", [], { ...target, projectDir: "/home/aaron/Aktien1" }, "/usr/bin/bwrap");
  const homeHidden = indexOfMount(args, "--tmpfs", "/home");
  const projectBound = indexOfMount(args, "--bind", "/home/aaron/Aktien1");
  assert.ok(homeHidden >= 0 && projectBound > homeHidden);
});

test("the shared Claude login is re-bound read-only after /home is hidden", () => {
  const { args } = buildSandboxCommand("claude", [], { ...target, sharedClaudeHome: "/home/aaron/.claude" }, "/usr/bin/bwrap");
  const homeHidden = indexOfMount(args, "--tmpfs", "/home");
  const sharedBound = indexOfMount(args, "--ro-bind-try", "/home/aaron/.claude");
  assert.ok(homeHidden >= 0 && sharedBound > homeHidden);
});

test("no shared Claude login is bound when none is configured", () => {
  const { args } = buildSandboxCommand("claude", [], target, "/usr/bin/bwrap");
  assert.equal(indexOfMount(args, "--ro-bind-try", "/home/aaron/.claude"), -1);
});

test("the session starts in the project directory", () => {
  const { args } = buildSandboxCommand("claude", [], target, "/usr/bin/bwrap");
  assert.equal(args[indexOfMount(args, "--chdir", "/opt/apps/alpha") + 1], "/opt/apps/alpha");
});

test("the network is kept while every other namespace is dropped", () => {
  const { args } = buildSandboxCommand("claude", [], target, "/usr/bin/bwrap");
  assert.ok(args.includes("--unshare-all"));
  assert.ok(args.includes("--share-net"), "the session has to reach the API");
  assert.ok(args.includes("--die-with-parent"), "closing the pty must not leave the sandbox running");
});

test("a missing bubblewrap fails loudly instead of silently running unsandboxed", () => {
  assert.throws(
    () => buildSandboxCommand("claude", [], target, "/nonexistent/bwrap"),
    (err: unknown) => err instanceof SandboxUnavailableError && /bubblewrap/.test((err as Error).message),
  );
});
