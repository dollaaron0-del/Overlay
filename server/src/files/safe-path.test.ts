import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSafePath, UnsafePathError } from "./safe-path.js";

let tmpRoot: string;
let projectRoot: string;
let outsideDir: string;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-safe-path-test-"));
  projectRoot = path.join(tmpRoot, "project");
  outsideDir = path.join(tmpRoot, "outside");

  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });

  await fs.writeFile(path.join(projectRoot, "src", "index.js"), "console.log('hi');");
  await fs.writeFile(path.join(outsideDir, "secret.txt"), "top secret");

  // A symlink inside the project that points outside of it.
  await fs.symlink(outsideDir, path.join(projectRoot, "escape-link"));
  // A symlink inside the project that stays inside it — must remain allowed.
  await fs.symlink(path.join(projectRoot, "src"), path.join(projectRoot, "src-link"));
});

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("resolves the project root itself for an empty path", async () => {
  const resolved = await resolveSafePath(projectRoot, "");
  assert.equal(resolved, path.resolve(projectRoot));
});

test("resolves a plain nested path within the project", async () => {
  const resolved = await resolveSafePath(projectRoot, "src/index.js");
  assert.equal(resolved, path.join(projectRoot, "src", "index.js"));
});

test("rejects ../ traversal that escapes the project root", async () => {
  await assert.rejects(() => resolveSafePath(projectRoot, "../outside/secret.txt"), UnsafePathError);
});

test("rejects deeply nested ../ traversal", async () => {
  await assert.rejects(
    () => resolveSafePath(projectRoot, "src/../../../../../../etc/passwd"),
    UnsafePathError,
  );
});

test("treats a leading-slash path as relative to the project root (no escape)", async () => {
  // The route layer strips query input into this function; a naive absolute
  // path must not be able to reach outside the project root.
  const resolved = await resolveSafePath(projectRoot, "/etc/passwd");
  assert.equal(resolved, path.join(projectRoot, "etc", "passwd"));
});

test("rejects a symlink inside the project that points outside of it", async () => {
  await assert.rejects(() => resolveSafePath(projectRoot, "escape-link/secret.txt"), UnsafePathError);
});

test("rejects the escaping symlink directory itself, not just files under it", async () => {
  await assert.rejects(() => resolveSafePath(projectRoot, "escape-link"), UnsafePathError);
});

test("allows a symlink that stays inside the project root", async () => {
  const resolved = await resolveSafePath(projectRoot, "src-link/index.js");
  assert.equal(resolved, path.join(projectRoot, "src-link", "index.js"));
});

test("does not throw for a path that simply doesn't exist yet", async () => {
  const resolved = await resolveSafePath(projectRoot, "does/not/exist.txt");
  assert.equal(resolved, path.join(projectRoot, "does", "not", "exist.txt"));
});
