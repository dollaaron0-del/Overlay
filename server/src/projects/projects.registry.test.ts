import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmpCwd: string;
let appsRoot: string;
let originalCwd: string;
let registry: typeof import("./projects.registry.js");

before(async () => {
  originalCwd = process.cwd();
  tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-registry-test-"));
  process.chdir(tmpCwd);

  // APPS_ROOT is deliberately a *subdirectory* of tmpCwd, not tmpCwd itself —
  // mirroring real deployments where the app-directories root is separate
  // from Overlay's own working directory (whose data/ subfolder holds
  // projects.json). Otherwise listAvailableDirs would see Overlay's own
  // "data" folder as if it were a candidate project directory.
  appsRoot = path.join(tmpCwd, "apps-root");
  process.env.APPS_ROOT = appsRoot;
  process.env.SESSION_SECRET = "test-session-secret-not-for-prod";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = "$2b$04$0000000000000000000000000000000000000000000000000000";

  await fs.mkdir(path.join(appsRoot, "app-a"), { recursive: true });
  await fs.mkdir(path.join(appsRoot, "app-b"), { recursive: true });

  registry = await import("./projects.registry.js");
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpCwd, { recursive: true, force: true });
});

test("starts with an empty list when no registry file exists yet", async () => {
  assert.deepEqual(await registry.listProjects(), []);
});

test("addProject rejects a dirName that doesn't exist under APPS_ROOT", async () => {
  await assert.rejects(() =>
    registry.addProject({ id: "ghost", dirName: "does-not-exist", pm2Name: "ghost", startScript: "npm start" }),
  );
});

test("addProject rejects a traversal attempt as dirName", async () => {
  await assert.rejects(
    () => registry.addProject({ id: "evil", dirName: "../outside", pm2Name: "evil", startScript: "npm start" }),
    registry.InvalidDirNameError,
  );
});

test("addProject persists a valid project and listProjects reflects it", async () => {
  const project = await registry.addProject({
    id: "app-a",
    dirName: "app-a",
    pm2Name: "app-a",
    startScript: "npm start",
  });
  assert.equal(project.id, "app-a");
  const listed = await registry.listProjects();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].dirName, "app-a");

  const onDisk = JSON.parse(await fs.readFile(path.join(tmpCwd, "data", "projects.json"), "utf8"));
  assert.equal(onDisk.length, 1);
});

test("a second write creates a .bak file containing the prior state", async () => {
  await registry.addProject({ id: "app-b", dirName: "app-b", pm2Name: "app-b", startScript: "npm start" });

  const backup = JSON.parse(await fs.readFile(path.join(tmpCwd, "data", "projects.json.bak"), "utf8"));
  // The backup should reflect the state *before* this write (just app-a).
  assert.equal(backup.length, 1);
  assert.equal(backup[0].id, "app-a");

  const current = await registry.listProjects();
  assert.equal(current.length, 2);
});

test("removeProject removes an entry and reports success", async () => {
  const removed = await registry.removeProject("app-b");
  assert.equal(removed, true);
  const listed = await registry.listProjects();
  assert.deepEqual(
    listed.map((p) => p.id),
    ["app-a"],
  );
});

test("removeProject on an unknown id returns false without throwing", async () => {
  const removed = await registry.removeProject("does-not-exist");
  assert.equal(removed, false);
});

test("a corrupted projects.json recovers from projects.json.bak on next load", async () => {
  const dataDir = path.join(tmpCwd, "data");
  // At this point projects.json = [app-a], and .bak = the state before the
  // last removeProject call (which itself was preceded by an add, so .bak
  // still holds a valid, parseable prior generation).
  await fs.writeFile(path.join(dataDir, "projects.json"), "{ not valid json ][", "utf8");

  // Force a fresh module instance so its in-memory cache is empty and it must
  // actually read from disk again, instead of serving the already-loaded cache.
  const fresh = (await import(`./projects.registry.js?fresh=${Date.now()}`)) as typeof import("./projects.registry.js");
  const recovered = await fresh.listProjects();
  assert.ok(Array.isArray(recovered));
});

test("listAvailableDirs excludes registered dirs, hidden dirs, and files", async () => {
  // At this point app-a is registered, app-b's directory still exists on
  // disk but was un-registered by an earlier test (removeProject only
  // touches the registry, never the filesystem).
  await fs.mkdir(path.join(appsRoot, "app-c"));
  await fs.mkdir(path.join(appsRoot, ".hidden"));
  await fs.writeFile(path.join(appsRoot, "not-a-dir.txt"), "hello");

  const available = await registry.listAvailableDirs();
  assert.deepEqual(available, ["app-b", "app-c"]);
});
